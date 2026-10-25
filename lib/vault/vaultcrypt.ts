// TypeScript port of vaultchain pkg/vaultcrypt: XChaCha20-Poly1305 segmented
// stream encryption plus the ECDH/HKDF key envelope. Verified against
// Go-generated vectors in test/vaultcrypt.test.ts.
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, randomBytes, u32be, u64be, utf8ToBytes } from "./bytes";

export const ENCRYPTION_V1 = "vle1";
export const DEFAULT_SEGMENT_SIZE = 64 * 1024;
export const MAX_SEGMENT_SIZE = 16 * 1024 * 1024;
export const HEADER_SIZE = 24;
export const KEY_SIZE = 32;
const TAG = 16;
const PREFIX = 16;
const MAGIC = utf8ToBytes("VLE1");

export const ENVELOPE_SIZE = 33 + 24 + KEY_SIZE + TAG;

export function generateFileKey(): Uint8Array {
  return randomBytes(KEY_SIZE);
}

export function ciphertextSize(n: number, seg = DEFAULT_SEGMENT_SIZE): number {
  const segs = n === 0 ? 1 : Math.ceil(n / seg);
  return HEADER_SIZE + n + segs * TAG;
}

function segNonce(prefix: Uint8Array, index: number): Uint8Array {
  return concatBytes(prefix, u64be(index));
}

function segAAD(header: Uint8Array, final: boolean): Uint8Array {
  return concatBytes(header, Uint8Array.of(final ? 1 : 0));
}

export function encrypt(plain: Uint8Array, key: Uint8Array, segmentSize = DEFAULT_SEGMENT_SIZE): Uint8Array {
  if (key.length !== KEY_SIZE) throw new Error("vaultcrypt: key must be 32 bytes");
  if (!Number.isInteger(segmentSize) || segmentSize <= 0 || segmentSize > MAX_SEGMENT_SIZE) {
    throw new Error("vaultcrypt: bad segment size");
  }
  const header = concatBytes(MAGIC, u32be(segmentSize), randomBytes(PREFIX));
  return encryptWithHeader(plain, key, header, segmentSize);
}

/** Exposed for deterministic tests; production code uses encrypt(). */
export function encryptWithHeader(plain: Uint8Array, key: Uint8Array, header: Uint8Array, segmentSize: number): Uint8Array {
  const prefix = header.subarray(8, HEADER_SIZE);
  const segs = plain.length === 0 ? 1 : Math.ceil(plain.length / segmentSize);
  const parts: Uint8Array[] = [header];
  for (let i = 0; i < segs; i++) {
    const pt = plain.subarray(i * segmentSize, Math.min((i + 1) * segmentSize, plain.length));
    parts.push(xchacha20poly1305(key, segNonce(prefix, i), segAAD(header, i === segs - 1)).encrypt(pt));
  }
  return concatBytes(...parts);
}

export function decrypt(cipher: Uint8Array, key: Uint8Array): Uint8Array {
  if (key.length !== KEY_SIZE) throw new Error("vaultcrypt: key must be 32 bytes");
  if (cipher.length < HEADER_SIZE || !MAGIC.every((b, i) => cipher[i] === b)) {
    throw new Error("vaultcrypt: not an encrypted stream (bad header)");
  }
  const header = cipher.subarray(0, HEADER_SIZE);
  const seg = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(4, false);
  if (seg <= 0 || seg > MAX_SEGMENT_SIZE) throw new Error("vaultcrypt: bad segment size in header");
  const prefix = header.subarray(8, HEADER_SIZE);
  const sealedMax = seg + TAG;
  const out: Uint8Array[] = [];
  let off = HEADER_SIZE;
  let index = 0;
  for (;;) {
    const n = Math.min(sealedMax, cipher.length - off);
    if (n < TAG) throw new Error("vaultcrypt: corrupt or truncated stream");
    const final = off + n >= cipher.length;
    try {
      out.push(xchacha20poly1305(key, segNonce(prefix, index), segAAD(header, final)).decrypt(cipher.subarray(off, off + n)));
    } catch {
      throw new Error("vaultcrypt: authentication failed (wrong key, or data corrupted or truncated)");
    }
    off += n;
    index++;
    if (final) break;
  }
  return concatBytes(...out);
}

function wrapKey(shared: Uint8Array, ephPub: Uint8Array, recipientPub: Uint8Array, root: string, addr: string): Uint8Array {
  return hkdf(sha256, shared, concatBytes(ephPub, recipientPub), utf8ToBytes(`vaultchain/key-envelope/v1|${root}|${addr}`), 32);
}

/** Seal the 32-byte file key to a recipient's compressed public key. */
export function sealKey(fileKey: Uint8Array, recipientPub: Uint8Array, root: string, recipientAddr: string): Uint8Array {
  const eph = secp256k1.utils.randomSecretKey();
  const ephPub = secp256k1.getPublicKey(eph, true);
  const shared = secp256k1.getSharedSecret(eph, recipientPub, true).slice(1); // x coordinate only
  const wk = wrapKey(shared, ephPub, recipientPub, root, recipientAddr);
  const nonce = randomBytes(24);
  return concatBytes(ephPub, nonce, xchacha20poly1305(wk, nonce, ephPub).encrypt(fileKey));
}

export function openKey(envelope: Uint8Array, priv: Uint8Array, root: string, addr: string): Uint8Array {
  if (envelope.length !== ENVELOPE_SIZE) throw new Error("vaultcrypt: bad key envelope size");
  const ephPub = envelope.subarray(0, 33);
  const nonce = envelope.subarray(33, 57);
  const ownPub = secp256k1.getPublicKey(priv, true);
  const shared = secp256k1.getSharedSecret(priv, ephPub, true).slice(1);
  const wk = wrapKey(shared, ephPub, ownPub, root, addr);
  try {
    return xchacha20poly1305(wk, nonce, ephPub).decrypt(envelope.subarray(57));
  } catch {
    throw new Error("vaultcrypt: cannot open key envelope (not addressed to this key)");
  }
}
