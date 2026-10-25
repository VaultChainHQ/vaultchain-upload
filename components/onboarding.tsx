"use client";

import { useId, useState } from "react";
import {
  PALETTE,
  cleanDisplayName,
  colorForAddress,
  parseBackup,
  passphraseIssues,
  sealKeystore,
  type KeystoreEntry,
} from "@/lib/keystore";
import { session } from "@/lib/session";
import { vaultStore } from "@/lib/vaultstore";
import { hexToBytes } from "@/lib/vault/bytes";
import { generateKey, keyFromHex } from "@/lib/vault/keys";
import { errMsg } from "@/lib/hooks";
import { SITES } from "@/lib/links";
import { setBackupPrompt } from "@/lib/backup-prompt";
import { Migrate } from "./Migrate";
import { ErrorNote, Field, Spinner } from "./ui";

type Mode = "create" | "backup" | "key";

export function Onboarding({
  first,
  onCreated,
  onClose,
}: {
  first: boolean;
  /** Called after a brand-new key was generated, so the app can prompt for a backup. */
  onCreated?: (entry: KeystoreEntry) => void;
  onClose?: () => void;
}) {
  const [mode, setMode] = useState<Mode>("create");
  const tabId = useId();
  return (
    <section className="panel onboard" aria-labelledby={`${tabId}-h`}>
      <h2 id={`${tabId}-h`}>{first ? "First, create your profile" : "Add a profile"}</h2>
      {first ? (
        <>
          <p className="muted">
            Your profile is your identity on VaultChain: a name, a colour and a secret key. The key is created here, in your browser, and locked with a passphrase you
            choose. It never leaves this device. It takes about 30 seconds.
          </p>
          <NoEmailNote />
        </>
      ) : null}
      <div role="tablist" aria-label="How to add a profile" className="seg">
        {(
          [
            ["create", "Create new key"],
            ["backup", "Import a backup"],
            ["key", "Import private key"],
          ] as [Mode, string][]
        ).map(([m, label]) => (
          <button key={m} role="tab" type="button" aria-selected={mode === m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
            {label}
          </button>
        ))}
      </div>
      {first ? <Migrate /> : null}
      {mode === "create" ? <CreateForm onCreated={onCreated} onClose={onClose} /> : null}
      {mode === "backup" ? <BackupImport onClose={onClose} /> : null}
      {mode === "key" ? <KeyImport onClose={onClose} /> : null}
      {onClose ? (
        <p>
          <button type="button" className="btn sm" onClick={onClose}>
            Cancel
          </button>
        </p>
      ) : null}
    </section>
  );
}

export function NoEmailNote() {
  return (
    <details className="callout">
      <summary>
        <strong>Why there is no “log in with email”</strong>
      </summary>
      <p>
        There is no server account behind this page, so there is nothing for an email or password to log in to. Your profile exists in this browser and your key
        is the identity. That is what makes it non-custodial: nobody, including this site, can read your key, reset it, or unlock your files for you. It also means
        nobody can recover them if you lose the passphrase or the key.{" "}
        <a href={`${SITES.docs}/guides/web-vault`}>More in the docs</a>.
      </p>
    </details>
  );
}

function Passphrases({
  pass,
  setPass,
  confirm,
  setConfirm,
  label = "Passphrase",
}: {
  pass: string;
  setPass: (s: string) => void;
  confirm: string;
  setConfirm: (s: string) => void;
  label?: string;
}) {
  const issues = pass ? passphraseIssues(pass) : [];
  return (
    <>
      <Field label={label} hint="At least 12 characters. Three or four unrelated words work well.">
        <input type="password" autoComplete="new-password" spellCheck={false} value={pass} onChange={(e) => setPass(e.target.value)} required />
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
    </>
  );
}

function ColorPick({ color, setColor }: { color: string; setColor: (c: string) => void }) {
  return (
    <fieldset className="colors">
      <legend>Avatar colour</legend>
      {PALETTE.map((c) => (
        <label key={c} className={color === c ? "sw on" : "sw"} style={{ background: c }}>
          <input type="radio" name="avatar-color" value={c} checked={color === c} onChange={() => setColor(c)} />
          <span className="sr-only">{c}</span>
        </label>
      ))}
    </fieldset>
  );
}

function CreateForm({ onCreated, onClose }: { onCreated?: (e: KeystoreEntry) => void; onClose?: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const issues = passphraseIssues(pass);
    if (!cleanDisplayName(name)) return setError("Give the profile a name.");
    if (issues.length) return setError(`Passphrase: ${issues.join("; ")}.`);
    if (pass !== confirm) return setError("The passphrases do not match.");
    if (!ack) return setError("Please confirm that you understand the warning.");
    setBusy(true);
    try {
      const kp = generateKey();
      const priv = hexToBytes(kp.privHex);
      const entry = await sealKeystore(priv, pass, { name, color });
      vaultStore().addProfile(entry, true);
      session().unlock(entry.id, priv); // the session now owns (and later wipes) priv
      setPass("");
      setConfirm("");
      setBackupPrompt(entry);
      onCreated?.(entry);
      onClose?.();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="form" autoComplete="off">
      <Field label="Profile name">
        <input type="text" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="e.g. Personal" required />
      </Field>
      <ColorPick color={color} setColor={setColor} />
      <Passphrases pass={pass} setPass={setPass} confirm={confirm} setConfirm={setConfirm} />
      <p className="callout bad">
        <strong>Devnet warning.</strong> If you forget this passphrase, or clear this browser&apos;s data without keeping an encrypted backup, the key is gone and so
        are any funds and encrypted files tied to it. Nobody can reset it. This network is experimental and unaudited: use it for testing only.
      </p>
      <label className="check">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <span>I understand that a lost passphrase or key cannot be recovered.</span>
      </label>
      <ErrorNote error={error} />
      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? <Spinner label="Generating and encrypting the key…" /> : "Create profile"}
      </button>
    </form>
  );
}

function BackupImport({ onClose }: { onClose?: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    setError(null);
    setInfo(null);
    if (!f) return;
    try {
      if (f.size > 1_000_000) throw new Error("that file is too large to be a keystore backup");
      const entries = parseBackup(await f.text());
      const store = vaultStore();
      const have = store.snapshot().profiles;
      let added = 0;
      let skipped = 0;
      for (const en of entries) {
        if (have.some((p) => p.entry.id === en.id || p.entry.address === en.address)) {
          skipped++;
          continue;
        }
        store.addProfile(en, added === 0);
        added++;
      }
      setInfo(
        `Imported ${added} profile${added === 1 ? "" : "s"}${skipped ? `, skipped ${skipped} that already exist here` : ""}. Unlock with the passphrase it was created with.`,
      );
      if (added) onClose?.();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  return (
    <div className="form">
      <p className="muted">
        Choose an encrypted backup file exported from this site or from the{" "}
        <a href={SITES.vault}>web vault</a> (<code>vaultchain-keystore-….json</code>): the same file works in both. It stays encrypted: you unlock it afterwards with its
        passphrase. Nothing is uploaded.
      </p>
      <Field label="Backup file">
        <input type="file" accept="application/json,.json" onChange={onFile} />
      </Field>
      <ErrorNote error={error} />
      {info ? <p className="callout good">{info}</p> : null}
    </div>
  );
}

function KeyImport({ onClose }: { onClose?: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[1]);
  const [hex, setHex] = useState("");
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const issues = passphraseIssues(pass);
    if (!cleanDisplayName(name)) return setError("Give the profile a name.");
    if (issues.length) return setError(`Passphrase: ${issues.join("; ")}.`);
    if (pass !== confirm) return setError("The passphrases do not match.");
    setBusy(true);
    let priv: Uint8Array | undefined;
    try {
      const kp = keyFromHex(hex);
      priv = hexToBytes(kp.privHex);
      const entry = await sealKeystore(priv, pass, { name, color: color || colorForAddress(kp.address) });
      vaultStore().addProfile(entry, true);
      setHex("");
      setPass("");
      setConfirm("");
      onClose?.();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      priv?.fill(0);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="form" autoComplete="off">
      <p className="callout bad">
        Only paste a key that is meant for this devnet. Never paste a key that controls real money into any web page. The key is encrypted in this browser and not
        sent anywhere, but a browser extension or a compromised device could still read what you type.
      </p>
      <Field label="Profile name">
        <input type="text" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <ColorPick color={color} setColor={setColor} />
      <Field label="Private key (64 hex characters)">
        <input type="password" autoComplete="off" spellCheck={false} value={hex} onChange={(e) => setHex(e.target.value)} required />
      </Field>
      <Passphrases pass={pass} setPass={setPass} confirm={confirm} setConfirm={setConfirm} label="New passphrase for this profile" />
      <ErrorNote error={error} />
      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? <Spinner label="Encrypting…" /> : "Import key"}
      </button>
    </form>
  );
}
