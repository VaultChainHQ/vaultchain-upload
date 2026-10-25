"use client";

import { useEffect, useState } from "react";
import { PALETTE, WrongPassphraseError, changePassphrase, exportBackup, openKeystore, passphraseIssues } from "@/lib/keystore";
import { session } from "@/lib/session";
import { AUTO_LOCK_CHOICES, vaultStore, type ProfileRecord, type VaultData } from "@/lib/vaultstore";
import { bytesToHex } from "@/lib/vault/bytes";
import { errMsg, saveText } from "@/lib/hooks";
import { SITES } from "@/lib/links";
import { toast } from "@/lib/toast";
import { CopyBtn } from "./CopyText";
import { Avatar, ErrorNote, Field, Spinner } from "./ui";

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "profile";
}

export function backupFilename(name: string): string {
  return `vaultchain-keystore-${slug(name)}-${new Date().toISOString().slice(0, 10)}.json`;
}

export function Settings({ vault, profile }: { vault: VaultData; profile: ProfileRecord }) {
  const e = profile.entry;
  return (
    <div className="stack">
      <ProfileSettings profile={profile} />
      <BackupSettings vault={vault} profile={profile} />
      <div className="panel">
        <h2>Auto-lock</h2>
        <Field label="Lock after this much inactivity" hint="The key is also wiped when you close or leave the page, and the app locks when a hidden tab was away longer than this.">
          <select value={vault.settings.autoLockMinutes} onChange={(ev) => vaultStore().setAutoLock(Number(ev.target.value))}>
            {AUTO_LOCK_CHOICES.map((m) => (
              <option key={m} value={m}>
                {m} minute{m === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <RevealKey profile={profile} />
      <PassphraseChange profile={profile} />
      <div className="panel">
        <h2>How this profile is protected</h2>
        <dl className="kv">
          <dt>Key</dt>
          <dd>secp256k1 private key, 32 bytes</dd>
          <dt>Passphrase to key</dt>
          <dd className="mono">
            scrypt N={e.kdf.N.toLocaleString("en-US")} r={e.kdf.r} p={e.kdf.p} ({Math.round((128 * e.kdf.N * e.kdf.r) / (1024 * 1024))} MiB), 32-byte random salt
          </dd>
          <dt>Encryption</dt>
          <dd className="mono">AES-256-GCM, 12-byte random IV</dd>
          <dt>Authenticated</dt>
          <dd>profile id, address, public key and the KDF parameters, so editing them breaks decryption</dd>
          <dt>Stored</dt>
          <dd>this browser&apos;s localStorage only</dd>
        </dl>
      </div>
      <DeleteProfile profile={profile} />
    </div>
  );
}

function ProfileSettings({ profile }: { profile: ProfileRecord }) {
  const e = profile.entry;
  const [name, setName] = useState(e.name);
  const [color, setColor] = useState(e.color);
  return (
    <form
      className="panel"
      onSubmit={(ev) => {
        ev.preventDefault();
        vaultStore().editProfile(e.id, name, color);
        toast("Profile saved.", "good");
      }}
    >
      <h2>Profile</h2>
      <div className="row">
        <Avatar name={name} color={color} size={48} />
        <Field label="Name">
          <input type="text" value={name} maxLength={40} onChange={(ev) => setName(ev.target.value)} required />
        </Field>
      </div>
      <fieldset className="colors">
        <legend>Avatar colour</legend>
        {PALETTE.map((c) => (
          <label key={c} className={color === c ? "sw on" : "sw"} style={{ background: c }}>
            <input type="radio" name="edit-color" value={c} checked={color === c} onChange={() => setColor(c)} />
            <span className="sr-only">{c}</span>
          </label>
        ))}
      </fieldset>
      <p className="muted small">Name and colour are labels only. They are stored with the profile but are not part of its encryption.</p>
      <button className="btn" type="submit">
        Save
      </button>
    </form>
  );
}

function BackupSettings({ vault, profile }: { vault: VaultData; profile: ProfileRecord }) {
  return (
    <div className="panel">
      <h2>Encrypted backup</h2>
      <p>
        A backup file holds the same encrypted key you see here, not the key itself. Anyone with the file can try to guess the passphrase offline, so keep it somewhere private and
        use a strong passphrase. You need both the file and the passphrase to restore.
      </p>
      <p>
        <button type="button" className="btn primary" onClick={() => saveText(exportBackup([profile.entry]), backupFilename(profile.entry.name))}>
          Download backup of {profile.entry.name}
        </button>{" "}
        {vault.profiles.length > 1 ? (
          <button type="button" className="btn" onClick={() => saveText(exportBackup(vault.profiles.map((p) => p.entry)), backupFilename("all-profiles"))}>
            Download all {vault.profiles.length} profiles
          </button>
        ) : null}
      </p>
      <p className="muted small">Contacts are not included in backups. Restore a backup with “Add profile → Import a backup”. A backup from this site also opens in the <a href={SITES.vault}>web vault</a>, and the other way round.</p>
    </div>
  );
}

function RevealKey({ profile }: { profile: ProfileRecord }) {
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hex, setHex] = useState<string | null>(null);

  useEffect(() => {
    if (!hex) return;
    const t = setTimeout(() => setHex(null), 30_000);
    return () => clearTimeout(t);
  }, [hex]);

  async function reveal(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const priv = await openKeystore(profile.entry, pass);
      setHex(bytesToHex(priv));
      priv.fill(0);
      setPass("");
    } catch (err) {
      setError(err instanceof WrongPassphraseError ? "Wrong passphrase." : errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={reveal} autoComplete="off">
      <h2>Reveal private key</h2>
      <p className="callout bad">
        Anyone who sees this key controls this account and its funds. Do not paste it into chats, tickets or other sites. It hides again after 30 seconds, but the text may remain
        in your clipboard or screen recordings.
      </p>
      {hex ? (
        <div>
          <p className="mono wrap-any key-reveal">{hex}</p>
          <CopyBtn text={hex} label="Copy key" what="Key" />{" "}
          <button type="button" className="btn sm" onClick={() => setHex(null)}>
            Hide
          </button>
        </div>
      ) : (
        <>
          <Field label="Re-enter the passphrase">
            <input type="password" autoComplete="current-password" spellCheck={false} value={pass} onChange={(ev) => setPass(ev.target.value)} required />
          </Field>
          <ErrorNote error={error} />
          <button className="btn" type="submit" disabled={busy || !pass}>
            {busy ? <Spinner label="Deriving key…" /> : "Reveal"}
          </button>
        </>
      )}
    </form>
  );
}

function PassphraseChange({ profile }: { profile: ProfileRecord }) {
  const [oldP, setOld] = useState("");
  const [newP, setNew] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    setOk(false);
    const issues = passphraseIssues(newP);
    if (issues.length) return setError(`New passphrase: ${issues.join("; ")}.`);
    if (newP !== again) return setError("The new passphrases do not match.");
    setBusy(true);
    try {
      const next = await changePassphrase(profile.entry, oldP, newP);
      vaultStore().replaceEntry(next);
      toast("Passphrase changed.", "good");
      setOld("");
      setNew("");
      setAgain("");
      setOk(true);
    } catch (err) {
      setError(err instanceof WrongPassphraseError ? "The current passphrase is wrong." : errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit} autoComplete="off">
      <h2>Change passphrase</h2>
      <Field label="Current passphrase">
        <input type="password" autoComplete="current-password" spellCheck={false} value={oldP} onChange={(ev) => setOld(ev.target.value)} required />
      </Field>
      <Field label="New passphrase">
        <input type="password" autoComplete="new-password" spellCheck={false} value={newP} onChange={(ev) => setNew(ev.target.value)} required />
      </Field>
      <Field label="Repeat new passphrase">
        <input type="password" autoComplete="new-password" spellCheck={false} value={again} onChange={(ev) => setAgain(ev.target.value)} required />
      </Field>
      <ErrorNote error={error} />
      {ok ? (
        <p className="callout good" role="status">
          Passphrase changed. Older backup files still need the <em>old</em> passphrase, so download a fresh backup.
        </p>
      ) : null}
      <button className="btn" type="submit" disabled={busy}>
        {busy ? <Spinner label="Re-encrypting…" /> : "Change passphrase"}
      </button>
    </form>
  );
}

function DeleteProfile({ profile }: { profile: ProfileRecord }) {
  const [typed, setTyped] = useState("");
  return (
    <div className="panel danger-zone">
      <h2>Delete profile from this browser</h2>
      <p>
        This removes the encrypted key and the contacts of <strong>{profile.entry.name}</strong> from this browser. Without a backup file and its passphrase the key is lost for good,
        along with any funds and encrypted files that depend on it. Files stored on chain stay there.
      </p>
      <Field label={`Type “${profile.entry.name}” to confirm`}>
        <input type="text" value={typed} onChange={(ev) => setTyped(ev.target.value)} />
      </Field>
      <button
        type="button"
        className="btn danger"
        disabled={typed !== profile.entry.name}
        onClick={() => {
          session().lock();
          vaultStore().removeProfile(profile.entry.id);
        }}
      >
        Delete this profile
      </button>
    </div>
  );
}
