import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { idbJobStore, memoryJobStore, type JobStore } from "../lib/jobstore";
import { bytesToHex } from "../lib/vault/bytes";
import { buildManifest, chunkLeaves } from "../lib/vault/chunk";
import type { Deal, ManifestRecord, NodeClient, ProviderClient } from "../lib/vault/client";
import { downloadBlob, extendStorage, signerFromKey } from "../lib/vault/flows";
import { keyFromHex } from "../lib/vault/keys";
import { NeedFileError, ProviderFullError, jobProgress, newJob, runJob } from "../lib/vault/resumable";
import { stageBlob, storedSize } from "../lib/vault/stage";
import { StreamDecryptor, encryptWithHeader, newHeader, generateFileKey, ciphertextSize } from "../lib/vault/vaultcrypt";
import { keyByName, pattern } from "./vectors";

const signer = signerFromKey(keyFromHex(keyByName("bob").priv_hex));
const PROVIDER = "vault1providerxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

/** A tiny in-memory chain + provider that understands the three messages the engine sends. */
function fakeWorld(opts: { free?: number } = {}) {
  const manifests = new Map<string, ManifestRecord>();
  const deals: Deal[] = [];
  const grants: { grantee: string; cid: string; expiry_height: number }[] = [];
  const objects = new Map<string, Map<number, Uint8Array>>();
  const totals = new Map<string, number>();
  const sent: string[] = [];
  const log = { commits: 0, deals: 0, grants: 0, puts: 0 };
  let height = 100;
  let nonce = 0;
  const txs = new Map<string, boolean>();
  const node = {
    info: async () => ({ chainId: "vault-test-1", height }),
    account: async () => ({ nonce, pending_nonce: nonce }),
    submit: async (raw: string) => {
      const tx = JSON.parse(raw);
      for (const m of tx.msgs) {
        if (m.type === "storage/CommitManifest") {
          log.commits++;
          manifests.set(m.root, { root: m.root, size: m.size, chunk_size: m.chunk_size, mime: m.mime, name: m.name, owner: signer.key.address, height, encryption: m.encryption, key_envelope: m.key_envelope });
          totals.set(m.root, Math.ceil(m.size / m.chunk_size));
        } else if (m.type === "storage/OpenDeal") {
          log.deals++;
          deals.push({ id: deals.length + 1, cid: m.cid, status: "open", start_height: height, expire_height: height + m.duration_blocks, replicas: [{ slot: 0, provider: m.provider, status: "active" }] } as Deal);
        } else if (m.type === "access/GrantAccess") {
          log.grants++;
          grants.push({ grantee: m.grantee, cid: m.cid, expiry_height: m.expiry_height });
        }
      }
      nonce++;
      height += 2;
      const hash = `tx${nonce}`;
      txs.set(hash, true);
      sent.push(hash);
      return hash;
    },
    waitTx: async (hash: string) => ({ hash, height, ok: true, result: "ok" }),
    manifest: async (root: string) => manifests.get(root) ?? null,
    deals: async (f: { cid?: string }) => deals.filter((d) => !f.cid || d.cid === f.cid),
    grants: async (cid?: string) => grants.filter((g) => !cid || g.cid === cid),
    providers: async () => [{ address: PROVIDER, endpoint: "", capacity: 1e9, free_bytes: opts.free ?? 1e9, status: "active" }],
    pubkey: async () => signer.key.pubHex,
  } as unknown as NodeClient;
  const provider = {
    status: async () => ({ status: "ok", version: "t", address: PROVIDER, chain_id: "vault-test-1", objects: objects.size }),
    objectStatus: async (root: string) => {
      const o = objects.get(root);
      if (!o) return null;
      const total = totals.get(root) ?? 0;
      return { chunks_have: o.size, chunks_total: total, complete: o.size === total };
    },
    putChunk: async (root: string, i: number, data: Uint8Array) => {
      log.puts++;
      if (!objects.has(root)) objects.set(root, new Map());
      objects.get(root)!.set(i, data.slice());
      return { chunks_have: objects.get(root)!.size, chunks_total: totals.get(root) ?? 0, complete: false };
    },
    getChunk: async (root: string, i: number) => objects.get(root)!.get(i)!,
  } as unknown as ProviderClient;
  return { node, provider, log, objects, manifests, grants, deals };
}

const fileOf = (n: number, name = "f.bin") => new File([pattern(n) as BlobPart], name, { type: "application/octet-stream" });
const base = (size: number, encrypt: boolean, id = "job1") => newJob({ id, owner: signer.key.address, name: "f.bin", mime: "application/octet-stream", size, encrypt, durationBlocks: 1000 });

