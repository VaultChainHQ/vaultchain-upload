import { describe, expect, it } from "vitest";
import {
  FlowStore, INITIAL_FLOW, MIN_FUNDS_UVAULT, STEPS, batchFraction, blockedReason, flowReducer, initialStep, newItem, runQueue, stageFromProgress, stageRows, stepState, type FileItem, type UploadDeps,
} from "../lib/flow";
import type { UploadResult } from "../lib/vault/flows";

const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: "text/plain" });
const result = { root: "ab".repeat(32), manifestTx: "tx1", dealId: 1 } as unknown as UploadResult;
const explain: UploadDeps["explain"] = (e) => ({ title: "boom", detail: String(e), retryable: true });
const env = { unlocked: true, balance: 10_000_000n };

describe("steps", () => {
  it("has the seven steps in order", () => expect(STEPS.map((s) => s.id)).toEqual(["profile", "funds", "files", "options", "review", "upload", "done"]));
  it("starts where the person needs to be", () => {
    expect(initialStep({ unlocked: false })).toBe("profile");
    expect(initialStep({ unlocked: true, balance: 0n })).toBe("funds");
    expect(initialStep({ unlocked: true, balance: MIN_FUNDS_UVAULT - 1n })).toBe("funds");
    expect(initialStep({ unlocked: true, balance: MIN_FUNDS_UVAULT })).toBe("files");
    expect(initialStep({ unlocked: true })).toBe("files");
  });
  it("explains why a step is locked", () => {
    expect(blockedReason("files", INITIAL_FLOW, { unlocked: false })).toMatch(/profile/);
    expect(blockedReason("options", INITIAL_FLOW, env)).toMatch(/at least one file/);
    expect(blockedReason("upload", { ...INITIAL_FLOW, items: [newItem(file("a"))] }, env)).toMatch(/press Upload/);
    expect(blockedReason("done", { ...INITIAL_FLOW, items: [newItem(file("a"))] }, env)).toMatch(/Nothing/);
    expect(blockedReason("files", INITIAL_FLOW, env)).toBeNull();
  });
  it("labels steps done, current, todo or locked", () => {
    const s = { ...INITIAL_FLOW, step: "options" as const, items: [newItem(file("a"))] };
    expect(stepState("options", s, env)).toBe("current");
    expect(stepState("files", s, env)).toBe("done");
    expect(stepState("review", s, env)).toBe("todo");
    expect(stepState("done", s, env)).toBe("locked");
  });
});

describe("reducer", () => {
  it("adds, removes and changes options only while idle", () => {
    const a = newItem(file("a"));
    let s = flowReducer(INITIAL_FLOW, { type: "add", items: [a] });
    expect(s.items).toHaveLength(1);
    s = flowReducer(s, { type: "privacy", value: "public" });
    s = flowReducer(s, { type: "duration", blocks: 1000 });
    expect([s.privacy, s.durationBlocks]).toEqual(["public", 1000]);
    s = flowReducer(s, { type: "start" });
    expect(s.running).toBe(true);
    expect(s.step).toBe("upload");
    expect(flowReducer(s, { type: "remove", id: a.id })).toBe(s);
    expect(flowReducer(s, { type: "privacy", value: "private" })).toBe(s);
    expect(flowReducer(s, { type: "start" })).toBe(s);
  });
  it("ignores progress from an old run", () => {
    const a = newItem(file("a"));
    const s = { ...INITIAL_FLOW, items: [a], runId: 3 };
    expect(flowReducer(s, { type: "patch", id: a.id, runId: 2, patch: { status: "done" } })).toBe(s);
    expect(flowReducer(s, { type: "patch", id: a.id, runId: 3, patch: { status: "done" } }).items[0].status).toBe("done");
  });
  it("finishes on the done step only when everything is done", () => {
    const a = { ...newItem(file("a")), status: "done" as const };
    const b = { ...newItem(file("b")), status: "error" as const };
    expect(flowReducer({ ...INITIAL_FLOW, items: [a], running: true, step: "upload" }, { type: "finish" }).step).toBe("done");
    expect(flowReducer({ ...INITIAL_FLOW, items: [a, b], running: true, step: "upload" }, { type: "finish" }).step).toBe("upload");
  });
  it("retry requeues failed items only; reset keeps the options", () => {
    const a = { ...newItem(file("a")), status: "done" as const };
    const b = { ...newItem(file("b")), status: "error" as const, error: { title: "x", detail: "x", retryable: true } };
    const s = flowReducer({ ...INITIAL_FLOW, items: [a, b], privacy: "public" }, { type: "retry" });
    expect(s.items.map((i) => i.status)).toEqual(["done", "queued"]);
    expect(s.items[1].error).toBeUndefined();
    const r = flowReducer(s, { type: "reset" });
    expect(r.items).toEqual([]);
    expect(r.privacy).toBe("public");
  });
});

