import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "./bytes";

export const READ_DOMAIN = "vaultchain/read/v1\n";

/**
 * Provider read token: `<pubkey hex>.<expiry unix>.<signature hex>`, signed over
 * sha256("vaultchain/read/v1\n" + provider + "\n" + root + "\n" + exp).
 */
export function signReadToken(priv: Uint8Array, pubHex: string, provider: string, root: string, exp: number): string {
  const msg = utf8ToBytes(`${READ_DOMAIN}${provider}\n${root}\n${exp}`);
  const sig = secp256k1.sign(sha256(msg), priv, { prehash: false, lowS: true });
  return `${pubHex}.${exp}.${bytesToHex(sig)}`;
}
