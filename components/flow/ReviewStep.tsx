"use client";

import { checkFunds, durationLabel, estimateCost, DURATIONS } from "@/lib/cost";
import { flowStore, runQueue, type FlowState } from "@/lib/flow";
import { fmtBytes, fmtVault } from "@/lib/format";
import { useAccount, useBalance } from "@/lib/hooks";
import { realDeps } from "@/lib/uploader";
import { Term } from "../Term";
import { Spinner } from "../ui";
import { usePrice } from "./usePrice";

/** Step 5: one screen that says exactly what will happen and what it costs, before anything is signed. */
export function ReviewStep({ state, onBack, onFunds }: { state: FlowState; onBack: () => void; onFunds: () => void }) {
  const { profile } = useAccount();
  const bal = useBalance(profile?.entry.address, 5000);
  const { price, live } = usePrice();
  const encrypt = state.privacy === "private";
  const cost = price !== undefined ? estimateCost(state.items.map((i) => ({ name: i.file.name, size: i.file.size })), { encrypt, durationBlocks: state.durationBlocks, pricePerGb: price }) : undefined;
  const funds = cost ? checkFunds(bal.data, cost) : undefined;
  const short = funds && !funds.ok ? funds.shortBy : 0n;
  const dur = DURATIONS.find((d) => d.blocks === state.durationBlocks)?.label ?? durationLabel(state.durationBlocks);

  function start() {
    void runQueue(flowStore(), realDeps());
  }

  return (
    <div className="stack">
      <dl className="kv summary">
        <dt>Who can read</dt>
        <dd>{encrypt ? "Only you (private, locked in your browser)" : "Anyone with the link (public, not locked)"}</dd>
        <dt>Kept for</dt>
        <dd>{dur}</dd>
        <dt>Copies</dt>
        <dd>1 (one storage provider on the devnet)</dd>
        <dt>Signed by</dt>
        <dd>{profile ? `${profile.entry.name}` : "…"}</dd>
      </dl>

      <div className="tablewrap">
        <table className="cost">
          <caption className="sr-only">Cost per file</caption>
          <thead>
            <tr>
              <th scope="col">File</th>
              <th scope="col" className="num">Size</th>
              <th scope="col" className="num">Storage</th>
              <th scope="col" className="num">Fees</th>
            </tr>
          </thead>
          <tbody>
            {(cost?.lines ?? []).map((l, i) => (
              <tr key={i}>
                <td className="wrap-any">{l.name}</td>
                <td className="num">{fmtBytes(l.size)}</td>
                <td className="num">{fmtVault(l.escrow)}</td>
                <td className="num">{fmtVault(l.fees)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>Total (VAULT)</th>
              <td className="num" colSpan={2}>
                <strong className="total" data-testid="total">{cost ? fmtVault(cost.total) : "…"}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="muted small">
        Storage is paid into <Term k="escrow">escrow</Term> and released to the provider as it proves it holds your file. Fees are two small network <Term k="tx">transactions</Term> per file (record it, then pay for storage).
        {live ? "" : " The price shown is the devnet default; the node's current price could not be read."}
      </p>

      <p className="funds-line">
        Your balance: <strong>{bal.data === undefined ? "…" : `${fmtVault(bal.data)} VAULT`}</strong>
        {funds?.ok ? <span className="pill ok"> enough</span> : null}
      </p>
      {funds && !funds.ok ? (
        <div className="callout warn" role="alert">
          <strong>You are {fmtVault(short)} VAULT short.</strong> Get more test funds, or go back and pick a shorter time or fewer files.{" "}
          <button type="button" className="btn sm primary" onClick={onFunds}>
            Get funds
          </button>
        </div>
      ) : null}

      {encrypt ? (
        <p className="callout">
          <strong>Keep your passphrase and backup safe.</strong> These files are locked with your profile&apos;s key. If you lose both the passphrase and the backup, nobody can open them again, not even us.
        </p>
      ) : (
        <p className="callout warn">
          <strong>Public means public.</strong> Anyone with the link can download {state.items.length > 1 ? "these files" : "this file"}, and the contents are visible to the storage provider. Go back and choose Private for anything sensitive.
        </p>
      )}

      <div className="row step-actions">
        <button type="button" className="btn" onClick={onBack} disabled={state.running}>
          Back
        </button>
        <button type="button" className="btn primary big-btn" onClick={start} disabled={state.running || !cost || (funds ? !funds.ok : bal.data === undefined)} data-testid="start-upload">
          {state.running ? <Spinner label="Starting…" /> : `Upload ${state.items.length} file${state.items.length === 1 ? "" : "s"}`}
        </button>
      </div>
      <p className="muted small">Pressing Upload signs the transactions with your unlocked key, in this browser.</p>
    </div>
  );
}
