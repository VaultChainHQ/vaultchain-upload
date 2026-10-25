"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { backupPromptSnapshot, backupPromptSubscribe, setBackupPrompt } from "@/lib/backup-prompt";
import { exportBackup } from "@/lib/keystore";
import { fmtVault, short } from "@/lib/format";
import { saveText, useAccount, useBalance, useNow } from "@/lib/hooks";
import { session } from "@/lib/session";
import { vaultStore } from "@/lib/vaultstore";
import { CopyBtn } from "./CopyText";
import { Migrate } from "./Migrate";
import { Onboarding } from "./onboarding";
import { backupFilename } from "./Settings";
import { Avatar } from "./ui";
import { UnlockPanel } from "./unlock";

function mmss(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The strip under the header: who you are, what you have, whether the key is open, plus one-off prompts (back up, old keys). */
export function ProfileBar() {
  const { vault, profile, unlocked, mounted } = useAccount();
  const bal = useBalance(profile?.entry.address);
  const backup = useSyncExternalStore(backupPromptSubscribe, backupPromptSnapshot, () => null);
  const [adding, setAdding] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const path = usePathname();
  const now = useNow(!!unlocked);
  void now;
  const menu = useRef<HTMLDetailsElement>(null);

  // Close the switcher on outside click or Escape.
  useEffect(() => {
    const close = (e: Event) => {
      if (menu.current?.open && e.target instanceof Node && !menu.current.contains(e.target)) menu.current.open = false;
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  if (!mounted) return <div className="profilebar-ph" aria-hidden="true" />;
  if (!profile) {
    return (
      <div className="wrap">
        <Migrate />
      </div>
    );
  }

  const e = profile.entry;
  function pick(id: string) {
    if (menu.current) menu.current.open = false;
    if (id === e.id) return;
    session().lock();
    vaultStore().setActive(id);
  }

  return (
    <div className="profilebar">
      <div className="wrap profilebar-row">
        <details className="switcher" ref={menu}>
          <summary aria-label={`Profile: ${e.name}. Switch profile`}>
            <Avatar name={e.name} color={e.color} size={32} />
            <span className="chip-text">
              <strong>{e.name}</strong>
              <small className="mono">{short(e.address, 10, 4)}</small>
            </span>
            <span aria-hidden="true">▾</span>
          </summary>
          <div className="pop" role="menu">
            {vault.profiles.map((p) => (
              <button key={p.entry.id} role="menuitemradio" aria-checked={p.entry.id === e.id} type="button" className={p.entry.id === e.id ? "menu-item on" : "menu-item"} onClick={() => pick(p.entry.id)}>
                <Avatar name={p.entry.name} color={p.entry.color} size={26} />
                <span className="chip-text">
                  <strong>{p.entry.name}</strong>
                  <small className="mono">{short(p.entry.address, 10, 4)}</small>
                </span>
              </button>
            ))}
            <button
              type="button"
              className="menu-item add"
              onClick={() => {
                if (menu.current) menu.current.open = false;
                setAdding(true);
              }}
            >
              + Add or import a profile
            </button>
            <Link href="/account" className="menu-item" onClick={() => menu.current && (menu.current.open = false)}>
              Account, backup &amp; settings
            </Link>
          </div>
        </details>
        <span className="pb-addr">
          <CopyBtn text={e.address} label="Copy address" what="Address" />
        </span>
        <span className="pb-bal" title="Your devnet balance">
          <span className="muted small">Balance</span> <strong>{bal.data === undefined ? "…" : `${fmtVault(bal.data)} VAULT`}</strong>
        </span>
        <span className="pb-lock" role="status">
          {unlocked ? (
            <>
              <span className="lockdot open" aria-hidden="true" /> Unlocked <span className="muted small">· locks in <span className="mono">{mmss(session().remainingMs())}</span></span>{" "}
              <button type="button" className="btn sm" onClick={() => session().lock()}>
                Lock
              </button>
            </>
          ) : (
            <>
              <span className="lockdot" aria-hidden="true" /> Locked{" "}
              {path !== "/" ? (
                <button type="button" className="btn sm primary" aria-expanded={unlocking} onClick={() => setUnlocking(!unlocking)}>
                  Unlock
                </button>
              ) : null}
            </>
          )}
        </span>
      </div>
      {adding || backup || (unlocking && !unlocked && path !== "/") ? (
        <div className="wrap profilebar-extra">
          {unlocking && !unlocked && path !== "/" ? <UnlockPanel profile={profile} /> : null}
          {adding ? <Onboarding first={false} onClose={() => setAdding(false)} /> : null}
          {backup ? (
            <div className="callout good" role="status">
              <strong>Back up “{backup.name}” now.</strong> Download the encrypted backup and keep it somewhere safe, away from this browser. If this browser&apos;s data is cleared, the
              backup and your passphrase are the only way back in.{" "}
              <button type="button" className="btn sm primary" onClick={() => saveText(exportBackup([backup]), backupFilename(backup.name))}>
                Download backup
              </button>{" "}
              <button type="button" className="btn sm" onClick={() => setBackupPrompt(null)}>
                I have saved it
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="wrap">
        <Migrate />
      </div>
    </div>
  );
}
