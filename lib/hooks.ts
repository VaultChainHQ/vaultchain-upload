"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { errMsg } from "./errors";
import { session, type Unlocked } from "./session";
import { NodeClient, ProviderClient } from "./vault/client";
import { NODE_URL, PROVIDER_MODE, PROVIDER_URL } from "./vault/config";
import { EMPTY_VAULT, vaultStore, type ProfileRecord, type VaultData } from "./vaultstore";

export const node = new NodeClient(NODE_URL);
export const provider = new ProviderClient(PROVIDER_URL, PROVIDER_MODE);

export function useVault(): VaultData {
  const s = vaultStore();
  return useSyncExternalStore(s.subscribe, s.snapshot, () => EMPTY_VAULT);
}

export function useUnlocked(): Unlocked | null {
  const s = session();
  return useSyncExternalStore(s.subscribe, s.snapshot, () => null);
}

export function activeProfile(v: VaultData): ProfileRecord | undefined {
  return v.profiles.find((p) => p.entry.id === v.activeId);
}

const noop = () => () => {};
/** False during server rendering and the first client render, true afterwards (avoids hydration mismatches for localStorage-backed UI). */
export function useMounted(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}

/** The unlocked session, but only when it belongs to the active profile. */
export function useAccount(): { vault: VaultData; profile: ProfileRecord | undefined; unlocked: Unlocked | null; mounted: boolean } {
  const vault = useVault();
  const u = useUnlocked();
  const mounted = useMounted();
  const profile = activeProfile(vault);
  return { vault, profile, unlocked: u && profile && u.profileId === profile.entry.id ? u : null, mounted };
}

export interface Polled<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
  /** Milliseconds since the last successful load. */
  updatedAt: number | undefined;
}

/** Poll an async function. `key` identifies the query: change it to refetch immediately. Polling pauses while the tab is hidden. */
export function usePoll<T>(key: string, fn: () => Promise<T>, ms = 0): Polled<T> {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const [state, setState] = useState<{ key: string; data?: T; error: string | null; at?: number }>({ key, error: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let dead = false;
    async function run() {
      try {
        const d = await fnRef.current();
        if (!dead) setState({ key, data: d, error: null, at: Date.now() });
      } catch (e) {
        if (!dead) setState((s) => ({ key, data: s.key === key ? s.data : undefined, error: errMsg(e), at: s.key === key ? s.at : undefined }));
      }
    }
    void run();
    const t =
      ms > 0
        ? setInterval(() => {
            if (document.visibilityState === "visible") void run();
          }, ms)
        : undefined;
    return () => {
      dead = true;
      if (t) clearInterval(t);
    };
  }, [key, ms, tick]);

  const current = state.key === key;
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return {
    data: current ? state.data : undefined,
    error: current ? state.error : null,
    loading: !current || (state.data === undefined && state.error === null),
    reload,
    updatedAt: current ? state.at : undefined,
  };
}

/** Re-renders every `ms` while `active`. */
export function useNow(active = true, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}

/** Hands bytes to the browser as a download. The file is never rendered inline, so a hostile file cannot run script on this origin. */
export function saveBytes(data: Uint8Array, name: string, mime = "application/octet-stream") {
  saveBlob(new Blob([data as BlobPart]), name, mime);
}

export function saveBlob(source: Blob, name: string, mime = "application/octet-stream") {
  const blob = source.type === mime ? source : source.slice(0, source.size, mime);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function saveText(text: string, name: string) {
  saveBytes(new TextEncoder().encode(text), name, "application/json");
}

export { errMsg };

const lastBalance = new Map<string, bigint>();

/** The balance in uvault of an address (undefined until the first answer), refreshed every few seconds. Every copy on the page refreshes when any one sees a change. */
export function useBalance(address: string | undefined, ms = 6000): Polled<bigint> {
  const q = usePoll(
    `bal:${address ?? ""}`,
    async () => {
      if (!address) return 0n;
      const b = await node.balance(address, "uvault");
      const prev = lastBalance.get(address);
      lastBalance.set(address, b);
      if (prev !== undefined && prev !== b && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("vc:balance", { detail: address }));
      return b;
    },
    address ? ms : 0,
  );
  const { reload } = q;
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent).detail === address) reload();
    };
    window.addEventListener("vc:balance", on);
    return () => window.removeEventListener("vc:balance", on);
  }, [address, reload]);
  return q;
}
