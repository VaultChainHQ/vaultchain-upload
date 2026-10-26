"use client";

import { useEffect, useRef, useState } from "react";
import type { Unlocked } from "@/lib/session";
import type { ProfileRecord } from "@/lib/vaultstore";
import type { Deal, ManifestRecord } from "@/lib/vault/client";
import { fmtAgo, fmtBytes, fmtDuration, short } from "@/lib/format";
import { fileHealth, shareLink } from "@/lib/library";
import { explorerFileUrl } from "@/lib/links";
import { CopyBtn } from "../CopyText";
import { Qr } from "../Qr";
import { Pill, type Tone } from "../ui";
import { Term } from "../Term";
import { FileActions } from "./Download";
import { ExtendPanel } from "./ExtendPanel";
import { SharePanel } from "./SharePanel";

export function healthTone(level: Tone): Tone {
  return level;
}

function DealLine({ d, height }: { d: Deal; height: number | undefined }) {
  const left = height !== undefined ? d.expire_height - height : undefined;
  const proving = d.replicas.filter((r) => (r.last_proven_height ?? 0) > 0).length;
  return (
    <li>
      <strong>Deal #{d.id}</strong> · {d.status} · {d.replicas.length} of {d.replication} cop{d.replication === 1 ? "y" : "ies"} placed · {proving} proving
      {(d.status === "open" || d.status === "pending") && left !== undefined ? ` · ${left > 0 ? `paid for ${fmtDuration(left)} more` : "past its paid term"}` : ""}
    </li>
  );
}

/** One file in the library: the essentials on one line, everything else a click away. */
export function FileRow({
  rec,
  deals,
  height,
  profile,
  unlocked,
  opened,
  onChanged,
}: {
  rec: ManifestRecord;
  deals: Deal[];
  height: number | undefined;
  profile: ProfileRecord;
  unlocked: Unlocked | null;
  opened?: boolean;
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState(!!opened);
  const [qr, setQr] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  const h = fileHealth(deals, height);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const link = shareLink(rec.root, origin);
  useEffect(() => {
    if (opened) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [opened]);

  return (
    <li ref={ref} className={opened ? "file opened" : "file"} id={`f-${rec.root}`} data-testid="file-row">
      <div className="file-head">
        <div className="file-main">
          <span className="file-title">{rec.name || "(unnamed)"}</span>
          <span className="file-meta">
            {rec.encryption ? <Pill tone="info">Private</Pill> : <Pill tone="warn">Public</Pill>}
            <Pill tone={healthTone(h.level)} title={h.why}>
              {h.label}
            </Pill>
            <span>{fmtBytes(rec.size)}</span>
            {height !== undefined ? <span>added {fmtAgo(height - rec.height)}</span> : null}
          </span>
        </div>
        <div className="file-actions">
          <FileActions root={rec.root} unlocked={unlocked} name={rec.name} mime={rec.mime} size={rec.size} profile={profile} />
          <button type="button" className="btn sm" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Close" : "Share & details"}
          </button>
        </div>
      </div>
      {open ? (
        <div className="file-body">
          <p className="muted small" style={{ margin: 0 }}>{h.why}</p>
          <div>
            <h4>Link</h4>
            <div className="linkbox">
              <input readOnly value={link} aria-label={`Link to ${rec.name}`} onFocus={(e) => e.currentTarget.select()} />
              <CopyBtn text={link} label="Copy link" what="Link" className="btn sm primary" />
              <button type="button" className="btn sm" aria-expanded={qr} onClick={() => setQr(!qr)}>
                {qr ? "Hide QR code" : "QR code"}
              </button>
            </div>
            {qr ? (
              <div className="qrbox" style={{ marginTop: 10 }}>
                <Qr text={link} label={`QR code for the link to ${rec.name}`} />
              </div>
            ) : null}
            <p className="muted small">{rec.encryption ? "Opening the link only helps people you share this file with, below." : "Anyone with this link can download the file while public access is on."}</p>
          </div>
          <SharePanel rec={rec} profile={profile} unlocked={unlocked} height={height} />
          <div>
            <h4>Storage</h4>
            {deals.length ? (
              <ul className="plain">
                {deals.map((d) => (
                  <DealLine key={d.id} d={d} height={height} />
                ))}
              </ul>
            ) : (
              <p className="callout bad">No <Term k="deal">deal</Term> exists for this file, so nobody is paid to keep it.</p>
            )}
            {rec.owner === profile.entry.address && deals.length ? <ExtendPanel rec={rec} unlocked={unlocked} onChanged={() => onChanged?.()} /> : null}
          </div>
          <p className="muted small">
            File ID <span className="mono">{short(rec.root, 12, 8)}</span> <CopyBtn text={rec.root} label="Copy" what="File ID" /> ·{" "}
            <a href={explorerFileUrl(rec.root)} target="_blank" rel="noopener noreferrer">
              View in the explorer
            </a>
          </p>
        </div>
      ) : null}
    </li>
  );
}
