import { friendlyError } from "./errors";
import type { UploadDeps } from "./flow";
import { node, provider } from "./hooks";
import { jobStore } from "./jobstore";
import { session } from "./session";
import { newJob, runJob } from "./vault/resumable";
import type { Signer } from "./vault/flows";

/** Refuses early, with a clear message, when the browser has no room to keep the pieces of a big upload. */
export async function ensureStorageSpace(bytes: number): Promise<void> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.quota !== undefined && est.usage !== undefined && est.quota - est.usage < bytes * 1.1) {
      throw new Error(`This browser has only ${Math.floor((est.quota - est.usage) / 1048576)} MiB of free space for pending uploads, but this file needs ${Math.ceil(bytes / 1048576)} MiB. Free some space or try a smaller file.`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("This browser has only")) throw e;
  }
}

export function currentSigner(): Signer {
  const u = session().snapshot();
  if (!u) throw new Error("The profile is locked. Unlock it and try again.");
  return { key: u.key, priv: u.priv };
}

/** The real dependencies for `runQueue`: sign with the unlocked profile and upload through the resumable engine. */
export function realDeps(): UploadDeps {
  return {
    explain: friendlyError,
    upload: async (o) => {
      const signer = currentSigner();
      const store = jobStore();
      // A long upload must not trip the inactivity lock, so every progress tick counts as activity.
      const progress = (step: string, fraction?: number) => {
        session().touch();
        o.progress(step, fraction);
      };
      // A retry continues the same job (nothing is re-read or re-paid) unless the options changed since.
      let job = await store.getJob(o.id);
      if (job && (job.encrypt !== o.encrypt || job.durationBlocks !== o.durationBlocks || job.size !== o.file.size || job.owner !== signer.key.address)) {
        await store.deleteJob(o.id);
        job = undefined;
      }
      job ??= newJob({ id: o.id, owner: signer.key.address, name: o.name, mime: o.mime, size: o.file.size, encrypt: o.encrypt, durationBlocks: o.durationBlocks });
      return runJob({ store, node, provider, signer, job, file: o.file, progress, ensureSpace: ensureStorageSpace });
    },
  };
}
