import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { bech32 } from "@scure/base";
import { bytesToHex, hexToBytes } from "./bytes";

export const ADDRESS_PREFIX = "vault";

export interface KeyPair {
  privHex: string;
  pubHex: string; // 33-byte compressed
  address: string;
}

/** bech32("vault", ripemd160(sha256(compressedPubKey))) - the cosmos-sdk secp256k1 address scheme. */
export function addressFromPub(pub: Uint8Array): string {
  const h = ripemd160(sha256(pub));
  return bech32.encode(ADDRESS_PREFIX, bech32.toWords(h));
}

export function isValidAddress(addr: string): boolean {
  try {
    const d = bech32.decode(addr as `${string}1${string}`);
    return d.prefix === ADDRESS_PREFIX && bech32.fromWords(d.words).length === 20;
  } catch {
    return false;
  }
}

export function keyFromPriv(priv: Uint8Array): KeyPair {
  if (priv.length !== 32 || !secp256k1.utils.isValidSecretKey(priv)) {
    throw new Error("invalid secp256k1 private key (need 32 bytes, 1 <= k < n)");
  }
  const pub = secp256k1.getPublicKey(priv, true);
  return { privHex: bytesToHex(priv), pubHex: bytesToHex(pub), address: addressFromPub(pub) };
}

export function keyFromHex(hex: string): KeyPair {
  const h = hex.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(h)) throw new Error("private key must be 64 hex characters");
  return keyFromPriv(hexToBytes(h.toLowerCase()));
}

export function generateKey(): KeyPair {
  return keyFromPriv(secp256k1.utils.randomSecretKey());
}
