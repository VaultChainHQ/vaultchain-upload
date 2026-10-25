// The OLD key storage of this site: plain hex keys in localStorage under `vaultchain-upload:keys:v1`.
// It is no longer written. It is only read so people who used the earlier version can move their
// accounts into the passphrase-encrypted vault (see components/Migrate.tsx) and then delete the
// plain copies.
import { keyFromHex, type KeyPair } from "./vault/keys";

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

export interface LegacyAccount {
  name: string;
  privHex: string;
  address: string;
}

/** Plain keys found in this browser that are not yet in the vault (by address). Keys that fail validation are skipped. */
export function legacyAccounts(raw: string | null, alreadyInVault: ReadonlySet<string> = new Set()): LegacyAccount[] {
  const out: LegacyAccount[] = [];
  for (const k of parseWallet(raw).keys) {
    let kp: KeyPair;
    try {
      kp = keyFromHex(k.privHex);
    } catch {
      continue;
    }
    if (alreadyInVault.has(kp.address) || out.some((o) => o.address === kp.address)) continue;
    out.push({ name: k.name, privHex: kp.privHex, address: kp.address });
  }
  return out;
}

export function readLegacyRaw(): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Deletes the plain copy. Call only after every account has been sealed into the vault, or the user chose to discard it. */
export function clearLegacy(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage blocked: nothing to clear */
  }
}
