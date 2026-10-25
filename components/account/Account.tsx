"use client";

import { useState } from "react";
import type { Unlocked } from "@/lib/session";
import type { ProfileRecord, VaultData } from "@/lib/vaultstore";
import { fmtVault } from "@/lib/format";
import { errMsg, node, useBalance, usePoll } from "@/lib/hooks";
import { announceKey } from "@/lib/vault/flows";
import { toast } from "@/lib/toast";
import { CopyBtn } from "../CopyText";
import { Qr } from "../Qr";
import { FundsPanel } from "../flow/FundsStep";
import { Settings } from "../Settings";
import { Avatar, ErrorNote, Spinner } from "../ui";
import { Term } from "../Term";

export function Account({ vault, profile, unlocked }: { vault: VaultData; profile: ProfileRecord; unlocked: Unlocked | null }) {
  const address = profile.entry.address;
  const bal = useBalance(address, 5000);
  const key = usePoll(`pub:${address}`, () => node.pubkey(address), 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState(false);

  async function publish() {
    if (!unlocked) return;
    setBusy(true);
    setError(null);
    try {
      await announceKey(node, { key: unlocked.key, priv: unlocked.priv });
      key.reload();
      toast("Your key is published. People can now share private files with you.", "good");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <section className="panel" aria-labelledby="who-h">
        <h2 id="who-h">
          <Avatar name={profile.entry.name} color={profile.entry.color} size={28} /> {profile.entry.name}
        </h2>
        <dl className="kv">
          <dt>Your address</dt>
          <dd>
            <span className="mono wrap-any">{address}</span> <CopyBtn text={address} label="Copy address" what="Address" />{" "}
            <button type="button" className="btn sm" aria-expanded={qr} onClick={() => setQr(!qr)}>
              {qr ? "Hide QR code" : "QR code"}
            </button>
            {qr ? (
              <div className="qrbox" style={{ marginTop: 8 }}>
                <Qr text={address} label="QR code of your address" />
              </div>
            ) : null}
            <p className="muted small">Safe to share. People use it to send you files; it never lets anyone spend your funds.</p>
          </dd>
          <dt>Balance</dt>
          <dd>{bal.data === undefined ? "…" : `${fmtVault(bal.data)} VAULT`} <span className="muted small">(free test money; it has no real value)</span></dd>
        </dl>
      </section>

      <section className="panel" aria-labelledby="key-h">
        <h2 id="key-h">Receive private files</h2>
        {key.loading ? (
          <Spinner label="Checking…" />
        ) : key.data ? (
          <p className="callout good">
            <strong>Your public key is published.</strong> People can share private files with you by address.
          </p>
        ) : (
          <>
            <p>
              To lock a file for you, a sender needs your <Term k="encryption">public key</Term>. The chain only learns it after you sign your first transaction. Publishing costs a tiny fee
              (about 0.002 VAULT) and takes one click. Uploading a file does it too.
            </p>
            <button type="button" className="btn primary" disabled={busy || !unlocked} onClick={publish}>
              {busy ? <Spinner label="Publishing…" /> : "Publish my key"}
            </button>
            {!unlocked ? <p className="muted small">Unlock your profile first.</p> : null}
            {bal.data !== undefined && bal.data < 2000n ? <p className="callout warn">You need a little VAULT for the fee. Get some below.</p> : null}
            <ErrorNote error={error} />
          </>
        )}
      </section>

      <section className="panel" aria-labelledby="funds-h">
        <h2 id="funds-h">Free test funds</h2>
        <FundsPanel compact />
      </section>

      <Settings vault={vault} profile={profile} />
    </div>
  );
}
