"use client";

import { useState } from "react";
import type { Unlocked } from "@/lib/session";
import type { ManifestRecord } from "@/lib/vault/client";
import { extendStorage } from "@/lib/vault/flows";
import { DURATIONS, FEE_UVAULT, escrowFor, storedBytes } from "@/lib/cost";
import { fmtVault } from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import { node } from "@/lib/hooks";
import { toast } from "@/lib/toast";
import { ErrorNote, Spinner } from "./../ui";
import { usePrice } from "../flow/usePrice";

/** Pay for more storage time for a file you own. The provider already holds it, so nothing is uploaded again. */
export function ExtendPanel({ rec, unlocked, onChanged }: { rec: ManifestRecord; unlocked: Unlocked | null; onChanged: () => void }) {
  const { price } = usePrice();
  const [blocks, setBlocks] = useState(DURATIONS[2].blocks);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState<ReturnType<typeof friendlyError> | null>(null);
  const cost = price !== undefined ? escrowFor(storedBytes(rec.size, false), blocks, price) + FEE_UVAULT : undefined;

  if (!unlocked) return <p className="muted small">Unlock your profile to add storage time.</p>;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await extendStorage({ node, signer: { key: unlocked!.key, priv: unlocked!.priv }, rec, durationBlocks: blocks, progress: (s) => setStep(s) });
      window.dispatchEvent(new Event("vc:balance"));
      onChanged();
      toast(r.active ? "Storage extended. The provider confirmed the new term." : "Payment sent. The provider has not confirmed the new term yet; it will show up here shortly.", r.active ? "good" : "info");
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  return (
    <div className="extend" data-testid="extend-panel">
      <label className="field">
        <span className="field-label">Add storage time</span>
        <select value={blocks} onChange={(e) => setBlocks(Number(e.target.value))} disabled={busy} aria-label="Extra storage time">
          {DURATIONS.map((d) => (
            <option key={d.blocks} value={d.blocks}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="btn sm primary" disabled={busy || cost === undefined} onClick={() => void run()} data-testid="extend-btn">
        {busy ? <Spinner label={step || "Extending…"} /> : `Extend storage${cost !== undefined ? ` (≈ ${fmtVault(cost)} VAULT)` : ""}`}
      </button>
      <ErrorNote error={error} />
    </div>
  );
}
