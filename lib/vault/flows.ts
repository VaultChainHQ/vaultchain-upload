// High-level flows (upload, download, grant, revoke). Everything that touches a
// private key happens here, in the browser; the network only ever sees signed
// transactions, read tokens and (cipher)text chunks.
import { bytesToHex, hexToBytes } from "./bytes";
import { buildManifest, proofHeader, prove, safeMime, safeName, verifyContent, type Manifest } from "./chunk";
import { HttpError, type Deal, type ManifestRecord, type NodeClient, type ProviderClient, type TxRecord } from "./client";
import { DENOM } from "./config";
import { isValidAddress, type KeyPair } from "./keys";
import type { VaultMsg } from "./msgs";
import { signReadToken } from "./readtoken";
import { signTx } from "./tx";
import { decrypt, encrypt, ENCRYPTION_V1, generateFileKey, openKey, sealKey } from "./vaultcrypt";

export interface Signer {
  key: KeyPair;
  priv: Uint8Array;
}

export function signerFromKey(key: KeyPair): Signer {
  return { key, priv: hexToBytes(key.privHex) };
}

export type Progress = (step: string, fraction?: number) => void;

/** Sign, submit and wait for inclusion of one tx; throws with the chain's message if it failed. */
export async function submitMsgs(node: NodeClient, signer: Signer, msgs: VaultMsg[], progress?: Progress): Promise<TxRecord> {
  const [info, acct] = await Promise.all([node.info(), node.account(signer.key.address)]);
  const tx = signTx(signer.priv, {
    chainId: info.chainId,
    nonce: acct.pending_nonce,
    msgs,
    pubHex: signer.key.pubHex,
  });
  progress?.(`Submitting ${msgs.map((m) => m.type).join(" + ")} (nonce ${acct.pending_nonce})`);
  const hash = await node.submit(tx.raw);
  progress?.("Waiting for the next block");
  const rec = await node.waitTx(hash);
  if (!rec.ok) throw new Error(`transaction failed: ${rec.result}`);
  return rec;
}

async function pool<T>(count: number, concurrency: number, fn: (i: number) => Promise<T>): Promise<T[]> {
  const out = new Array<T>(count);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= count) return;
      out[i] = await fn(i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, count) }, worker));
  return out;
}

async function retry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      // Client errors (bad proof, not authorised, no deal yet) will not fix themselves,
      // except 403/404 right after the deal tx, which can lag by a moment.
      if (e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 403 && e.status !== 404 && e.status !== 429) throw e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw last;
}

export interface UploadOptions {
  node: NodeClient;
  provider: ProviderClient;
  signer: Signer;
  data: Uint8Array;
  name: string;
  mime: string;
  encrypt: boolean;
  durationBlocks: number;
  chunkSize?: number;
  progress?: Progress;
}

export interface UploadResult {
  root: string;
  size: number;
  encrypted: boolean;
  dealId?: number;
  manifestTx?: string;
  dealTx?: string;
}

export async function uploadObject(o: UploadOptions): Promise<UploadResult> {
  const { node, provider, signer, progress } = o;
  if (o.data.length === 0) throw new Error("empty files cannot be stored (a manifest needs at least one chunk)");
  const pstatus = await provider.status();
  const info = await node.info();
  if (pstatus.chain_id !== info.chainId) throw new Error(`provider is on ${pstatus.chain_id} but the node is on ${info.chainId}`);

  let body = o.data;
  let fileKey: Uint8Array | undefined;
  if (o.encrypt) {
    progress?.("Encrypting in your browser (XChaCha20-Poly1305)");
    fileKey = generateFileKey();
    body = encrypt(o.data, fileKey);
  }

  progress?.("Chunking and computing the Merkle root");
  const { manifest, leaves } = buildManifest(body, {
    chunkSize: o.chunkSize,
    mime: safeMime(o.mime),
    name: safeName(o.name),
  });

  const result: UploadResult = { root: manifest.root, size: manifest.size, encrypted: o.encrypt };

  const existing = await node.manifest(manifest.root);
  if (existing && existing.owner !== signer.key.address) {
    throw new Error("this exact content is already committed by another account");
  }
  if (!existing) {
    const msg: VaultMsg = {
      type: "storage/CommitManifest",
      root: manifest.root,
      size: manifest.size,
      chunk_size: manifest.chunkSize,
      mime: manifest.mime,
      name: manifest.name,
      ...(fileKey
        ? {
            encryption: ENCRYPTION_V1,
            key_envelope: bytesToHex(sealKey(fileKey, hexToBytes(signer.key.pubHex), manifest.root, signer.key.address)),
          }
        : {}),
    };
    result.manifestTx = (await submitMsgs(node, signer, [msg], progress)).hash;
  } else {
    progress?.("Manifest already committed by you, skipping");
  }

  const deals = await node.deals({ cid: manifest.root, provider: pstatus.address });
  const live = deals.find((d) => d.status === "pending" || d.status === "open");
  if (live) {
    result.dealId = live.id;
    progress?.(`Reusing deal #${live.id}`);
  } else {
    result.dealTx = (
      await submitMsgs(
        node,
        signer,
        [
          {
            type: "storage/OpenDeal",
            class: "market",
            cid: manifest.root,
            size: manifest.size,
            provider: pstatus.address,
            duration_blocks: o.durationBlocks,
            denom: DENOM,
            replication: 1,
            min_replicas: 1,
          },
        ],
        progress,
      )
    ).hash;
    const opened = (await node.deals({ cid: manifest.root, provider: pstatus.address })).find((d) => d.status === "pending" || d.status === "open");
    result.dealId = opened?.id;
  }

  let done = 0;
  progress?.(`Uploading ${leaves.length} chunk(s)`, 0);
  await pool(leaves.length, 4, async (i) => {
    const chunk = body.subarray(i * manifest.chunkSize, Math.min((i + 1) * manifest.chunkSize, body.length));
    await retry(() => provider.putChunk(manifest.root, i, chunk, proofHeader(prove(leaves, i))));
    progress?.(`Uploading chunks (${++done}/${leaves.length})`, done / leaves.length);
  });
  const st = await provider.objectStatus(manifest.root);
  if (!st?.complete) throw new Error("provider reports the object is incomplete after upload");
  progress?.("Provider holds the complete object");
  return result;
}

