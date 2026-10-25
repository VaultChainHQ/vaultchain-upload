"use client";

import type { ReactNode } from "react";
import { errMsg } from "@/lib/errors";

export function Avatar({ name, color, size = 36 }: { name: string; color: string; size?: number }) {
  const initial = (Array.from(name.trim())[0] ?? "?").toUpperCase();
  return (
    <span className="avatar" style={{ background: color, width: size, height: size, fontSize: size * 0.45 }} aria-hidden="true">
      {initial}
    </span>
  );
}

export function ErrorNote({ error, title }: { error: unknown; title?: string }) {
  if (!error) return null;
  return (
    <p className="callout bad" role="alert">
      <strong>{title ?? "That did not work."}</strong> {typeof error === "string" ? error : errMsg(error)}
    </p>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner-row" role="status">
      <span className="spinner" aria-hidden="true" />
      {label ? <span>{label}</span> : <span className="sr-only">Working</span>}
    </span>
  );
}

export type Tone = "ok" | "warn" | "bad" | "idle" | "info";
export function Pill({ tone = "idle", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`pill ${tone}`} title={title}>
      {children}
    </span>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon ? (
        <span className="empty-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <h2>{title}</h2>
      {children ? <p className="muted">{children}</p> : null}
      {action ? <div className="row center">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="skel" style={{ height: i === 0 ? 22 : 14, width: `${90 - i * 14}%` }} />
      ))}
    </div>
  );
}

export function ProgressBar({ value, label, small }: { value: number; label: string; small?: boolean }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className={small ? "bar small" : "bar"} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}
