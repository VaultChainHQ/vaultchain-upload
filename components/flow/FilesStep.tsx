"use client";

import { useRef, useState } from "react";
import { MAX_FILES, MAX_FILE_BYTES, validateFiles } from "@/lib/cost";
import { flowStore, newItem, type FlowState } from "@/lib/flow";
import { fmtBytes } from "@/lib/format";
import { previewKind } from "@/lib/library";
import { Preview, Thumb } from "../Preview";

/** Step 3: pick files by dragging, browsing or pasting; every rejection is explained, nothing is silently dropped. */
export function FilesStep({ state, onNext }: { state: FlowState; onNext: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [preview, setPreview] = useState<string | null>(null);

  function add(list: FileList | File[] | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    const { accepted, issues } = validateFiles(
      files.map((f) => ({ name: f.name, size: f.size })),
      state.items.map((i) => ({ name: i.file.name, size: i.file.size })),
    );
    setIssues(issues.map((i) => i.message));
    if (accepted.length) flowStore().dispatch({ type: "add", items: accepted.map((i) => newItem(files[i])) });
  }

  const total = state.items.reduce((a, i) => a + i.file.size, 0);
  const previewItem = state.items.find((i) => i.id === preview);
  const pk = previewItem ? previewKind(previewItem.file.type, previewItem.file.size) : null;

  return (
    <div>
      <div
        className={over ? "drop on" : "drop"}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          add(e.dataTransfer.files);
        }}
      >
        <span className="drop-icon" aria-hidden="true">⇪</span>
        <p>
          <strong>Drag files here</strong> or
        </p>
        <button type="button" className="btn primary" onClick={() => input.current?.click()}>
          Choose files
        </button>
        <input
          ref={input}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose files to upload"
          data-testid="file-input"
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="muted small">
          Up to {MAX_FILES} files, {fmtBytes(MAX_FILE_BYTES)} each. Files are read in your browser; nothing is sent until you confirm on the review step.
        </p>
      </div>

      {issues.length ? (
        <ul className="callout warn issues-list" role="alert">
          {issues.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      ) : null}

      {state.items.length ? (
        <>
          <ul className="plain picked" aria-label="Files to upload">
            {state.items.map((it) => (
              <li key={it.id} className="picked-row">
                <Thumb file={it.file} />
                <span className="picked-name">
                  <strong className="wrap-any">{it.file.name}</strong>
                  <span className="muted small">
                    {fmtBytes(it.file.size)} · {it.file.type || "unknown type"}
                  </span>
                </span>
                {previewKind(it.file.type, it.file.size) ? (
                  <button type="button" className="btn sm" aria-expanded={preview === it.id} onClick={() => setPreview(preview === it.id ? null : it.id)}>
                    {preview === it.id ? "Hide preview" : "Preview"}
                  </button>
                ) : null}
                <button type="button" className="btn sm danger" onClick={() => flowStore().dispatch({ type: "remove", id: it.id })} aria-label={`Remove ${it.file.name}`}>
                  Remove
                </button>
                {preview === it.id && previewItem && pk ? (
                  <div className="picked-preview">
                    <Preview blob={previewItem.file} name={previewItem.file.name} kind={pk} mime={previewItem.file.type} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="muted" role="status">
            {state.items.length} file{state.items.length === 1 ? "" : "s"} · {fmtBytes(total)} in total
          </p>
        </>
      ) : null}

      <div className="row step-actions">
        <button type="button" className="btn primary" disabled={!state.items.length} onClick={onNext}>
          Next: choose options
        </button>
        {!state.items.length ? <span className="muted small">Choose at least one file to continue.</span> : null}
      </div>
    </div>
  );
}