describe("streaming staging", () => {
  it("produces the same root and chunks as the in-memory path (public)", async () => {
    const data = pattern(10_000);
    const got: Uint8Array[] = [];
    const st = await stageBlob({ blob: new Blob([data as BlobPart]), name: "a", mime: "text/plain", encrypt: false, chunkSize: 1024, readSize: 3000, sink: async (i, c) => void (got[i] = c) });
    const ref = buildManifest(data, { chunkSize: 1024, mime: "text/plain", name: "a" });
    expect(st.manifest.root).toBe(ref.manifest.root);
    expect(got.length).toBe(ref.leaves.length);
    expect(st.leaves.map(bytesToHex)).toEqual(ref.leaves.map(bytesToHex));
  });

  it("produces exactly the ciphertext of the one-shot encryptor (private)", async () => {
    const data = pattern(200_000);
    const key = generateFileKey();
    const header = newHeader();
    const got: Uint8Array[] = [];
    const st = await stageBlob({ blob: new Blob([data as BlobPart]), name: "a", mime: "text/plain", encrypt: true, chunkSize: 4096, readSize: 100_000, fixed: { key, header }, sink: async (i, c) => void (got[i] = c) });
    const whole = encryptWithHeader(data, key, header, 64 * 1024);
    const joined = new Uint8Array(got.reduce((a, c) => a + c.length, 0));
    let off = 0;
    for (const c of got) {
      joined.set(c, off);
      off += c.length;
    }
    expect(bytesToHex(joined)).toBe(bytesToHex(whole));
    expect(st.manifest.size).toBe(ciphertextSize(data.length));
    expect(st.manifest.root).toBe(buildManifest(whole, { chunkSize: 4096, mime: "text/plain", name: "a" }).manifest.root);
    expect(storedSize(data.length, true)).toBe(whole.length);
  });

  it("refuses empty input and reports progress up to 1", async () => {
    await expect(stageBlob({ blob: new Blob([]), name: "a", mime: "text/plain", encrypt: false, sink: async () => {} })).rejects.toThrow(/empty/);
    const seen: number[] = [];
    await stageBlob({ blob: new Blob([pattern(9000) as BlobPart]), name: "a", mime: "text/plain", encrypt: false, chunkSize: 1000, readSize: 64 * 1024, progress: (f) => seen.push(f), sink: async () => {} });
    expect(seen.at(-1)).toBe(1);
  });
});

describe("StreamDecryptor", () => {
  it("decrypts pieces of any size, including exact segment boundaries", async () => {
    for (const n of [1, 65_535, 65_536, 65_537, 300_000]) {
      const data = pattern(n);
      const key = generateFileKey();
      const cipher = encryptWithHeader(data, key, newHeader(), 64 * 1024);
      for (const piece of [7, 1000, 65_552, 70_000]) {
        const d = new StreamDecryptor(key);
        const out: Uint8Array[] = [];
        for (let o = 0; o < cipher.length; o += piece) out.push(...d.push(cipher.subarray(o, o + piece)));
        out.push(...d.finish());
        expect(bytesToHex(new Uint8Array(await new Blob(out as BlobPart[]).arrayBuffer()))).toBe(bytesToHex(data));
      }
    }
  });
  it("detects truncation and tampering", () => {
    const key = generateFileKey();
    const cipher = encryptWithHeader(pattern(200_000), key, newHeader(), 64 * 1024);
    const d1 = new StreamDecryptor(key);
    d1.push(cipher.subarray(0, cipher.length - 70_000));
    expect(() => d1.finish()).toThrow(/authentication failed|truncated/);
    const bad = cipher.slice();
    bad[100_000] ^= 1;
    const d2 = new StreamDecryptor(key);
    expect(() => {
      d2.push(bad);
      d2.finish();
    }).toThrow(/authentication failed/);
  });
});

async function stores(): Promise<[string, JobStore][]> {
  return [
    ["memory", memoryJobStore()],
    ["IndexedDB", idbJobStore(new IDBFactory(), `t${Math.random()}`)],
  ];
}

