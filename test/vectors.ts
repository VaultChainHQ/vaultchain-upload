import raw from "./vectors/go-vectors.json";
import { hexToBytes } from "../lib/vault/bytes";

export interface KeyVec { name: string; priv_hex: string; pub_hex: string; address: string }
export interface ChunkVec { size: number; chunk_size: number; root: string; tree_root: string; leaves: string[]; proofs: string[] }
export interface TxVec {
  name: string; key: string; chain_id: string; nonce: number;
  fee: { denom: string; amount: string }[]; msgs: string[];
  sign_bytes_hex: string; sig_hex: string; raw_tx: string; hash: string;
}
export interface TokenVec { key: string; provider: string; root: string; exp: number; token: string }
export interface CryptVec { plain_size: number; segment_size: number; key_hex: string; cipher_hex: string }
export interface EnvVec { recipient: string; root: string; key_hex: string; envelope_hex: string }

const parsed = raw as unknown as {
  pattern: string; keys: KeyVec[]; chunks: ChunkVec[]; txs: TxVec[]; tokens: TokenVec[]; crypt: CryptVec[]; envelopes: EnvVec[];
};

// Go marshals empty slices as null.
for (const c of parsed.chunks) {
  c.leaves ??= [];
  c.proofs ??= [];
}
export const vectors = parsed;

/** Deterministic test data, identical to tools/tsvectors pattern(n) in vaultchain: byte i = (i*131 + (i>>8)*17 + 7) & 0xff. */
export function pattern(n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 131 + (i >> 8) * 17 + 7) & 0xff;
  return b;
}

export function keyByName(name: string): KeyVec {
  const k = vectors.keys.find((x) => x.name === name);
  if (!k) throw new Error(`no vector key ${name}`);
  return k;
}

export const priv = (k: KeyVec) => hexToBytes(k.priv_hex);
