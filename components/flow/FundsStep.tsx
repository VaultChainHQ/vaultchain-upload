"use client";

import { useState } from "react";
import { FAUCET_PAGE, faucetInfo, requestDrip } from "@/lib/faucet";
import { fmtVault } from "@/lib/format";
import { usePoll, useBalance, useAccount } from "@/lib/hooks";
import { MIN_FUNDS_UVAULT } from "@/lib/flow";
import { toast } from "@/lib/toast";
import { CopyBtn } from "../CopyText";
import { Spinner } from "../ui";
import { Term } from "../Term";

/** Step 2: free devnet money, one click, with every failure explained. Also used on the Account page. */
export function FundsPanel({ onContinue, compact }: { onContinue?: () => void; compact?: boolean }) {
  const { profile } = useAccount();
  const address = profile?.entry.address;
  const bal = useBalance(address, 3000);
  const info = usePoll("faucet-info", () => faucetInfo(), 0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ text: string; code: string; wait?: number } | null>(null);
  const [sentAt, setSentAt] = useState<{ before: bigint | undefined } | null>(null);

  const have = bal.data;
  const enough = have !== undefined && have >= MIN_FUNDS_UVAULT;
  const arrived = sentAt && have !== undefined && sentAt.before !== undefined && have > sentAt.before;
  const drip = info.data?.dripVault;

  async function ask() {
    if (!address) return;
    setBusy(true);
    setProblem(null);
    const r = await requestDrip(address);
    setBusy(false);
    if (r.ok) {
      setSentAt({ before: have });
      toast("Funds are on the way. This takes a few seconds.", "good");
      bal.reload();
    } else {
      setProblem({ text: r.message, code: r.code, wait: r.retryAfterSeconds });
    }
  }

  return (
    <div className="funds">
      {!compact ? (
        <p className="muted">
          Storing a file costs a little <Term k="vault">VAULT</Term>: the storage price plus two small network fees. On this devnet VAULT is free test money, so there is nothing to buy.
        </p>
      ) : null}
      <p className="funds-bal">
        <span className="muted">Your balance</span>
        <span className="big">{have === undefined ? "…" : fmtVault(have)} <small>VAULT</small></span>
      </p>
      {arrived ? (
        <p className="callout good" role="status">
          <strong>It arrived.</strong> You now have {fmtVault(have!)} VAULT.
        </p>
      ) : sentAt ? (
        <p role="status">
          <Spinner label="Waiting for the funds to arrive (a few blocks)…" />
        </p>
      ) : null}
      {problem ? (
        <div className="callout warn" role="alert">
          <p>
            <strong>{problem.code === "address_cooldown" ? "You have used the free drip recently." : problem.code === "already_funded" ? "You already have plenty." : "Could not send funds."}</strong>{" "}
            {problem.text}
          </p>
          {["unreachable", "node_busy", "node_error", "faucet_busy"].includes(problem.code) ? (
            <button type="button" className="btn sm" onClick={ask} disabled={busy}>
              Try again
            </button>
          ) : null}
          <p className="small muted">
            You can also use the <a href={FAUCET_PAGE} rel="noopener noreferrer" target="_blank">faucet on the web vault</a> with this address{" "}
            {address ? <CopyBtn text={address} label="Copy address" what="Address" /> : null}.
          </p>
        </div>
      ) : null}
      <div className="row">
        {info.data && !info.data.enabled ? (
          <p className="callout warn">The free faucet is switched off right now. Ask in the project channels, or send this address VAULT from another account.</p>
        ) : (
          <button type="button" className="btn primary" onClick={ask} disabled={busy || !address || (!!sentAt && !arrived && !problem)}>
            {busy ? <Spinner label="Sending…" /> : drip ? `Get ${drip} free VAULT` : "Get free VAULT"}
          </button>
        )}
        {onContinue ? (
          <button type="button" className={enough || arrived ? "btn primary" : "btn"} onClick={onContinue}>
            {enough || arrived ? "Continue" : have && have > 0n ? "Continue with what I have" : "Skip: I will add funds later"}
          </button>
        ) : null}
      </div>
      <p className="muted small">
        {info.data?.cooldownHours ? `One free drip per address every ${info.data.cooldownHours} hours. ` : ""}
        Funds come from a shared faucet account; your key is not involved.
      </p>
      {have !== undefined && have < MIN_FUNDS_UVAULT && !sentAt ? <p className="muted small">You need roughly 2 VAULT or more to store one small file for a few hours.</p> : null}
    </div>
  );
}
