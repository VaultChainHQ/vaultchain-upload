// The upload engine for big files and for uploads that must survive a reload.
//
// Step 1 (staging) reads the file once, encrypts it when private, cuts it into chunks and stores every chunk in a JobStore
// (IndexedDB in the browser). Everything after that works from the stored chunks and from what the chain says, so it can
// be interrupted at any point and continued later without re-reading the file and without paying twice:
//   - the manifest is committed only if the chain does not know it yet,
//   - the deal is opened only if there is no live deal for it,
//   - only the chunks the provider has not accepted yet are sent,
//   - the public grant is added only when it is missing.
import { bytesToHex, hexToBytes } from "./bytes";
import { proofHeader, prove, safeMime, safeName } from "./chunk";
import type { ManifestRecord, NodeClient, ProviderClient } from "./client";
import { DENOM } from "./config";
import { grantRead, pool, retry, submitMsgs, type Progress, type Signer, type UploadResult } from "./flows";
import type { VaultMsg } from "./msgs";
import { stageBlob, storedSize } from "./stage";
import { ENCRYPTION_V1, sealKey } from "./vaultcrypt";
import type { JobStore, UploadJob } from "../jobstore";

export class NeedFileError extends Error {
  constructor(public job: UploadJob) {
    super(`The file “${job.name}” has to be chosen again to continue this upload.`);
    this.name = "NeedFileError";
  }
}

export class ProviderFullError extends Error {
  constructor(public need: number, public free: number) {
    super(`The storage provider has ${free} bytes free, but this file needs ${need}.`);
    this.name = "ProviderFullError";
  }
}

export interface NewJob {
  id: string;
  owner: string;
  name: string;
  mime: string;
  size: number;
  encrypt: boolean;
  durationBlocks: number;
}

export function newJob(j: NewJob, now = Date.now()): UploadJob {
  return { ...j, mime: safeMime(j.mime), name: safeName(j.name), createdAt: now, updatedAt: now, uploaded: [] };
}

/** Hex leaves (64 chars each) back to byte arrays. */
export function parseLeaves(hex: string): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < hex.length; i += 64) out.push(hexToBytes(hex.slice(i, i + 64)));
  return out;
}

export interface RunOptions {
  store: JobStore;
  node: NodeClient;
  provider: ProviderClient;
  signer: Signer;
  job: UploadJob;
  /** The original file. Needed only while the job is not staged yet. */
  file?: Blob;
  progress?: Progress;
  /** How many chunks to send at once (default 4). */
  concurrency?: number;
  /** Called before staging with the number of bytes about to be written, so the browser can refuse early when it is short of space. */
  ensureSpace?: (bytes: number) => Promise<void>;
  /** Chunk-send hook for tests (called after each accepted chunk). */
  onChunkSent?: (index: number) => void | Promise<void>;
  chunkSize?: number;
}

/** What is already done for a job, for the resume prompt. */
export function jobProgress(job: UploadJob): { staged: boolean; fraction: number; summary: string } {
  if (!job.staged) {
    const f = job.stagingFraction ?? 0;
    return { staged: false, fraction: f * 0.1, summary: "The file was still being prepared. Choose it again to start over from the beginning of the file." };
  }
  const total = job.staged.chunks;
  const sent = job.uploaded.length;
  const parts = [job.manifestTx ? "recorded on the chain" : "not recorded yet", job.dealId || job.dealTx ? "storage paid" : "storage not paid yet", `${sent}/${total} pieces sent`];
  return { staged: true, fraction: 0.1 + 0.9 * (total ? sent / total : 0), summary: parts.join(", ") };
}

