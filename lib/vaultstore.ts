// Local-first profile store. Everything lives in this browser's localStorage; there are no accounts
// and no server. Private keys are only ever present in sealed form (see keystore.ts).
import { cleanDisplayName, isColor, validateEntry, type KeystoreEntry } from "./keystore";
import { isValidAddress } from "./vault/keys";

export const STORAGE_KEY = "vaultchain-upload:vault:v1";
export const AUTO_LOCK_CHOICES = [1, 5, 10, 30, 60] as const;
export const DEFAULT_AUTO_LOCK_MIN = 10;

export interface Contact {
  id: string;
  name: string;
  address: string;
}

export interface ProfileRecord {
  entry: KeystoreEntry;
  contacts: Contact[];
}

export interface VaultData {
  v: 1;
  profiles: ProfileRecord[];
  activeId: string | null;
  settings: { autoLockMinutes: number };
}

export const EMPTY_VAULT: VaultData = Object.freeze({
  v: 1 as const,
  profiles: Object.freeze([]) as unknown as ProfileRecord[],
  activeId: null,
  settings: Object.freeze({ autoLockMinutes: DEFAULT_AUTO_LOCK_MIN }) as { autoLockMinutes: number },
}) as VaultData;

/** The minimum of the Web Storage API the store needs, so tests can pass a Map-backed fake. */
export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export function parseVault(raw: string | null): VaultData {
  if (!raw) return EMPTY_VAULT;
  try {
    const j = JSON.parse(raw) as Partial<VaultData>;
    const profiles: ProfileRecord[] = [];
    for (const p of Array.isArray(j.profiles) ? j.profiles : []) {
      try {
        const entry = validateEntry((p as ProfileRecord).entry, { allowWeak: true });
        if (profiles.some((x) => x.entry.id === entry.id)) continue;
        const contacts = (Array.isArray((p as ProfileRecord).contacts) ? (p as ProfileRecord).contacts : [])
          .filter((c): c is Contact => !!c && typeof c.id === "string" && typeof c.name === "string" && typeof c.address === "string" && isValidAddress(c.address))
          .map((c) => ({ id: c.id.slice(0, 64), name: cleanDisplayName(c.name), address: c.address }));
        profiles.push({ entry, contacts });
      } catch {
        /* drop an unreadable profile rather than the whole vault */
      }
    }
    const m = Number(j.settings?.autoLockMinutes);
    const autoLockMinutes = (AUTO_LOCK_CHOICES as readonly number[]).includes(m) ? m : DEFAULT_AUTO_LOCK_MIN;
    const activeId = profiles.some((p) => p.entry.id === j.activeId) ? (j.activeId as string) : (profiles[0]?.entry.id ?? null);
    return profiles.length ? { v: 1, profiles, activeId, settings: { autoLockMinutes } } : { ...EMPTY_VAULT, settings: { autoLockMinutes } };
  } catch {
    return EMPTY_VAULT;
  }
}

export class VaultStore {
  private cacheRaw: string | null | undefined;
  private cache: VaultData = EMPTY_VAULT;
  private listeners = new Set<() => void>();

  constructor(private kv: KV | null) {}

  /** Stable snapshot for useSyncExternalStore. */
  snapshot = (): VaultData => {
    const raw = this.kv ? this.kv.getItem(STORAGE_KEY) : null;
    if (raw !== this.cacheRaw) {
      this.cacheRaw = raw;
      this.cache = parseVault(raw);
    }
    return this.cache;
  };

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) cb();
    };
    if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
    return () => {
      this.listeners.delete(cb);
      if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
    };
  };

  private write(next: VaultData) {
    if (!this.kv) throw new Error("storage is not available");
    this.kv.setItem(STORAGE_KEY, JSON.stringify(next));
    this.listeners.forEach((l) => l());
  }

  addProfile(entry: KeystoreEntry, activate = true): void {
    const s = this.snapshot();
    if (s.profiles.some((p) => p.entry.id === entry.id)) throw new Error("this profile is already in the vault");
    if (s.profiles.some((p) => p.entry.address === entry.address)) throw new Error("a profile for this address already exists");
    this.write({ ...s, profiles: [...s.profiles, { entry, contacts: [] }], activeId: activate || !s.activeId ? entry.id : s.activeId });
  }

  replaceEntry(entry: KeystoreEntry): void {
    const s = this.snapshot();
    this.write({ ...s, profiles: s.profiles.map((p) => (p.entry.id === entry.id ? { ...p, entry } : p)) });
  }

  setActive(id: string): void {
    const s = this.snapshot();
    if (s.profiles.some((p) => p.entry.id === id)) this.write({ ...s, activeId: id });
  }

  removeProfile(id: string): void {
    const s = this.snapshot();
    const profiles = s.profiles.filter((p) => p.entry.id !== id);
    this.write({ ...s, profiles, activeId: s.activeId === id ? (profiles[0]?.entry.id ?? null) : s.activeId });
  }

  editProfile(id: string, name: string, color: string): void {
    const s = this.snapshot();
    this.write({
      ...s,
      profiles: s.profiles.map((p) =>
        p.entry.id === id ? { ...p, entry: { ...p.entry, name: cleanDisplayName(name), color: isColor(color) ? color.toLowerCase() : p.entry.color } } : p,
      ),
    });
  }

  addContact(id: string, name: string, address: string): void {
    const addr = address.trim();
    if (!isValidAddress(addr)) throw new Error("not a valid vault1... address");
    const s = this.snapshot();
    this.write({
      ...s,
      profiles: s.profiles.map((p) => {
        if (p.entry.id !== id) return p;
        if (p.contacts.some((c) => c.address === addr)) throw new Error("this address is already in your contacts");
        const cid = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
        return { ...p, contacts: [...p.contacts, { id: cid, name: cleanDisplayName(name) || "Contact", address: addr }] };
      }),
    });
  }

  removeContact(id: string, contactId: string): void {
    const s = this.snapshot();
    this.write({ ...s, profiles: s.profiles.map((p) => (p.entry.id === id ? { ...p, contacts: p.contacts.filter((c) => c.id !== contactId) } : p)) });
  }

  setAutoLock(minutes: number): void {
    if (!(AUTO_LOCK_CHOICES as readonly number[]).includes(minutes)) throw new Error("unsupported auto-lock value");
    const s = this.snapshot();
    this.write({ ...s, settings: { ...s.settings, autoLockMinutes: minutes } });
  }
}

function browserKV(): KV | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const probe = "__vaultchain_probe__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null; // blocked storage (some private modes)
  }
}

let shared: VaultStore | undefined;
/** The app-wide store backed by localStorage (null-backed and read-only on the server). */
export function vaultStore(): VaultStore {
  return (shared ??= new VaultStore(browserKV()));
}
