// Finishing uploads that were interrupted by a reload, a closed tab or a crash. The pieces and progress are in the job store;
// this module lists them and runs them again. Runs live at module level, so they keep going while you move between pages.
import { friendlyError } from "./errors";
import { node, provider } from "./hooks";
import { jobStore, type UploadJob } from "./jobstore";
import { currentSigner, ensureStorageSpace } from "./uploader";
import { session } from "./session";
import type { UploadResult } from "./vault/flows";
import { runJob } from "./vault/resumable";

export interface ResumeRun {
  status: "running" | "done" | "error";
  step: string;
  fraction?: number;
  error?: ReturnType<typeof friendlyError>;
  result?: UploadResult;
}

const runs = new Map<string, ResumeRun>();
const listeners = new Set<() => void>();
let version = 0;
const bump = () => {
  version++;
  listeners.forEach((l) => l());
};

export const resumeVersion = (): number => version;
export const resumeRuns = (): ReadonlyMap<string, ResumeRun> => runs;
export const resumeSubscribe = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

/** Unfinished uploads in this browser, oldest first. */
export async function pendingJobs(): Promise<UploadJob[]> {
  try {
    return await jobStore().listJobs();
  } catch {
    return [];
  }
}

export async function discardJob(id: string): Promise<void> {
  runs.delete(id);
  await jobStore().deleteJob(id);
  bump();
}

/** Continue a job. `file` is only needed when the job never finished preparing (its pieces were not all stored). */
export async function resumeJob(job: UploadJob, file?: File): Promise<void> {
  if (runs.get(job.id)?.status === "running") return;
  runs.set(job.id, { status: "running", step: "Starting…" });
  bump();
  try {
    const signer = currentSigner();
    const result = await runJob({
      store: jobStore(),
      node,
      provider,
      signer,
      job,
      file,
      ensureSpace: ensureStorageSpace,
      progress: (step, fraction) => {
        session().touch();
        runs.set(job.id, { status: "running", step, fraction });
        bump();
      },
    });
    runs.set(job.id, { status: "done", step: "Done", fraction: 1, result });
    if (typeof window !== "undefined") window.dispatchEvent(new Event("vc:balance"));
  } catch (e) {
    runs.set(job.id, { status: "error", step: "", error: friendlyError(e) });
  }
  bump();
}