/** Find the key envelope this account can open for a manifest: its own, or one granted to it. */
async function envelopeFor(node: NodeClient, signer: Signer, m: ManifestRecord): Promise<string | undefined> {
  if (m.owner === signer.key.address) return m.key_envelope;
  const grants = await node.grants(m.root);
  return grants.find((g) => g.grantee === signer.key.address && g.key_envelope)?.key_envelope;
}

export interface DownloadOptions {
  node: NodeClient;
  provider: ProviderClient;
  signer: Signer;
  root: string;
  /** Decrypt encrypted objects (default true). */
  decrypt?: boolean;
  progress?: Progress;
}

export interface Downloaded {
  data: Uint8Array;
  name: string;
  mime: string;
  encrypted: boolean;
  decrypted: boolean;
}

export async function downloadObject(o: DownloadOptions): Promise<Downloaded> {
  const { node, provider, signer, progress } = o;
  const rec = await node.manifest(o.root);
  if (!rec) throw new Error("no manifest with that root is committed on chain");
  const m: Manifest = { root: rec.root, size: rec.size, chunkSize: rec.chunk_size, mime: rec.mime, name: rec.name };
  const pstatus = await provider.status();
  const token = signReadToken(signer.priv, signer.key.pubHex, pstatus.address, m.root, Math.floor(Date.now() / 1000) + 600);
  const n = Math.ceil(m.size / m.chunkSize);
  const parts: Uint8Array[] = [];
  let done = 0;
  progress?.(`Downloading ${n} chunk(s)`, 0);
  await pool(n, 4, async (i) => {
    parts[i] = await retry(() => provider.getChunk(m.root, i, token), 3);
    progress?.(`Downloading chunks (${++done}/${n})`, done / n);
  });
  const all = new Uint8Array(m.size);
  let off = 0;
  for (const p of parts) {
    all.set(p, off);
    off += p.length;
  }
  if (off !== m.size) throw new Error(`downloaded ${off} bytes, manifest says ${m.size}`);
  progress?.("Verifying the Merkle root against the on-chain manifest");
  verifyContent(all, m);

  const encrypted = rec.encryption === ENCRYPTION_V1;
  if (!encrypted || o.decrypt === false) {
    return { data: all, name: m.name, mime: m.mime, encrypted, decrypted: false };
  }
  const env = await envelopeFor(node, signer, rec);
  if (!env) throw new Error("this object is encrypted and no key envelope for your account was found");
  progress?.("Decrypting in your browser");
  const fileKey = openKey(hexToBytes(env), signer.priv, m.root, signer.key.address);
  return { data: decrypt(all, fileKey), name: m.name, mime: m.mime, encrypted, decrypted: true };
}

export async function grantRead(
  node: NodeClient,
  signer: Signer,
  rec: ManifestRecord,
  grantee: string,
  expiryHeight: number,
  progress?: Progress,
): Promise<TxRecord> {
  if (rec.owner !== signer.key.address) throw new Error("only the owner can grant access");
  const msg: VaultMsg = { type: "access/GrantAccess", cid: rec.root, grantee, capability: "read", expiry_height: expiryHeight };
  if (grantee === "*") {
    if (rec.encryption === ENCRYPTION_V1) {
      throw new Error("a public grant cannot carry a key, so it would only expose ciphertext. Grant to a specific address instead.");
    }
  } else {
    if (!isValidAddress(grantee)) throw new Error("grantee is not a valid vault1... address");
    if (rec.encryption === ENCRYPTION_V1) {
      if (!rec.key_envelope) throw new Error("manifest has no key envelope");
      const pub = await node.pubkey(grantee);
      if (!pub) throw new Error("the grantee has not signed a transaction yet, so their public key is unknown on chain; ask them to send any tx first");
      progress?.("Re-wrapping the file key for the grantee in your browser");
      const fileKey = openKey(hexToBytes(rec.key_envelope), signer.priv, rec.root, signer.key.address);
      (msg as Extract<VaultMsg, { type: "access/GrantAccess" }>).key_envelope = bytesToHex(
        sealKey(fileKey, hexToBytes(pub), rec.root, grantee),
      );
    }
  }
  return submitMsgs(node, signer, [msg], progress);
}

export async function revokeRead(node: NodeClient, signer: Signer, rec: ManifestRecord, opts: { grantee?: string; grantId?: number }, progress?: Progress): Promise<TxRecord> {
  if (rec.owner !== signer.key.address) throw new Error("only the owner can revoke access");
  if (!opts.grantee && !opts.grantId) throw new Error("need a grantee or a grant id");
  return submitMsgs(node, signer, [{ type: "access/RevokeAccess", cid: rec.root, ...(opts.grantee ? { grantee: opts.grantee } : { grant_id: opts.grantId }) }], progress);
}

export type { Deal };