describe("progress sentences", () => {
  it("maps engine messages to stages and carries the previous one", () => {
    expect(stageFromProgress("Encrypting in your browser…")).toBe("encrypt");
    expect(stageFromProgress("Chunking and computing the Merkle root")).toBe("hash");
    expect(stageFromProgress("Submitting storage/CommitManifest…")).toBe("commit");
    expect(stageFromProgress("Waiting for the next block", "commit")).toBe("commit");
    expect(stageFromProgress("Manifest already committed, skipping")).toBe("commit");
    expect(stageFromProgress("Reusing deal #4")).toBe("deal");
    expect(stageFromProgress("Submitting storage/OpenDeal…")).toBe("deal");
    expect(stageFromProgress("Uploading chunks (2/5)")).toBe("upload");
    expect(stageFromProgress("Provider holds the complete object")).toBe("verify");
    expect(stageFromProgress("Granting public access…")).toBe("share");
    expect(stageFromProgress("something else", "deal")).toBe("deal");
  });
});

describe("stage checklist", () => {
  const item = (p: Partial<FileItem>): FileItem => ({ ...newItem(file("a")), ...p });
  it("marks done, active and pending", () => {
    const rows = stageRows(item({ status: "running", stage: "commit" }), "private");
    expect(Object.fromEntries(rows.map((r) => [r.id, r.state]))).toMatchObject({ encrypt: "done", hash: "done", commit: "active", deal: "pending", upload: "pending" });
  });
  it("skips encryption for public files and sharing for private ones", () => {
    expect(stageRows(item({ status: "queued" }), "public").find((r) => r.id === "encrypt")?.state).toBe("skipped");
    expect(stageRows(item({ status: "queued" }), "private").find((r) => r.id === "share")?.state).toBe("skipped");
  });
  it("shows where it failed", () => {
    const rows = stageRows(item({ status: "error", failedAt: "deal" }), "private");
    expect(rows.find((r) => r.id === "deal")?.state).toBe("error");
    expect(rows.find((r) => r.id === "commit")?.state).toBe("done");
    expect(rows.find((r) => r.id === "upload")?.state).toBe("pending");
  });
  it("reports a smooth overall fraction", () => {
    expect(batchFraction([])).toBe(0);
    expect(batchFraction([item({ status: "done" }), item({ status: "queued" })])).toBe(0.5);
    expect(batchFraction([item({ status: "running", stage: "upload", fraction: 0.5 })])).toBeGreaterThan(0.3);
  });
});

describe("runQueue", () => {
  it("uploads in order, continues past a failure, and retry finishes the job", async () => {
    const store = new FlowStore({ ...INITIAL_FLOW, items: ["a", "b", "c"].map((n) => newItem(file(n))), privacy: "public", durationBlocks: 1000, step: "review" });
    let failB = true;
    const seen: string[] = [];
    const deps: UploadDeps = {
      explain,
      upload: async (o) => {
        seen.push(`${o.name}:${o.encrypt}:${o.durationBlocks}`);
        o.progress("Chunking and computing the Merkle root");
        if (o.name === "b" && failB) throw new Error("provider down");
        return result;
      },
    };
    await runQueue(store, deps);
    expect(seen).toEqual(["a:false:1000", "b:false:1000", "c:false:1000"]);
    let s = store.get();
    expect(s.running).toBe(false);
    expect(s.items.map((i) => i.status)).toEqual(["done", "error", "done"]);
    expect(s.items[1].error?.title).toBe("boom");
    expect(s.items[1].failedAt).toBe("hash");
    expect(s.step).toBe("upload");

    failB = false;
    store.dispatch({ type: "retry" });
    await runQueue(store, deps);
    s = store.get();
    expect(seen.slice(3)).toEqual(["b:false:1000"]); // finished files are not uploaded again
    expect(s.step).toBe("done");
  });
  it("does not start twice at once", async () => {
    const store = new FlowStore({ ...INITIAL_FLOW, items: [newItem(file("a"))] });
    let calls = 0;
    const deps: UploadDeps = { explain, upload: async () => (calls++, new Promise((r) => setTimeout(() => r(result), 20))) };
    await Promise.all([runQueue(store, deps), runQueue(store, deps)]);
    expect(calls).toBe(1);
  });
});
