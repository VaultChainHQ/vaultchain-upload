"use client";

import { DURATIONS, estimateCost } from "@/lib/cost";
import { flowStore, type FlowState, type Privacy } from "@/lib/flow";
import { fmtVault } from "@/lib/format";
import { Term } from "../Term";
import { usePrice } from "./usePrice";

/** Step 4: three plain decisions: who can read it, how long to keep it, and how many copies (fixed, and why). */
export function OptionsStep({ state, onNext, onBack }: { state: FlowState; onNext: () => void; onBack: () => void }) {
  const { price } = usePrice();
  const files = state.items.map((i) => ({ name: i.file.name, size: i.file.size }));
  const encrypt = state.privacy === "private";
  const many = files.length > 1;

  return (
    <div className="stack">
      <fieldset className="choice">
        <legend>Who can read these files?</legend>
        <div className="cards">
          {(
            [
              ["private", "Private", "Locked in your browser before they leave it. Only you can open them, and you can share them with chosen people later.", "recommended"],
              ["public", "Public", "Stored as they are, with no lock. Anyone with the link can download them. Do not use for anything sensitive.", ""],
            ] as [Privacy, string, string, string][]
          ).map(([v, title, text, tag]) => (
            <label key={v} className={state.privacy === v ? "card-choice on" : "card-choice"}>
              <input type="radio" name="privacy" value={v} checked={state.privacy === v} disabled={state.running} onChange={() => flowStore().dispatch({ type: "privacy", value: v })} />
              <span className="cc-title">
                {title} {tag ? <span className="badge">{tag}</span> : null}
              </span>
              <span className="muted">{text}</span>
              {v === "private" ? <span className="small muted">Technically: <Term k="encryption">encrypted</Term> end to end.</span> : null}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="choice">
        <legend>How long should we keep {many ? "them" : "it"}?</legend>
        <p className="muted small">
          You pay up front for the time you pick, and the storage provider earns it by proving it still has {many ? "the files" : "the file"}. After that the file may disappear, so pick what
          you need. Longer times cost more.
        </p>
        <div className="cards durations">
          {DURATIONS.map((d) => {
            const cost = price !== undefined ? estimateCost(files, { encrypt, durationBlocks: d.blocks, pricePerGb: price }).total : undefined;
            return (
              <label key={d.blocks} className={state.durationBlocks === d.blocks ? "card-choice on" : "card-choice"}>
                <input type="radio" name="duration" value={d.blocks} checked={state.durationBlocks === d.blocks} disabled={state.running} onChange={() => flowStore().dispatch({ type: "duration", blocks: d.blocks })} />
                <span className="cc-title">{d.label}</span>
                <span className="cc-price">{cost === undefined ? "…" : `≈ ${fmtVault(cost)} VAULT`}</span>
                <span className="muted small">{d.note}</span>
              </label>
            );
          })}
        </div>
        <p className="muted small">
          Prices are for {many ? `all ${files.length} files` : "this file"} including network fees, and are an estimate until you confirm. Time is about 3 seconds per <Term k="height">block</Term>, so the length shown is approximate.
        </p>
      </fieldset>

      <div className="callout">
        <strong>Copies: 1.</strong> Right now the devnet has a single storage <Term k="provider">provider</Term>, so every file is stored once. When more providers join you will be able to
        keep extra <Term k="replica">copies</Term> on different ones, so a file survives one of them going offline.
      </div>

      <div className="row step-actions">
        <button type="button" className="btn" onClick={onBack}>
          Back
        </button>
        <button type="button" className="btn primary" onClick={onNext}>
          Next: review
        </button>
      </div>
    </div>
  );
}
