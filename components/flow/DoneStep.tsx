"use client";

import Link from "next/link";
import { useState } from "react";
import { flowStore, type FileItem, type FlowState } from "@/lib/flow";
import { explorerFileUrl } from "@/lib/links";
import { shareLink } from "@/lib/library";
import { fmtBytes, short } from "@/lib/format";
import { CopyBtn } from "../CopyText";
import { Qr } from "../Qr";

/** Step 7: a link that works, a code to scan, and what to do next. */
export function DoneStep({ state }: { state: FlowState }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const priv = state.privacy === "private";
  const done = state.items.filter((i) => i.status === "done" && i.result);
  return (
    <div className="stack">
      <p className="callout good" role="status">
        <strong>{done.length === 1 ? "Your file is stored." : `${done.length} files are stored.`}</strong>{" "}
        {priv ? "It is locked, so only you can open it for now." : "Anyone with the link can download it."}
      </p>
      <ul className="plain results">
        {done.map((it) => (
          <Result key={it.id} item={it} origin={origin} priv={priv} />
        ))}
      </ul>
      <section aria-labelledby="next-h">
        <h3 id="next-h">What next?</h3>
        <ul className="next">
          {priv ? (
            <li>
              <strong>Share it with someone:</strong> open <Link href={done[0] ? `/files?open=${done[0].result!.root}` : "/files"}>My files</Link> and choose Share. They will need a profile on this site, and to have sent one transaction, so we can lock the file to them.
            </li>
          ) : (
            <li>
              <strong>Send the link.</strong> The person opens it, makes a free profile (no email needed) and presses Download.
            </li>
          )}
          <li>
            <strong>Check on it later</strong> in <Link href="/files">My files</Link>. It shows how long the storage lasts and if the provider is keeping up.
          </li>
          <li>
            <strong>Back up your profile</strong> from the <Link href="/account">Account page</Link> if you have not yet. It is the only way to open private files on another device.
          </li>
        </ul>
      </section>
      <div className="row step-actions">
        <button type="button" className="btn primary" onClick={() => (flowStore().dispatch({ type: "reset" }), flowStore().dispatch({ type: "goto", step: "files" }))}>
          Upload more files
        </button>
        <Link href="/files" className="btn">
          Go to My files
        </Link>
      </div>
    </div>
  );
}

function Result({ item, origin, priv }: { item: FileItem; origin: string; priv: boolean }) {
  const [qr, setQr] = useState(false);
  const r = item.result!;
  const link = shareLink(r.root, origin);
  return (
    <li className="result">
      <div className="result-head">
        <strong className="wrap-any">{item.file.name}</strong>
        <span className="muted small">{fmtBytes(r.size)} · {r.encrypted ? "private" : "public"}</span>
      </div>
      <label className="sr-only" htmlFor={`link-${item.id}`}>Link to {item.file.name}</label>
      <div className="linkbox">
        <input id={`link-${item.id}`} readOnly value={link} onFocus={(e) => e.currentTarget.select()} data-testid="share-link" />
        <CopyBtn text={link} label="Copy link" what="Link" className="btn primary sm" />
      </div>
      {priv ? <p className="muted small">This link opens the file in My files for you. Others cannot open it unless you share the file with them.</p> : null}
      <div className="row">
        <button type="button" className="btn sm" aria-expanded={qr} onClick={() => setQr(!qr)}>
          {qr ? "Hide QR code" : "Show QR code"}
        </button>
        <a className="btn sm" href={explorerFileUrl(r.root)} target="_blank" rel="noopener noreferrer">
          View in the explorer
        </a>
        <span className="muted small mono" title={r.root}>ID {short(r.root, 8, 6)}</span>
      </div>
      {qr ? (
        <div className="qrbox">
          <Qr text={link} label={`QR code for the link to ${item.file.name}`} />
          <p className="muted small">Scan to open this link on another device.</p>
        </div>
      ) : null}
    </li>
  );
}
