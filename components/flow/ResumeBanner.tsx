"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { fmtBytes, short } from "@/lib/format";
import { useAccount } from "@/lib/hooks";
import type { UploadJob } from "@/lib/jobstore";
import { discardJob, pendingJobs, resumeJob, resumeRuns, resumeSubscribe, resumeVersion } from "@/lib/resume";
import { jobProgress } from "@/lib/vault/resumable";
import { ProgressBar } from "../ui";
import { useFlow } from "./useFlow";

/**
 * Shown above the upload steps when this browser holds uploads that did not finish (the page was reloaded, the tab closed, or the network dropped).
 * Chunks and progress are kept in IndexedDB, so "Resume upload" carries on from the last piece that arrived and never pays for the same step twice.
 */
export function ResumeBanner() {
  const flow = useFlow();
  const { profile, unlocked, mounted } = useAccount();
  const ver = useSyncExternalStore(resumeSubscribe, resumeVersion, () => 0);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const inFlow = new Set(flow.items.map((i) => i.id));

  useEffect(() => {
    let live = true;
    void pendingJobs().then((j) => live && setJobs(j));
    return () => {
      live = false;
    };
  }, [ver, flow.running]);

  const runs = resumeRuns();
  const visible = jobs.filter((j) => !inFlow.has(j.id) && runs.get(j.id)?.status !== "done");
  const finished = [...runs.entries()].filter(([, r]) => r.status === "done");
  if (!mounted || (visible.length === 0 && finished.length === 0)) return null;

  return (
    <section className="panel resume" aria-labelledby="resume-h" data-testid="resume-banner">
      <h2 id="resume-h">{visible.length === 1 ? "An upload did not finish" : `${visible.length} uploads did not finish`}</h2>
      {visible.length ? <p className="muted">They were interrupted, for example by a reload. What already went through is kept, so resuming does not pay twice.</p> : null}
      <ul className="plain uploads">
        {visible.map((j) => (
          <ResumeRow key={j.id} job={j} run={runs.get(j.id)} mine={!!profile && profile.entry.address === j.owner} unlocked={!!unlocked} />
        ))}
        {finished.map(([id, r]) => (
          <li key={id} className="card" data-testid="resume-done">
            <p>
              <strong>Finished.</strong>{" "}
              {r.result ? (
                <Link href={`/files?open=${r.result.root}`}>Open it in My files ({short(r.result.root, 8, 6)})</Link>
              ) : null}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ResumeRow({ job, run, mine, unlocked }: { job: UploadJob; run?: ReturnType<typeof resumeRuns> extends ReadonlyMap<string, infer R> ? R : never; mine: boolean; unlocked: boolean }) {
  const p = jobProgress(job);
  const pick = useRef<HTMLInputElement>(null);
  const [mismatch, setMismatch] = useState<string | null>(null);
  const running = run?.status === "running";
  const frac = running ? (run?.fraction ?? p.fraction) : p.fraction;

  function chosen(f: File | undefined) {
    if (!f) return;
    if (f.size !== job.size) return setMismatch(`That file is ${fmtBytes(f.size)}, but this upload was started with ${fmtBytes(job.size)}. Choose the same file.`);
    setMismatch(null);
    void resumeJob(job, f);
  }

  return (
    <li className="card" data-testid="resume-row">
      <p>
        <strong>{job.name}</strong> <span className="muted small">{fmtBytes(job.size)} · {job.encrypt ? "private" : "public"}</span>
      </p>
      <ProgressBar value={frac} label={`Progress of ${job.name}`} small />
      <p className="muted small">{running ? run?.step : p.summary}</p>
      {run?.status === "error" && run.error ? (
        <p className="callout bad" role="alert">
          <strong>{run.error.title}</strong> {run.error.hint}
        </p>
      ) : null}
      {mismatch ? (
        <p className="callout bad" role="alert">
          {mismatch}
        </p>
      ) : null}
      {!mine ? (
        <p className="muted small">This upload belongs to another profile on this browser. Switch to it and unlock it to continue.</p>
      ) : !unlocked ? (
        <p className="muted small">Unlock your profile (step 1) to continue.</p>
      ) : (
        <div className="row">
          {p.staged ? (
            <button type="button" className="btn primary sm" disabled={running} onClick={() => void resumeJob(job)} data-testid="resume-btn">
              {run?.status === "error" ? "Try again" : "Resume upload"}
            </button>
          ) : (
            <>
              <button type="button" className="btn primary sm" disabled={running} onClick={() => pick.current?.click()} data-testid="resume-pick">
                Choose “{job.name}” again
              </button>
              <input ref={pick} type="file" hidden onChange={(e) => chosen(e.target.files?.[0])} data-testid="resume-file" />
            </>
          )}
          <button type="button" className="btn sm" disabled={running} onClick={() => void discardJob(job.id)}>
            Discard
          </button>
        </div>
      )}
    </li>
  );
}
