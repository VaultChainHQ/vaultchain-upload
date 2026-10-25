// TypeScript port of vaultchain pkg/chunk (Merkle chunking). Verified against
// Go-generated vectors in test/chunk.test.ts.
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, hexToBytes, u64be } from "./bytes";

export const DEFAULT_CHUNK_SIZE = 256 * 1024;
export const MAX_CHUNK_SIZE = 64 * 1024 * 1024;
export const MAX_MIME_LEN = 127;
export const MAX_NAME_LEN = 255;

export interface Manifest {
  root: string;
  size: number;
  chunkSize: number;
  mime: string;
  name: string;
}

export function numChunks(size: number, chunkSize: number): number {
  return Math.ceil(size / chunkSize);
}

export function hashLeaf(chunk: Uint8Array): Uint8Array {
  return sha256(concatBytes(Uint8Array.of(0), chunk));
}

function hashNode(l: Uint8Array, r: Uint8Array): Uint8Array {
  return sha256(concatBytes(Uint8Array.of(1), l, r));
}

/** Largest power of two strictly less than n (n >= 2). */
function split(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

export function treeRoot(leaves: Uint8Array[]): Uint8Array {
  if (leaves.length === 0) return sha256(new Uint8Array(0));
  if (leaves.length === 1) return leaves[0];
  const k = split(leaves.length);
  return hashNode(treeRoot(leaves.slice(0, k)), treeRoot(leaves.slice(k)));
}

/** The manifest root: binds the tree root to the object size and chunk size. */
export function contentRoot(tree: Uint8Array, size: number, chunkSize: number): string {
  return bytesToHex(sha256(concatBytes(Uint8Array.of(2), tree, u64be(size), u64be(chunkSize))));
}

export function chunkLeaves(data: Uint8Array, chunkSize: number): Uint8Array[] {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0 || chunkSize > MAX_CHUNK_SIZE) {
    throw new Error(`chunk size must be in 1..${MAX_CHUNK_SIZE}`);
  }
  const out: Uint8Array[] = [];
  for (let off = 0; off < data.length; off += chunkSize) {
    out.push(hashLeaf(data.subarray(off, Math.min(off + chunkSize, data.length))));
  }
  return out;
}

export interface Built {
  manifest: Manifest;
  leaves: Uint8Array[];
}

export function buildManifest(
  data: Uint8Array,
  opts: { chunkSize?: number; mime: string; name: string },
): Built {
  const chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE;
  validateMime(opts.mime);
  validateName(opts.name);
  const leaves = chunkLeaves(data, chunkSize);
  const root = contentRoot(treeRoot(leaves), data.length, chunkSize);
  return { manifest: { root, size: data.length, chunkSize, mime: opts.mime, name: opts.name }, leaves };
}

/** Audit path for chunk `index`, leaf-level sibling first (same order as Go's chunk.Prove). */
export function prove(leaves: Uint8Array[], index: number): Uint8Array[] {
  if (!Number.isInteger(index) || index < 0 || index >= leaves.length) {
    throw new Error(`chunk index ${index} out of range [0,${leaves.length})`);
  }
  const path: Uint8Array[] = [];
  const rec = (m: number, d: Uint8Array[]) => {
    if (d.length === 1) return;
    const k = split(d.length);
    if (m < k) {
      rec(m, d.slice(0, k));
      path.push(treeRoot(d.slice(k)));
    } else {
      rec(m - k, d.slice(k));
      path.push(treeRoot(d.slice(0, k)));
    }
  };
  rec(index, leaves);
  return path;
}

/** The X-Vault-Proof header value: comma-separated hex path. */
export function proofHeader(path: Uint8Array[]): string {
  return path.map(bytesToHex).join(",");
}

function rootFromPath(m: number, n: number, leaf: Uint8Array, path: Uint8Array[]): Uint8Array {
  if (n === 1) {
    if (path.length !== 0) throw new Error("proof too long");
    return leaf;
  }
  if (path.length === 0) throw new Error("proof too short");
  const sib = path[path.length - 1];
  if (sib.length !== 32) throw new Error("proof element is not 32 bytes");
  const rest = path.slice(0, -1);
  const k = split(n);
  if (m < k) return hashNode(rootFromPath(m, k, leaf, rest), sib);
  return hashNode(sib, rootFromPath(m - k, n - k, leaf, rest));
}

export function parseProofHeader(h: string): Uint8Array[] {
  return h === "" ? [] : h.split(",").map((x) => hexToBytes(x));
}

/** Throws unless `chunk` is chunk `index` of the object `m` (m.root trusted). */
export function verifyProof(m: Manifest, index: number, chunk: Uint8Array, path: Uint8Array[]): void {
  const n = numChunks(m.size, m.chunkSize);
  if (index < 0 || index >= n) throw new Error(`chunk index ${index} out of range [0,${n})`);
  const want = index === n - 1 ? m.size - index * m.chunkSize : m.chunkSize;
  if (chunk.length !== want) throw new Error(`chunk ${index} has length ${chunk.length}, want ${want}`);
  const tree = rootFromPath(index, n, hashLeaf(chunk), path);
  if (contentRoot(tree, m.size, m.chunkSize) !== m.root) throw new Error(`chunk ${index} does not match root`);
}

/** Recompute the manifest root from downloaded bytes and check it. */
export function verifyContent(data: Uint8Array, m: Manifest): void {
  if (data.length !== m.size) throw new Error(`size mismatch: got ${data.length}, manifest says ${m.size}`);
  const root = contentRoot(treeRoot(chunkLeaves(data, m.chunkSize)), m.size, m.chunkSize);
  if (root !== m.root) throw new Error("content does not match manifest root");
}

export function validateMime(s: string): void {
  if (s === "" || s.length > MAX_MIME_LEN) throw new Error(`mime must be 1..${MAX_MIME_LEN} chars`);
  if (!/^[a-z0-9.+_-]+\/[a-z0-9.+_-]+$/.test(s)) throw new Error("mime must look like type/subtype (lowercase)");
}

export function validateName(s: string): void {
  if (new TextEncoder().encode(s).length > MAX_NAME_LEN) throw new Error(`name longer than ${MAX_NAME_LEN} bytes`);
  if (/[\u0000-\u001f\u007f/\\]/.test(s)) throw new Error("name contains a control character or path separator");
}

/** Best-effort conversion of a browser File.type into a valid manifest mime. */
export function safeMime(type: string): string {
  const t = type.trim().toLowerCase();
  try {
    validateMime(t);
    return t;
  } catch {
    return "application/octet-stream";
  }
}

/** Replace characters the chain rejects in names. */
export function safeName(name: string): string {
  const n = name.replace(/[\u0000-\u001f\u007f/\\]/g, "_");
  return new TextEncoder().encode(n).length > MAX_NAME_LEN ? n.slice(0, 80) : n;
}
