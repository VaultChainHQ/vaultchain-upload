export {
  bytesToHex,
  hexToBytes,
  concatBytes,
  utf8ToBytes,
  randomBytes,
} from "@noble/hashes/utils.js";

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, false);
  return b;
}

export function u64be(n: number): Uint8Array {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("u64: out of range");
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), false);
  return b;
}
