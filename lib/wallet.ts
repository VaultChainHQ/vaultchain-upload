// Browser key storage. Keys never leave this device: they live in localStorage as plain hex
// (NOT encrypted with a passphrase). Anyone with access to this browser profile, or any script
// running on this origin, can read them. Devnet only.
import { useSyncExternalStore } from "react";
import { generateKey, keyFromHex, type KeyPair } from "./vault/keys";

export const STORAGE_KEY = "vaultchain-upload:keys:v1";

export interface StoredKey {
  name: string;
  privHex: string;
}

export interface WalletState {
  keys: StoredKey[];
  active: number;
}

const EMPTY: WalletState = { keys: [], active: -1 };

export function parseWallet(raw: string | null): WalletState {
  if (!raw) return EMPTY;
  try {
    const j = JSON.parse(raw) as { keys?: unknown; active?: unknown };
    const keys = (Array.isArray(j.keys) ? j.keys : [])
      .filter((k): k is StoredKey => !!k && typeof (k as StoredKey).name === "string" && /^[0-9a-f]{64}$/.test((k as StoredKey).privHex))
      .map((k) => ({ name: k.name, privHex: k.privHex }));
    let active = typeof j.active === "number" ? j.active : 0;
    if (active < 0 || active >= keys.length) active = keys.length ? 0 : -1;
    return keys.length ? { keys, active } : EMPTY;
  } catch {
    return EMPTY;
  }
}

let cacheRaw: string | null | undefined;
let cacheState: WalletState = EMPTY;
const listeners = new Set<() => void>();

function snapshot(): WalletState {
  const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
  if (raw !== cacheRaw) {
    cacheRaw = raw;
    cacheState = parseWallet(raw);
  }
  return cacheState;
}

function save(s: WalletState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function addKey(name: string, privHex: string): KeyPair {
  const kp = keyFromHex(privHex); // validates
  const s = snapshot();
  if (s.keys.some((k) => k.privHex === kp.privHex)) throw new Error("this key is already in the wallet");
  save({ keys: [...s.keys, { name: name.trim() || `account ${s.keys.length + 1}`, privHex: kp.privHex }], active: s.keys.length });
  return kp;
}

export function createKey(name: string): KeyPair {
  const kp = generateKey();
  addKey(name, kp.privHex);
  return kp;
}

export function selectKey(i: number) {
  const s = snapshot();
  if (i >= 0 && i < s.keys.length) save({ ...s, active: i });
}

export function forgetKey(i: number) {
  const s = snapshot();
  const keys = s.keys.filter((_, j) => j !== i);
  save({ keys, active: keys.length ? Math.min(s.active, keys.length - 1) : -1 });
}

export function useWallet(): WalletState {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}

export function activeKeyPair(w: WalletState): KeyPair | null {
  return w.active >= 0 ? keyFromHex(w.keys[w.active].privHex) : null;
}
