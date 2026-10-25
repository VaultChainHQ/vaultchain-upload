"use client";

import { useState } from "react";
import type { Unlocked } from "@/lib/session";
import type { ProfileRecord } from "@/lib/vaultstore";
import type { ManifestRecord } from "@/lib/vault/client";
import { grantRead, revokeRead } from "@/lib/vault/flows";
import { DURATIONS } from "@/lib/cost";
import { ADDRESS_RE, fmtWhen, short } from "@/lib/format";
import { node, usePoll } from "@/lib/hooks";
import { friendlyError } from "@/lib/errors";
import { nameFor } from "@/lib/library";
import { SITES } from "@/lib/links";
import { toast } from "@/lib/toast";
import { CopyBtn } from "../CopyText";
import { ErrorNote, Field, Pill, Spinner } from "../ui";
import { Term } from "../Term";

/** Who can open this file, and the plain-language way to add or remove people. */
export function SharePanel({ rec, profile, unlocked, height }: { rec: ManifestRecord; profile: ProfileRecord; unlocked: Unlocked | null; height: number | undefined }) {
  const grants = usePoll(`grants:${rec.root}`, () => node.grants(rec.root), 0);
  const encrypted = !!rec.encryption;
  const signer = unlocked ? { key: unlocked.key, priv: unlocked.priv } : null;
  const me = { address: profile.entry.address, name: profile.entry.name };
  const live = (grants.data ?? []).filter((g) => height === undefined || g.expiry_height > height);
  const publicGrant = live.find((g) => g.grantee === "*");
  const [who, setWho] = useState("");
  const [custom, setCustom] = useState("");
  const [blocks, setBlocks] = useState(DURATIONS[2].blocks);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState<ReturnType<typeof friendlyError> | null>(null);

  const grantee = who === "custom" ? custom.trim() : who;
  const validGrantee = ADDRESS_RE.test(grantee) && grantee !== me.address;
  const key = usePoll(`pub:${validGrantee ? grantee : "-"}`, () => (validGrantee && encrypted ? node.pubkey(grantee) : Promise.resolve("n/a")), 0);
  const needsKey = encrypted && validGrantee && !key.loading && key.data === null;

  async function run(label: string, fn: () => Promise<unknown>) {
    if (!signer) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      grants.reload();
      toast(label, "good");
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  const grant = (to: string, label: string, forBlocks = blocks) => run(label, () => grantRead(node, signer!, rec, to, (height ?? 0) + forBlocks, (s) => setStep(s)));
  const revoke = (id: number, label: string) => run(label, () => revokeRead(node, signer!, rec, { grantId: id }, (s) => setStep(s)));
  const recipient = who === "custom" ? short(custom.trim(), 10, 6) : (profile.contacts.find((c) => c.address === who)?.name ?? "them");
  const invite = `Hi! I want to share a file with you on VaultChain. Please open ${SITES.upload}/account, create a profile, press “Publish my key” and tell me your address (it starts with vault1…). Then I can share it with you.`;

  return (
    <div className="share">
      <h4>Who can open this</h4>
      {grants.loading ? (
        <Spinner label="Loading…" />
      ) : live.length ? (
        <ul className="plain grants">
          {live.map((g) => (
            <li key={g.id} className="grant">
              <span>
                {g.grantee === "*" ? <Pill tone="warn">Anyone with the link</Pill> : <strong>{nameFor(g.grantee, me, profile.contacts, (a) => short(a, 12, 6))}</strong>}{" "}
                <span className="muted small">until {fmtWhen(g.expiry_height, height)}</span>
              </span>
              <button type="button" className="btn sm danger" disabled={busy || !signer} onClick={() => revoke(g.id, g.grantee === "*" ? "Public access turned off." : "Access removed.")}>
                {g.grantee === "*" ? "Turn off" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Only you right now.</p>
      )}

      {!encrypted ? (
        publicGrant ? null : (
          <div className="callout warn">
            <p>
              <strong>This file is public, but its public link is not switched on.</strong> Turn it on so anyone with the link can download it.
            </p>
            <button type="button" className="btn sm primary" disabled={busy || !signer} onClick={() => grant("*", "Public access is on.")}>
              Turn on public access
            </button>
          </div>
        )
      ) : (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (validGrantee && !needsKey) void grant(grantee, `Shared with ${recipient}.`);
          }}
        >
          <div className="row" style={{ alignItems: "flex-end" }}>
            <Field label="Share with">
              <select value={who} onChange={(e) => setWho(e.target.value)} required>
                <option value="">Choose a person…</option>
                {profile.contacts.map((c) => (
                  <option key={c.id} value={c.address}>
                    {c.name} ({short(c.address, 10, 4)})
                  </option>
                ))}
                <option value="custom">Someone else (paste an address)…</option>
              </select>
            </Field>
            {who === "custom" ? (
              <Field label="Their address" hint={custom && !ADDRESS_RE.test(custom.trim()) ? "Addresses start with vault1…" : undefined}>
                <input type="text" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="vault1…" spellCheck={false} autoComplete="off" />
              </Field>
            ) : null}
            <Field label="Access lasts">
              <select value={blocks} onChange={(e) => setBlocks(Number(e.target.value))}>
                {DURATIONS.map((d) => (
                  <option key={d.blocks} value={d.blocks}>
                    {d.label.replace("About ", "about ")}
                  </option>
                ))}
              </select>
            </Field>
            <button type="submit" className="btn primary" disabled={busy || !signer || !validGrantee || needsKey || key.loading}>
              {busy ? <Spinner label="Sharing…" /> : "Share"}
            </button>
          </div>
          {who === "custom" && custom.trim() === me.address ? <p className="muted small">That is your own address.</p> : null}
          {needsKey ? (
            <div className="callout warn" role="status">
              <p>
                <strong>{recipient} cannot receive this yet.</strong> To lock a file for someone, the chain needs their <Term k="encryption">public key</Term>, and it only learns it after they send their first transaction. It is one click for them:
                Account → “Publish my key”.
              </p>
              <p className="row">
                <CopyBtn text={invite} label="Copy a message to send them" what="Message" className="btn sm primary" />
                <button type="button" className="btn sm" onClick={key.reload}>
                  Check again
                </button>
              </p>
            </div>
          ) : null}
        </form>
      )}
      {step ? <p className="muted small" role="status">{step}</p> : null}
      {!signer ? <p className="muted small">Unlock your profile to change who can open this file.</p> : null}
      <ErrorNote error={error ? `${error.title} ${error.hint ?? ""}` : null} />
      <p className="muted small">Removing someone stops the storage provider handing them the file within seconds. It cannot take back a copy they already downloaded.</p>
    </div>
  );
}