export async function runJob(o: RunOptions): Promise<UploadResult> {
  const { store, node, provider, signer, progress } = o;
  let job = o.job;
  const save = async (patch: Partial<UploadJob> = {}) => {
    job = { ...job, ...patch, updatedAt: Date.now() };
    await store.putJob(job);
  };

  if (job.owner !== signer.key.address) throw new Error("This upload belongs to another profile. Unlock that profile to continue it.");

  const pstatus = await provider.status();
  const info = await node.info();
  if (pstatus.chain_id !== info.chainId) throw new Error(`provider is on ${pstatus.chain_id} but the node is on ${info.chainId}`);

  // 1. Stage (once).
  if (!job.staged) {
    if (!o.file) throw new NeedFileError(job);
    if (o.file.size !== job.size) throw new Error(`“${job.name}” is ${o.file.size} bytes but this upload was started with a file of ${job.size} bytes. Choose the same file again.`);
    const need = storedSize(job.size, job.encrypt);
    await o.ensureSpace?.(need);
    const prov = (await node.providers()).find((p) => p.address === pstatus.address);
    if (prov && prov.free_bytes < need) throw new ProviderFullError(need, prov.free_bytes);
    await store.clearChunks(job.id);
    await save({ uploaded: [], manifestTx: undefined, dealTx: undefined, dealId: undefined, granted: false, stagingFraction: 0, error: undefined });
    progress?.(job.encrypt ? "Encrypting in your browser (XChaCha20-Poly1305)" : "Chunking and computing the Merkle root", 0);
    let lastSave = 0;
    const staged = await stageBlob({
      blob: o.file,
      name: job.name,
      mime: job.mime,
      encrypt: job.encrypt,
      chunkSize: o.chunkSize,
      sink: (i, chunk) => store.putChunk(job.id, i, chunk),
      progress: (f) => {
        progress?.(`${job.encrypt ? "Encrypting in your browser (XChaCha20-Poly1305)" : "Chunking and computing the Merkle root"} ${Math.round(f * 100)}%`, f);
        if (Date.now() - lastSave > 1500) {
          lastSave = Date.now();
          void save({ stagingFraction: f });
        }
      },
    });
    progress?.("Chunking and computing the Merkle root", 1);
    const envelope = staged.fileKey ? bytesToHex(sealKey(staged.fileKey, hexToBytes(signer.key.pubHex), staged.manifest.root, signer.key.address)) : undefined;
    staged.fileKey?.fill(0);
    await save({
      stagingFraction: 1,
      envelope,
      staged: { root: staged.manifest.root, storedSize: staged.manifest.size, chunkSize: staged.manifest.chunkSize, chunks: staged.leaves.length, leaves: staged.leaves.map(bytesToHex).join("") },
    });
  }
  const st = job.staged!;
  const leaves = parseLeaves(st.leaves);
  const result: UploadResult = { root: st.root, size: st.storedSize, encrypted: job.encrypt, manifestTx: job.manifestTx, dealTx: job.dealTx, dealId: job.dealId };

  // 2. Record on chain (only if the chain does not have it).
  const existing = await node.manifest(st.root);
  if (existing && existing.owner !== signer.key.address) throw new Error("this exact content is already committed by another account");
  if (!existing) {
    if (job.encrypt && !job.envelope) throw new Error("internal error: the sealed key of this upload is missing");
    const msg: VaultMsg = {
      type: "storage/CommitManifest",
      root: st.root,
      size: st.storedSize,
      chunk_size: st.chunkSize,
      mime: job.mime,
      name: job.name,
      ...(job.encrypt ? { encryption: ENCRYPTION_V1, key_envelope: job.envelope! } : {}),
    };
    result.manifestTx = (await submitMsgs(node, signer, [msg], progress)).hash;
    await save({ manifestTx: result.manifestTx });
  } else {
    progress?.("Manifest already committed by you, skipping");
  }

  // 3. Pay for storage (only if there is no live deal).
  const live = (await node.deals({ cid: st.root, provider: pstatus.address })).find((d) => d.status === "pending" || d.status === "open");
  if (live) {
    result.dealId = live.id;
    progress?.(`Reusing deal #${live.id}`);
  } else {
    result.dealTx = (
      await submitMsgs(
        node,
        signer,
        [{ type: "storage/OpenDeal", class: "market", cid: st.root, size: st.storedSize, provider: pstatus.address, duration_blocks: job.durationBlocks, denom: DENOM, replication: 1, min_replicas: 1 }],
        progress,
      )
    ).hash;
    const opened = (await node.deals({ cid: st.root, provider: pstatus.address })).find((d) => d.status === "pending" || d.status === "open");
    result.dealId = opened?.id;
  }
  if (result.dealId !== job.dealId || result.dealTx !== job.dealTx) await save({ dealId: result.dealId, dealTx: result.dealTx });

  // 4. Send the chunks the provider has not accepted yet.
  const sent = new Set(job.uploaded);
  const sendAll = async () => {
    const todo = leaves.map((_, i) => i).filter((i) => !sent.has(i));
    progress?.(`Uploading ${todo.length === leaves.length ? leaves.length : `${todo.length} of ${leaves.length}`} chunk(s)`, sent.size / leaves.length);
    let unsaved = 0;
    await pool(todo.length, o.concurrency ?? 4, async (k) => {
      const i = todo[k];
      const chunk = await store.getChunk(job.id, i);
      if (!chunk) throw new Error(`the stored piece ${i} of “${job.name}” is missing from this browser. Choose the file again to start over.`);
      await retry(() => provider.putChunk(st.root, i, chunk, proofHeader(prove(leaves, i))));
      sent.add(i);
      progress?.(`Uploading chunks (${sent.size}/${leaves.length})`, sent.size / leaves.length);
      await o.onChunkSent?.(i);
      if (++unsaved >= 8) {
        unsaved = 0;
        await save({ uploaded: [...sent] });
      }
    });
    await save({ uploaded: [...sent] });
  };
  let status = await provider.objectStatus(st.root);
  if (status?.complete) {
    // Everything already arrived (for example the page was closed right after the last chunk).
    leaves.forEach((_, i) => sent.add(i));
    await save({ uploaded: [...sent] });
  } else {
    await sendAll();
    status = await provider.objectStatus(st.root);
  }
  if (!status?.complete) {
    // The provider lost something (or never kept it): send everything again once.
    sent.clear();
    await sendAll();
    status = await provider.objectStatus(st.root);
    if (!status?.complete) throw new Error("provider reports the object is incomplete after upload");
  }
  progress?.("Provider holds the complete object");

  // 5. Public files: open to everyone with the link.
  if (!job.encrypt && !job.granted) {
    progress?.("Granting public access to anyone with the link");
    const [rec, grants, now] = await Promise.all([node.manifest(st.root), node.grants(st.root), node.info()]);
    const open = grants.some((g) => g.grantee === "*" && g.expiry_height > now.height);
    if (rec && !open) await grantRead(node, signer, rec as ManifestRecord, "*", now.height + job.durationBlocks, progress);
    await save({ granted: true });
  }

  await store.deleteJob(job.id);
  return result;
}
