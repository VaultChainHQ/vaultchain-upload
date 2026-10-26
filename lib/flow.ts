// State of the guided upload: which step you are on, which files are queued and how far each one is.
// The reducer is pure (and unit tested); `FlowStore` wraps it for React and keeps the state alive
// when you navigate to another page of the app, so an upload keeps running while you look at your files.
import { DEFAULT_DURATION } from "./cost";
import type { UploadResult } from "./vault/flows";

export type StepId = "profile" | "funds" | "files" | "options" | "review" | "upload" | "done";

export const STEPS: readonly { id: StepId; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "funds", label: "Funds" },
  { id: "files", label: "Files" },
  { id: "options", label: "Options" },
  { id: "review", label: "Review" },
  { id: "upload", label: "Upload" },
  { id: "done", label: "Done" },
];

export type Stage = "encrypt" | "hash" | "commit" | "deal" | "upload" | "verify" | "share";
export const STAGES: readonly { id: Stage; label: string; explain: string }[] = [
  { id: "encrypt", label: "Lock the file", explain: "Encrypted in your browser with a key only you hold." },
  { id: "hash", label: "Fingerprint it", explain: "Split into pieces and computed a short fingerprint (a Merkle root) that identifies the content." },
  { id: "commit", label: "Record it on the chain", explain: "One signed transaction saves the fingerprint, name and size." },
  { id: "deal", label: "Pay for storage", explain: "A second transaction opens a storage deal and escrows the price." },
  { id: "upload", label: "Send it to the provider", explain: "The pieces go to the storage provider, each with a proof of where it belongs." },
  { id: "verify", label: "Check it is all there", explain: "The provider confirms it holds every piece." },
  { id: "share", label: "Open it to anyone with the link", explain: "Public files only: one more transaction lets anyone with the link download the file." },
];

export type ItemStatus = "queued" | "running" | "done" | "error";
export type Privacy = "private" | "public";

export interface FileItem {
  id: string;
  file: File;
  status: ItemStatus;
  stage?: Stage;
  /** 0..1 inside the upload stage. */
  fraction?: number;
  /** The latest progress sentence from the engine, shown small under the step list. */
  detail?: string;
  error?: { title: string; hint?: string; detail: string; retryable: boolean };
  result?: UploadResult;
  /** The stage that was active when it failed, so the list can show where it stopped. */
  failedAt?: Stage;
}

export interface FlowState {
  step: StepId;
  items: FileItem[];
  privacy: Privacy;
  durationBlocks: number;
  running: boolean;
  /** Bumped each time a new batch starts, so late progress callbacks from an old run are ignored. */
  runId: number;
}

export const INITIAL_FLOW: FlowState = { step: "profile", items: [], privacy: "private", durationBlocks: DEFAULT_DURATION, running: false, runId: 0 };

export interface FlowEnv {
  /** A profile is unlocked in this tab. */
  unlocked: boolean;
  /** Balance in uvault once known. */
  balance?: bigint;
}

/** Below this the funds step cannot be skipped: it would not even cover one tiny upload. */
export const MIN_FUNDS_UVAULT = 2_000_000n;

export function initialStep(env: FlowEnv): StepId {
  if (!env.unlocked) return "profile";
  if (env.balance !== undefined && env.balance < MIN_FUNDS_UVAULT) return "funds";
  return "files";
}

export const stepIndex = (id: StepId): number => STEPS.findIndex((s) => s.id === id);

/** Why a step cannot be opened yet, or null when it can. */
export function blockedReason(step: StepId, s: FlowState, env: FlowEnv): string | null {
  const i = stepIndex(step);
  if (i >= stepIndex("funds") && i <= stepIndex("review") && !env.unlocked) return "Create or unlock a profile first.";
  if (i >= stepIndex("options") && s.items.length === 0) return "Choose at least one file first.";
  if (step === "upload" && !s.running && s.items.every((it) => it.status === "queued")) return "Review your upload and press Upload to start.";
  if (step === "done" && !(s.items.length > 0 && s.items.every((it) => it.status === "done"))) return "Nothing has finished uploading yet.";
  return null;
}

export type StepState = "done" | "current" | "todo" | "locked";

export function stepState(step: StepId, s: FlowState, env: FlowEnv): StepState {
  if (step === s.step) return "current";
  if (blockedReason(step, s, env)) return "locked";
  return stepIndex(step) < stepIndex(s.step) ? "done" : "todo";
}

export type FlowAction =
  | { type: "goto"; step: StepId }
  | { type: "add"; items: FileItem[] }
  | { type: "remove"; id: string }
  | { type: "privacy"; value: Privacy }
  | { type: "duration"; blocks: number }
  | { type: "start" }
  | { type: "patch"; id: string; patch: Partial<FileItem>; runId?: number }
  | { type: "finish" }
  | { type: "retry"; id?: string }
  | { type: "reset" };

export function flowReducer(s: FlowState, a: FlowAction): FlowState {
  switch (a.type) {
    case "goto":
      return { ...s, step: a.step };
    case "add":
      return { ...s, items: [...s.items, ...a.items] };
    case "remove":
      return s.running ? s : { ...s, items: s.items.filter((i) => i.id !== a.id) };
    case "privacy":
      return s.running ? s : { ...s, privacy: a.value };
    case "duration":
      return s.running ? s : { ...s, durationBlocks: a.blocks };
    case "start":
      if (s.running) return s;
      return { ...s, running: true, step: "upload", runId: s.runId + 1 };
    case "patch":
      if (a.runId !== undefined && a.runId !== s.runId) return s;
      return { ...s, items: s.items.map((i) => (i.id === a.id ? { ...i, ...a.patch } : i)) };
    case "finish": {
      const allDone = s.items.length > 0 && s.items.every((i) => i.status === "done");
      return { ...s, running: false, step: allDone ? "done" : s.step };
    }
    case "retry":
      return {
        ...s,
        items: s.items.map((i) => (i.status === "error" && (a.id === undefined || i.id === a.id) ? { ...i, status: "queued", error: undefined, detail: undefined, fraction: undefined } : i)),
      };
    case "reset":
      return { ...INITIAL_FLOW, privacy: s.privacy, durationBlocks: s.durationBlocks, runId: s.runId };
  }
}