describe("runJob (resumable engine)", () => {
  it("uploads from scratch: one commit, one deal, every chunk, then cleans up", async () => {
    for (const [, store] of await stores()) {
      const w = fakeWorld();
      const data = 700_000;
      const res = await runJob({ store, node: w.node, provider: w.provider, signer, job: base(data, false), file: fileOf(data), chunkSize: 65_536 });
      expect(w.log).toMatchObject({ commits: 1, deals: 1, grants: 1 });
      expect(w.log.puts).toBe(Math.ceil(data / 65_536));
      expect(res.root).toBe(buildManifest(pattern(data), { chunkSize: 65_536, mime: "application/octet-stream", name: "f.bin" }).manifest.root);
      expect(await store.listJobs()).toEqual([]);
      expect(res.manifestTx && res.dealTx && res.dealId).toBeTruthy();
    }
  });

  it("resumes after an interruption in the middle of sending without paying again or resending finished chunks", async () => {
    for (const [, store] of await stores()) {
      const w = fakeWorld();
      const data = 900_000;
      const total = Math.ceil(data / 65_536);
      let n = 0;
      await expect(
        runJob({
          store, node: w.node, provider: w.provider, signer, job: base(data, true), file: fileOf(data), chunkSize: 65_536, concurrency: 1,
          onChunkSent: () => {
            if (++n === 5) throw new Error("page closed");
          },
        }),
      ).rejects.toThrow("page closed");
      expect(w.log).toMatchObject({ commits: 1, deals: 1, puts: 5 });
      // "Reload": the job is read back from the store; the original file is NOT available any more.
      const job = (await store.listJobs())[0];
      expect(job.staged?.chunks).toBe(total);
      expect(jobProgress(job).staged).toBe(true);
      const res = await runJob({ store, node: w.node, provider: w.provider, signer, job, concurrency: 1 });
      expect(w.log.commits).toBe(1);
      expect(w.log.deals).toBe(1);
      expect(w.log.puts).toBeLessThanOrEqual(total + 8);
      expect(w.log.puts).toBeGreaterThanOrEqual(total);
      expect(w.objects.get(res.root)!.size).toBe(total);
      expect(res.manifestTx).toBeTruthy();
      expect(w.log.grants).toBe(0); // private: no public grant
      expect(await store.listJobs()).toEqual([]);
      // and what is stored decrypts back to the original file
      const out = await downloadBlob({ node: w.node, provider: w.provider, signer, root: res.root });
      expect(out.decrypted).toBe(true);
      expect(bytesToHex(new Uint8Array(await out.blob.arrayBuffer()))).toBe(bytesToHex(pattern(data)));
    }
  });

  it("resumes after the manifest was committed but before the deal (nothing is committed twice)", async () => {
    const store = memoryJobStore();
    const w = fakeWorld();
    const data = 200_000;
    const real = w.node.submit.bind(w.node);
    let calls = 0;
    w.node.submit = async (raw: string) => {
      if (++calls === 2) throw new Error("network dropped");
      return real(raw);
    };
    await expect(runJob({ store, node: w.node, provider: w.provider, signer, job: base(data, false), file: fileOf(data), chunkSize: 65_536 })).rejects.toThrow("network dropped");
    expect(w.log).toMatchObject({ commits: 1, deals: 0, puts: 0 });
    const res = await runJob({ store, node: w.node, provider: w.provider, signer, job: (await store.listJobs())[0], chunkSize: 65_536 });
    expect(w.log).toMatchObject({ commits: 1, deals: 1 });
    expect(res.dealId).toBe(1);
  });

  it("asks for the file again when it was interrupted while still preparing it", async () => {
    const store = memoryJobStore();
    const w = fakeWorld();
    const data = 400_000;
    const failing: JobStore = { ...store, putChunk: async (id, i, d) => (i === 3 ? Promise.reject(new Error("tab killed")) : store.putChunk(id, i, d)) };
    await expect(runJob({ store: failing, node: w.node, provider: w.provider, signer, job: base(data, true), file: fileOf(data), chunkSize: 65_536 })).rejects.toThrow("tab killed");
    expect(w.log.commits).toBe(0);
    const job = (await store.listJobs())[0];
    expect(job.staged).toBeUndefined();
    expect(jobProgress(job).staged).toBe(false);
    await expect(runJob({ store, node: w.node, provider: w.provider, signer, job, chunkSize: 65_536 })).rejects.toBeInstanceOf(NeedFileError);
    await expect(runJob({ store, node: w.node, provider: w.provider, signer, job, file: fileOf(data - 1), chunkSize: 65_536 })).rejects.toThrow(/Choose the same file/);
    const res = await runJob({ store, node: w.node, provider: w.provider, signer, job, file: fileOf(data), chunkSize: 65_536 });
    expect(w.objects.get(res.root)!.size).toBe(Math.ceil(storedSize(data, true) / 65_536));
    expect(w.log).toMatchObject({ commits: 1, deals: 1 });
  });

  it("resends everything once if the provider lost the object", async () => {
    const store = memoryJobStore();
    const w = fakeWorld();
    const data = 200_000;
    let first = true;
    const status = w.provider.objectStatus.bind(w.provider);
    w.provider.objectStatus = async (root: string) => {
      const s = await status(root);
      if (first && s) {
        first = false;
        w.objects.get(root)!.delete(0);
        return status(root);
      }
      return s;
    };
    const res = await runJob({ store, node: w.node, provider: w.provider, signer, job: base(data, false), file: fileOf(data), chunkSize: 65_536 });
    expect(w.objects.get(res.root)!.size).toBe(Math.ceil(data / 65_536));
  });

  it("does not repeat the public grant on a second run", async () => {
    const store = memoryJobStore();
    const w = fakeWorld();
    const job = base(100_000, false);
    await runJob({ store, node: w.node, provider: w.provider, signer, job, file: fileOf(100_000), chunkSize: 65_536 });
    expect(w.log.grants).toBe(1);
    // a retry with a fresh job for the same bytes finds the manifest, deal and open grant on chain
    await runJob({ store, node: w.node, provider: w.provider, signer, job: { ...job, id: "again", uploaded: [] }, file: fileOf(100_000), chunkSize: 65_536 });
    expect(w.log).toMatchObject({ commits: 1, deals: 1, grants: 1 });
  });

  it("refuses jobs of another profile and files the provider cannot hold", async () => {
    const store = memoryJobStore();
    const w = fakeWorld({ free: 1000 });
    await expect(runJob({ store, node: w.node, provider: w.provider, signer, job: { ...base(5000, false), owner: "vault1someoneelse" }, file: fileOf(5000) })).rejects.toThrow(/another profile/);
    await expect(runJob({ store, node: w.node, provider: w.provider, signer, job: base(5000, false), file: fileOf(5000) })).rejects.toBeInstanceOf(ProviderFullError);
    expect(w.log.commits).toBe(0);
  });

  it("calls ensureSpace with the stored size before writing anything", async () => {
    const store = memoryJobStore();
    const w = fakeWorld();
    let asked = 0;
    await expect(
      runJob({ store, node: w.node, provider: w.provider, signer, job: base(10_000, true), file: fileOf(10_000), ensureSpace: async (n) => ((asked = n), Promise.reject(new Error("no room"))) }),
    ).rejects.toThrow("no room");
    expect(asked).toBe(ciphertextSize(10_000));
  });

  it("stores only ciphertext for private files", async () => {
    const store = memoryJobStore();
    const w = fakeWorld();
    const failing: JobStore = { ...store, getChunk: async () => undefined };
    await expect(runJob({ store: failing, node: w.node, provider: w.provider, signer, job: base(5000, true), file: fileOf(5000), chunkSize: 1024 })).rejects.toThrow(/missing from this browser/);
    const job = (await store.listJobs())[0];
    const first = await store.getChunk(job.id, 0);
    expect(bytesToHex(first!.subarray(0, 4))).toBe(bytesToHex(new TextEncoder().encode("VLE1")));
    expect(bytesToHex(first!)).not.toContain(bytesToHex(pattern(64)));
    expect(job.envelope).toBeTruthy();
    expect(JSON.stringify(job)).not.toMatch(/fileKey|privHex/);
    expect(chunkLeaves).toBeTypeOf("function");
  });
});

describe("extendStorage", () => {
  it("opens one more deal for the same file with the provider that already holds it, and reports it active", async () => {
    const w = fakeWorld();
    const store = memoryJobStore();
    const res = await runJob({ store, node: w.node, provider: w.provider, signer, job: base(50_000, false), file: fileOf(50_000), chunkSize: 65_536 });
    const rec = w.manifests.get(res.root)!;
    const before = w.log.puts;
    const r = await extendStorage({ node: w.node, signer, rec, durationBlocks: 5000, pollMs: 1 });
    expect(r.active).toBe(true);
    expect(r.dealId).toBe(2);
    expect(w.deals.map((d) => d.cid)).toEqual([res.root, res.root]);
    expect(w.deals[1].expire_height - w.deals[1].start_height).toBe(5000);
    expect(w.log.puts).toBe(before); // nothing is uploaded again
    expect(w.log.commits).toBe(1);
  });
  it("is owner-only", async () => {
    const w = fakeWorld();
    await expect(extendStorage({ node: w.node, signer, rec: { root: "r", size: 1, chunk_size: 1, mime: "", name: "", owner: "vault1other", height: 1 }, durationBlocks: 1000 })).rejects.toThrow(/only the owner/);
  });
});
