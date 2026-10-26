// Streaming preparation of a file for upload. The file is read in slices, optionally encrypted segment by segment,
// cut into manifest chunks, hashed, and each chunk is handed to a sink (IndexedDB in the browser) instead of being kept.
// Memory use stays near one read window (a few MiB) however large the file is.
import { contentRoot, DEFAULT_CHUNK_SIZE, hashLeaf, MAX_CHUNK_SIZE, treeRoot, validateMime, validateName, type Manifest } from "./chunk";
import { ciphertextSize, DEFAULT_SEGMENT_SIZE, generateFileKey, newHeader, sealSegment } from "./vaultcrypt";

export interface StageOptions {
  blob: Blob;
  name: string;
  mime: string;
  encrypt: boolean;
  chunkSize?: number;
  /** Receives every finished chunk in order. The array is not reused, so the sink may keep it. */
  sink: (index: number, chunk: Uint8Array) => Promise<void>;
  /** 0..1 of the source file consumed. */
  progress?: (fraction: number) => void;
  /** Bytes of the source read per step. A multiple of the segment size is best (default 4 MiB). */
  readSize?: number;
  /** Test hook: use a fixed key and stream header instead of fresh random ones. */
  fixed?: { key: Uint8Array; header: Uint8Array };
}

export interface Staged {
  manifest: Manifest;
  leaves: Uint8Array[];
  /** The one-time file key of an encrypted upload. The caller seals it to the owner and then drops it. */
  fileKey?: Uint8Array;
}

/** The number of bytes the stored object will have for a source of `size` bytes. */
export function storedSize(size: number, encrypt: boolean): number {
  return encrypt ? ciphertextSize(size) : size;
}

export async function stageBlob(o: StageOptions): Promise<Staged> {
  const chunkSize = o.chunkSize ?? DEFAULT_CHUNK_SIZE;
  if (!Number.isInteger(chunkSize) || chunkSize <= 0 || chunkSize > MAX_CHUNK_SIZE) throw new Error(`chunk size must be in 1..${MAX_CHUNK_SIZE}`);
  validateMime(o.mime);
  validateName(o.name);
  const n = o.blob.size;
  if (n === 0) throw new Error("empty files cannot be stored (a manifest needs at least one chunk)");

  const seg = DEFAULT_SEGMENT_SIZE;
  const readSize = Math.max(seg, Math.floor((o.readSize ?? 4 * 1024 * 1024) / seg) * seg);
  const key = o.encrypt ? (o.fixed?.key ?? generateFileKey()) : undefined;
  const header = o.encrypt ? (o.fixed?.header ?? newHeader(seg)) : undefined;

  const leaves: Uint8Array[] = [];
  let buf = new Uint8Array(chunkSize);
  let fill = 0;
  let total = 0;
  const push = async (bytes: Uint8Array) => {
    let off = 0;
    while (off < bytes.length) {
      const take = Math.min(chunkSize - fill, bytes.length - off);
      buf.set(bytes.subarray(off, off + take), fill);
      fill += take;
      off += take;
      if (fill === chunkSize) {
        const chunk = buf;
        buf = new Uint8Array(chunkSize);
        fill = 0;
        leaves.push(hashLeaf(chunk));
        total += chunk.length;
        await o.sink(leaves.length - 1, chunk);
      }
    }
  };

  if (header) await push(header);
  for (let pos = 0; pos < n; pos += readSize) {
    const end = Math.min(pos + readSize, n);
    const plain = new Uint8Array(await o.blob.slice(pos, end).arrayBuffer());
    if (plain.length !== end - pos) throw new Error("the file changed while it was being read; choose it again");
    if (key && header) {
      for (let s = 0; s < plain.length; s += seg) {
        const at = pos + s;
        const part = plain.subarray(s, Math.min(s + seg, plain.length));
        await push(sealSegment(key, header, at / seg, at + part.length >= n, part));
      }
    } else {
      await push(plain);
    }
    o.progress?.(end / n);
  }
  if (fill > 0) {
    const chunk = buf.slice(0, fill);
    leaves.push(hashLeaf(chunk));
    total += chunk.length;
    await o.sink(leaves.length - 1, chunk);
  }
  const want = storedSize(n, o.encrypt);
  if (total !== want) throw new Error(`internal error: staged ${total} bytes, expected ${want}`);
  const root = contentRoot(treeRoot(leaves), total, chunkSize);
  return { manifest: { root, size: total, chunkSize, mime: o.mime, name: o.name }, leaves, fileKey: key };
}