/** Which stage an engine progress sentence belongs to. `prev` carries over for sentences like "Waiting for the next block". */
export function stageFromProgress(msg: string, prev?: Stage): Stage | undefined {
  if (/^Encrypting/i.test(msg)) return "encrypt";
  if (/^Chunking/i.test(msg)) return "hash";
  if (/CommitManifest/i.test(msg) || /^Manifest already committed/i.test(msg)) return "commit";
  if (/OpenDeal/i.test(msg) || /^Reusing deal/i.test(msg)) return "deal";
  if (/^Uploading/i.test(msg)) return "upload";
  if (/^Provider holds/i.test(msg)) return "verify";
  if (/^Granting|GrantAccess|^Public access/i.test(msg)) return "share";
  return prev;
}

export type StageRowState = "done" | "active" | "pending" | "skipped" | "error";
export interface StageRow {
  id: Stage;
  label: string;
  explain: string;
  state: StageRowState;
}

/** The checklist of stages for one file: done, doing, still to do, skipped (public file) or where it failed. */
export function stageRows(item: FileItem, privacy: Privacy): StageRow[] {
  const cur = item.stage ? STAGES.findIndex((x) => x.id === item.stage) : -1;
  return STAGES.map((st, i) => {
    let state: StageRowState;
    if ((st.id === "encrypt" && privacy === "public") || (st.id === "share" && privacy === "private")) state = "skipped";
    else if (item.status === "done") state = st.id === "commit" && item.result && !item.result.manifestTx ? "skipped" : "done";
    else if (item.status === "error") {
      const at = item.failedAt ? STAGES.findIndex((x) => x.id === item.failedAt) : cur;
      state = i < at ? "done" : i === at ? "error" : "pending";
    } else if (item.status === "running") state = i < cur ? "done" : i === cur ? "active" : "pending";
    else state = "pending";
    return { id: st.id, label: st.label, explain: st.explain, state };
  });
}

/** Overall fraction 0..1 across a batch, for the headline bar. */
export function batchFraction(items: FileItem[]): number {
  if (!items.length) return 0;
  const per = items.map((it) => {
    if (it.status === "done") return 1;
    if (it.status === "queued") return 0;
    const idx = it.stage ? STAGES.findIndex((x) => x.id === it.stage) : 0;
    const within = it.stage === "upload" ? (it.fraction ?? 0) : 0;
    return Math.min(0.99, (Math.max(0, idx) + within) / STAGES.length);
  });
  return per.reduce((a, b) => a + b, 0) / items.length;
}

export interface UploadDeps {
  upload: (o: { id: string; file: File; name: string; mime: string; encrypt: boolean; durationBlocks: number; progress: (step: string, fraction?: number) => void }) => Promise<UploadResult>;
  explain: (e: unknown) => { title: string; hint?: string; detail: string; retryable: boolean };
}

/** Uploads every queued item, one after another (each signs with the same account, so nonces must not race). */
export async function runQueue(store: FlowStore, deps: UploadDeps): Promise<void> {
  const { items, privacy, durationBlocks } = store.get();
  if (store.get().running) return;
  store.dispatch({ type: "start" });
  const runId = store.get().runId;
  for (const it of items) {
    if (it.status === "done") continue;
    if (store.get().runId !== runId) return;
    store.dispatch({ type: "patch", id: it.id, runId, patch: { status: "running", stage: undefined, error: undefined, failedAt: undefined, fraction: undefined, detail: "Starting…" } });
    let stage: Stage | undefined;
    try {
      const result = await deps.upload({
        id: it.id,
        file: it.file,
        name: it.file.name,
        mime: it.file.type || "application/octet-stream",
        encrypt: privacy === "private",
        durationBlocks,
        progress: (step, fraction) => {
          stage = stageFromProgress(step, stage);
          store.dispatch({ type: "patch", id: it.id, runId, patch: { stage, fraction, detail: step } });
        },
      });
      store.dispatch({ type: "patch", id: it.id, runId, patch: { status: "done", stage: "verify", result, fraction: 1, detail: undefined } });
    } catch (e) {
      store.dispatch({ type: "patch", id: it.id, runId, patch: { status: "error", failedAt: stage, error: deps.explain(e) } });
    }
  }
  store.dispatch({ type: "finish" });
}

export class FlowStore {
  private state: FlowState;
  private listeners = new Set<() => void>();
  constructor(initial: FlowState = INITIAL_FLOW) {
    this.state = initial;
  }
  get = (): FlowState => this.state;
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  dispatch = (a: FlowAction): void => {
    const next = flowReducer(this.state, a);
    if (next === this.state) return;
    this.state = next;
    this.listeners.forEach((l) => l());
  };
}

let shared: FlowStore | undefined;
export function flowStore(): FlowStore {
  return (shared ??= new FlowStore());
}

let counter = 0;
export function newItem(file: File): FileItem {
  return { id: `f${Date.now().toString(36)}${(counter++).toString(36)}`, file, status: "queued" };
}
