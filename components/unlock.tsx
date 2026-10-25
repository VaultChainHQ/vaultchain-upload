"use client";

import { useState } from "react";
import { WrongPassphraseError, openKeystore } from "@/lib/keystore";
import { session } from "@/lib/session";
import type { ProfileRecord } from "@/lib/vaultstore";
import { errMsg } from "@/lib/hooks";
import { Avatar, ErrorNote, Field, Spinner } from "./ui";

export function UnlockPanel({ profile }: { profile: ProfileRecord }) {
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { entry } = profile;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const priv = await openKeystore(entry, pass);
      session().unlock(entry.id, priv);
      setPass("");
    } catch (err) {
      setError(err instanceof WrongPassphraseError ? "Wrong passphrase, or this profile was modified." : errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel unlock" onSubmit={submit} autoComplete="off">
      <h2>
        <Avatar name={entry.name} color={entry.color} size={28} /> Unlock {entry.name}
      </h2>
      <p className="muted">
        Enter your passphrase to use this profile. Your key is opened in this tab only and wiped when you lock, when the timer runs out, or when you leave the page.
        It takes about a second.
      </p>
      <Field label="Passphrase">
        <input type="password" autoComplete="current-password" spellCheck={false} value={pass} onChange={(e) => setPass(e.target.value)} autoFocus required />
      </Field>
      <ErrorNote error={error} />
      <button className="btn primary" type="submit" disabled={busy || !pass}>
        {busy ? <Spinner label="Deriving key…" /> : "Unlock"}
      </button>
    </form>
  );
}
