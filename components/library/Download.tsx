"use client";

import { useState } from "react";
import type { Unlocked } from "@/lib/session";
import { downloadBlob } from "@/lib/vault/flows";
import { friendlyError } from "@/lib/errors";
import { node, provider, saveBlob } from "@/lib/hooks";
import { previewKind } from "@/lib/library";
import { toast } from "@/lib/toast";
import { Preview } from "../Preview";
import { ProgressBar, Spinner } from "../ui";
import type { ProfileRecord } from "@/lib/vaultstore";
import { UnlockPanel } from "../unlock";

interface Fetched {
  blob: Blob;
  name: string;
  mime: string;
  decrypted: boolean;
}

/** Download (and optionally preview) one file. Everything is verified against the on-chain root, and decrypted in the browser. */
export function FileActions({ root, unlocked, name, mime, size, profile }: { root: string; unlocked: Unlocked | null; name?: string; mime?: string; size: number; profile: ProfileRecord }) {
  const [busy, setBusy] = useState<"download" | "preview" | null>(null);
  const [step, setStep] = useState("");
  const [frac, setFrac] = useState<number | undefined>();
  const [error, setError] = useState<ReturnType<typeof friendlyError> | null>(null);
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [showUnlock, setShowUnlock] = useState(false);
  const kind = previewKind(mime ?? "", size);

  async function fetchIt(): Promise<Fetched | null> {
    if (!unlocked) {
      setShowUnlock(true);
      return null;
    }
    setError(null);
    try {
      const r = await downloadBlob({ node, provider, signer: { key: unlocked.key, priv: unlocked.priv }, root, progress: (s, f) => (setStep(s), setFrac(f)) });
      return { blob: r.blob, name: r.name || name || "download.bin", mime: r.mime || mime || "application/octet-stream", decrypted: r.decrypted };
    } catch (e) {
      setError(friendlyError(e));
      return null;
    }
  }

  async function download() {
    setBusy("download");
    const r = fetched ?? (await fetchIt());
    if (r) {
      saveBlob(r.blob, r.name);
      toast(`Saved “${r.name}”.${r.decrypted ? " It was decrypted on this device." : ""}`, "good");
    }
    setBusy(null);
    setStep("");
    setFrac(undefined);
  }

  async function preview() {
    if (fetched) return setFetched(null);
    setBusy("preview");
    const r = await fetchIt();
    if (r) setFetched(r);
    setBusy(null);
    setStep("");
    setFrac(undefined);
  }

  return (
    <div className="dl-wrap">
      <span className="dl">
        <button type="button" className="btn sm primary" onClick={download} disabled={busy !== null}>
          {busy === "download" ? <Spinner label="Downloading…" /> : unlocked ? "Download" : "Unlock to download"}
        </button>
        {kind ? (
          <button type="button" className="btn sm" onClick={preview} disabled={busy !== null} aria-expanded={!!fetched}>
            {busy === "preview" ? <Spinner label="Loading…" /> : fetched ? "Hide preview" : "Preview"}
          </button>
        ) : null}
      </span>
      {busy && step ? (
        <p className="muted small" role="status">
          {step}
          {frac !== undefined ? <ProgressBar value={frac} label="Download progress" small /> : null}
        </p>
      ) : null}
      {error ? (
        <div className="callout bad" role="alert">
          <p>
            <strong>{error.title}</strong> {error.hint}
          </p>
          <details>
            <summary>Technical details</summary>
            <pre className="detail">{error.detail}</pre>
          </details>
        </div>
      ) : null}
      {showUnlock && !unlocked ? <UnlockPanel profile={profile} /> : null}
      {fetched && kind ? (
        <div className="file-preview">
          <Preview blob={fetched.blob} name={fetched.name} kind={kind} mime={mime ?? fetched.mime} />
        </div>
      ) : null}
    </div>
  );
}
