"use client";
import { useEffect, useRef, useState } from "react";
import { NodeClient, ProviderClient } from "./vault/client";
import { NODE_URL, PROVIDER_MODE, PROVIDER_URL } from "./vault/config";

export const node = new NodeClient(NODE_URL);
export const provider = new ProviderClient(PROVIDER_URL, PROVIDER_MODE);

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Runs `fn` now and every `ms`, and again whenever `tick` changes. Returns the latest result. */
export function usePoll<T>(fn: () => Promise<T>, ms: number, tick: unknown = 0): { data: T | undefined; error: string | undefined; reload: () => void } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [n, setN] = useState(0);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const v = await fnRef.current();
        if (alive) {
          setData(v);
          setError(undefined);
        }
      } catch (e) {
        if (alive) setError(errMsg(e));
      }
    };
    void run();
    const t = ms > 0 ? setInterval(run, ms) : undefined;
    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
  }, [ms, tick, n]);
  return { data, error, reload: () => setN((x) => x + 1) };
}

export function saveBytes(data: Uint8Array, name: string, mime: string) {
  const blob = new Blob([data as BlobPart], { type: mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function fmtVault(uvault: bigint): string {
  const whole = uvault / 1_000_000n;
  const frac = (uvault % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ["KiB", "MiB", "GiB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 2 : 1)} ${u[i]}`;
}

export function short(s: string, n = 8): string {
  return s.length > 2 * n + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s;
}
