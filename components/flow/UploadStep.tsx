"use client";

import { batchFraction, flowStore, runQueue, stageRows, type FileItem, type FlowState } from "@/lib/flow";
import { fmtBytes } from "@/lib/format";
import { realDeps } from "@/lib/uploader";
import { ProgressBar, Spinner } from "../ui";

const MARK = { done: "✓", active: "…", pending: "○", skipped: "–", error: "!" } as const;

/** Step 6: what is happening right now, in order, per file. Failures say where they stopped and how to carry on. */
export function UploadStep({ state }: { state: FlowState }) {
  const failed = state.items.filter((i) => i.status === "error");
  const frac = batchFraction(state.items);
  const doneN = state.items.filter((i) => i.status === "done").length;

  function retry() {
    flowStore().dispatch({ type: "retry" });
    void runQueue(flowStore(), realDeps());
  }

  return (
    <div className="stack">
      <div role="status" aria-live="polite">
        <ProgressBar value={frac} label={`Overall progress: ${doneN} of ${state.items.length} files done`} />
        <p className="muted">
          {state.running
            ? `Working on ${state.items.length === 1 ? "your file" : `${doneN} of ${state.items.length} files`}. Keep this tab open; you can browse the other pages meanwhile.`
            : failed.length
              ? `${failed.length} file${failed.length === 1 ? "" : "s"} did not finish. Everything that did is kept.`
              : "All done."}
        </p>
      </div>
      <ul className="plain uploads">
        {state.items.map((it) => (
          <ItemCard key={it.id} item={it} state={state} />
        ))}
      </ul>
      {failed.length && !state.running ? (
        <div className="row step-actions">
          <button type="button" className="btn primary" onClick={retry} data-testid="retry">
            Retry {failed.length === 1 ? "the failed file" : `${failed.length} failed files`}
          </button>
          <button type="button" className="btn" onClick={() => flowStore().dispatch({ type: "goto", step: "review" })}>
            Back to review
          </button>
          <span className="muted small">Retrying skips steps that already finished, so you will not pay twice.</span>
        </div>
      ) : null}
    </div>
  );
}

function ItemCard({ item, state }: { item: FileItem; state: FlowState }) {
  const rows = stageRows(item, state.privacy).filter((r) => !(r.state === "skipped" && (r.id === "share" || r.id === "encrypt")));
  return (
    <li className={`upl ${item.status}`}>
      <div className="upl-head">
        <strong className="wrap-any">{item.file.name}</strong>
        <span className="muted small">{fmtBytes(item.file.size)}</span>
        {item.status === "running" ? <Spinner label="Working" /> : null}
        {item.status === "done" ? <span className="pill ok">Stored</span> : null}
        {item.status === "queued" ? <span className="pill idle">Waiting</span> : null}
        {item.status === "error" ? <span className="pill bad">Stopped</span> : null}
      </div>
      <ol className="stages">
        {rows.map((r) => (
          <li key={r.id} className={`stage ${r.state}`}>
            <span className="stage-mark" aria-hidden="true">{MARK[r.state]}</span>
            <span>
              <span className="stage-label">{r.label}</span>
              <span className="sr-only"> ({r.state === "active" ? "in progress" : r.state === "done" ? "done" : r.state === "error" ? "failed" : r.state === "skipped" ? "not needed" : "waiting"})</span>
              {r.state === "active" || r.state === "error" ? <span className="muted small stage-explain"> {r.explain}</span> : null}
            </span>
          </li>
        ))}
      </ol>
      {item.status === "running" && item.stage === "upload" && item.fraction !== undefined ? <ProgressBar value={item.fraction} label={`Sending ${item.file.name}`} small /> : null}
      {item.status === "running" && item.detail ? <p className="muted small">{item.detail}</p> : null}
      {item.error ? (
        <div className="callout bad" role="alert">
          <p>
            <strong>{item.error.title}</strong> {item.error.hint}
          </p>
          <details>
            <summary>Technical details</summary>
            <pre className="detail">{item.error.detail}</pre>
          </details>
        </div>
      ) : null}
    </li>
  );
}
