"use client";

import { useState, useSyncExternalStore } from "react";
import { passphraseIssues, sealKeystore, colorForAddress } from "@/lib/keystore";
import { errMsg, useVault } from "@/lib/hooks";
import { session } from "@/lib/session";
import { short } from "@/lib/format";
import { toast } from "@/lib/toast";
import { hexToBytes } from "@/lib/vault/bytes";
import { clearLegacy, legacyAccounts, readLegacyRaw, type LegacyAccount } from "@/lib/wallet";
import { vaultStore } from "@/lib/vaultstore";
import { ErrorNote, Field, Spinner } from "./ui";

// Older versions of this site kept keys as plain hex in localStorage. This finds them and offers to lock each one with a passphrase.
const subs = new Set<() => void>();
let rev = 0;
const bump = () => {
  rev++;
  subs.forEach((l) => l());
};
const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => subs.delete(cb);
};

export function useLegacy(): { raw: string | null; pending: LegacyAccount[]; hasAny: boolean } {
  const vault = useVault();
  useSyncExternalStore(subscribe, () => rev, () => 0);
  const raw = typeof window === "undefined" ? null : readLegacyRaw();
  const have = new Set(vault.profiles.map((p) => p.entry.address));
  const all = legacyAccounts(raw);
  return { raw, pending: legacyAccounts(raw, have), hasAny: all.length > 0 };
}

export function Migrate() {
  const { pending, hasAny } = useLegacy();
  const [discard, setDiscard] = useState(false);
  if (!hasAny) return null;

  if (pending.length === 0) {
    return (
      <section className="callout good" aria-label="Old keys moved">
        <strong>Your old keys are safely locked now.</strong> A plain-text copy from the earlier version of this site is still in this browser. Delete it so nobody with access to this
        browser can read it.{" "}
        <button
          type="button"
          className="btn sm primary"
          onClick={() => {
            clearLegacy();
            bump();
            toast("The old plain-text copy was deleted.", "good");
          }}
        >
          Delete the old copy
        </button>
      </section>
    );
  }

  return (
    <section className="panel migrate" aria-labelledby="migrate-h">
      <h2 id="migrate-h">We found {pending.length === 1 ? "a key" : `${pending.length} keys`} saved the old way</h2>
      <p className="muted">
        An earlier version of this site kept keys in this browser as unprotected text. Lock {pending.length === 1 ? "it" : "each one"} with a passphrase to keep using the same
        address, funds and files. Nothing is sent anywhere.
      </p>
      <ul className="plain">
        {pending.map((a) => (
          <li key={a.address}>
            <MigrateOne acct={a} />
          </li>
        ))}
      </ul>
      <p className="muted small">
        Don&apos;t need {pending.length === 1 ? "it" : "them"}?{" "}
        {discard ? (
          <>
            This permanently deletes the old copy. If you have not saved the key anywhere, the address and anything on it are lost.{" "}
            <button
              type="button"
              className="btn sm danger"
              onClick={() => {
                clearLegacy();
                bump();
                toast("The old keys were deleted from this browser.", "info");
              }}
            >
              Yes, delete them
            </button>{" "}
            <button type="button" className="btn sm" onClick={() => setDiscard(false)}>
              Keep them
            </button>
          </>
        ) : (
          <button type="button" className="btn sm" onClick={() => setDiscard(true)}>
            Delete without moving
          </button>
        )}
      </p>
    </section>
  );
}

function MigrateOne({ acct }: { acct: LegacyAccount }) {
  const [open, setOpen] = useState(false);
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const issues = pass ? passphraseIssues(pass) : [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (issues.length) return setError(`Passphrase: ${issues.join("; ")}.`);
    if (pass !== confirm) return setError("The passphrases do not match.");
    setBusy(true);
    const priv = hexToBytes(acct.privHex);
    try {
      const entry = await sealKeystore(priv, pass, { name: acct.name || "Imported", color: colorForAddress(acct.address) });
      vaultStore().addProfile(entry, true);
      session().unlock(entry.id, priv);
      toast(`“${entry.name}” is locked with your passphrase and ready to use.`, "good");
      bump();
    } catch (err) {
      priv.fill(0);
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="migrate-one">
      <div className="row between">
        <span>
          <strong>{acct.name || "Unnamed key"}</strong> <span className="mono muted small">{short(acct.address, 14, 6)}</span>
        </span>
        {!open ? (
          <button type="button" className="btn sm primary" onClick={() => setOpen(true)}>
            Lock with a passphrase
          </button>
        ) : null}
      </div>
      {open ? (
        <form onSubmit={submit} className="form" autoComplete="off">
          <Field label="New passphrase" hint="At least 12 characters. Three or four unrelated words work well.">
            <input type="password" autoComplete="new-password" spellCheck={false} value={pass} onChange={(e) => setPass(e.target.value)} autoFocus required />
          </Field>
          {issues.length ? (
            <ul className="issues" aria-live="polite">
              {issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          ) : null}
          <Field label="Repeat passphrase">
            <input type="password" autoComplete="new-password" spellCheck={false} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </Field>
          <ErrorNote error={error} />
          <div className="row">
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? <Spinner label="Locking…" /> : "Lock this key"}
            </button>
            <button className="btn" type="button" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
