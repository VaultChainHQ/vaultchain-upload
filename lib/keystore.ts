// Passphrase-encrypted key storage for the browser vault.
//
//   passphrase --NFKC--> UTF-8 --scrypt(N, r, p, salt)--> 32-byte key --AES-256-GCM--> sealed private key
//
// * scrypt (memory-hard; @noble/hashes) stretches the passphrase. Default cost N=2^16, r=8, p=2 (64 MiB),
//   the OWASP-recommended equivalent of N=2^17, r=8, p=1. WebCrypto has no memory-hard KDF, so the KDF
//   runs in JS and only the AEAD uses WebCrypto.
// * AES-256-GCM (WebCrypto, 96-bit random IV, 128-bit tag) seals the 32-byte secp256k1 private key.
// * The additional authenticated data binds the sealed key to its entry id, address, public key and
//   the exact KDF parameters and salt, so editing any of them (a downgrade attempt, or swapping the
//   blob into another profile) makes opening fail.
// * Wrong passphrase and tampering are deliberately indistinguishable: both fail the GCM tag check.
// * After opening, the derived address must match the entry's address.
//
// Nothing here talks to a network. The sealed entry is safe to export as a backup file: it is useless
// without the passphrase, but it is only as strong as the passphrase.
import { scryptAsync } from "@noble/hashes/scrypt.js";
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from "./vault/bytes";
import { isValidAddress, keyFromPriv } from "./vault/keys";

export const KEYSTORE_VERSION = 1;
export const BACKUP_FORMAT = "vaultchain-keystore";

export interface KdfParams {
  alg: "scrypt";
  N: number;
  r: number;
  p: number;
  /** hex, 32 random bytes */
  salt: string;
}

export interface KeystoreEntry {
  v: 1;
  /** random 128-bit id, hex */
  id: string;
  name: string;
  /** display colour, #rrggbb (cosmetic, not authenticated) */
  color: string;
  address: string;
  pubHex: string;
  createdAt: number;
  kdf: KdfParams;
  cipher: { alg: "AES-256-GCM"; iv: string; ct: string };
}

export const DEFAULT_KDF = { N: 1 << 16, r: 8, p: 2 } as const;
/** Lowest cost accepted from an imported backup (unless `allowWeak` is set, which tests use). */
export const MIN_KDF = { N: 1 << 14, r: 8, p: 1 } as const;
/** Highest cost accepted, so a hostile backup cannot hang or crash the tab. */
export const MAX_KDF = { N: 1 << 18, r: 16, p: 4 } as const;

export class WrongPassphraseError extends Error {
  constructor() {
    super("wrong passphrase, or the keystore was modified");
    this.name = "WrongPassphraseError";
  }
}

export class KeystoreFormatError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "KeystoreFormatError";
  }
}

const HEX = (n: number) => new RegExp(`^[0-9a-f]{${n}}$`);
const COLOR = /^#[0-9a-f]{6}$/i;

function aadFor(e: Pick<KeystoreEntry, "id" | "address" | "pubHex" | "kdf">): Uint8Array {
  const { alg, N, r, p, salt } = e.kdf;
  return utf8ToBytes(`vaultchain-web/keystore/v${KEYSTORE_VERSION}|${e.id}|${e.address}|${e.pubHex}|${alg}|${N}|${r}|${p}|${salt}`);
}

function normalizePassphrase(pass: string): Uint8Array {
  return utf8ToBytes(pass.normalize("NFKC"));
}

async function deriveKey(pass: string, kdf: KdfParams): Promise<CryptoKey> {
  const raw = await scryptAsync(normalizePassphrase(pass), hexToBytes(kdf.salt), {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    dkLen: 32,
    asyncTick: 20,
    maxmem: 128 * kdf.N * kdf.r * 2 + 4096,
  });
  try {
    return await crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
  } finally {
    raw.fill(0);
  }
}

export interface SealOptions {
  name: string;
  color?: string;
  /** Keep an existing profile id / creation time (used when re-encrypting under a new passphrase). */
  id?: string;
  createdAt?: number;
  /** Override the scrypt cost (tests only; the app always uses DEFAULT_KDF). */
  kdf?: Partial<Pick<KdfParams, "N" | "r" | "p">>;
}

/** Encrypt a 32-byte private key under a passphrase and describe it as a keystore entry. */
export async function sealKeystore(priv: Uint8Array, passphrase: string, o: SealOptions): Promise<KeystoreEntry> {
  if (!passphrase) throw new Error("a passphrase is required");
  const kp = keyFromPriv(priv); // validates the key
  const kdf: KdfParams = { alg: "scrypt", ...DEFAULT_KDF, ...o.kdf, salt: bytesToHex(randomBytes(32)) };
  const base = {
    v: 1 as const,
    id: o.id ?? bytesToHex(randomBytes(16)),
    name: cleanName(o.name),
    color: o.color && COLOR.test(o.color) ? o.color.toLowerCase() : colorForAddress(kp.address),
    address: kp.address,
    pubHex: kp.pubHex,
    createdAt: o.createdAt ?? Date.now(),
    kdf,
  };
  const iv = randomBytes(12);
  const key = await deriveKey(passphrase, kdf);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: aadFor(base) as BufferSource, tagLength: 128 }, key, priv as BufferSource),
  );
  return { ...base, cipher: { alg: "AES-256-GCM", iv: bytesToHex(iv), ct: bytesToHex(ct) } };
}

/** Decrypt an entry. Throws WrongPassphraseError for a wrong passphrase or any modification. */
export async function openKeystore(entry: KeystoreEntry, passphrase: string): Promise<Uint8Array> {
  const e = validateEntry(entry, { allowWeak: true }); // strength is enforced on import, not here, so old entries stay openable
  const key = await deriveKey(passphrase, e.kdf);
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: hexToBytes(e.cipher.iv) as BufferSource, additionalData: aadFor(e) as BufferSource, tagLength: 128 },
        key,
        hexToBytes(e.cipher.ct) as BufferSource,
      ),
    );
  } catch {
    throw new WrongPassphraseError();
  }
  if (plain.length !== 32) {
    plain.fill(0);
    throw new KeystoreFormatError("unexpected plaintext length");
  }
  const kp = keyFromPriv(plain);
  if (kp.address !== e.address || kp.pubHex !== e.pubHex) {
    plain.fill(0);
    throw new KeystoreFormatError("decrypted key does not match the entry's address");
  }
  return plain;
}

/** Re-encrypt under a new passphrase (fresh salt and IV). Needs the old passphrase. */
export async function changePassphrase(entry: KeystoreEntry, oldPass: string, newPass: string, kdf?: SealOptions["kdf"]): Promise<KeystoreEntry> {
  const priv = await openKeystore(entry, oldPass);
  try {
    return await sealKeystore(priv, newPass, {
      name: entry.name,
      color: entry.color,
      id: entry.id,
      createdAt: entry.createdAt,
      kdf: kdf ?? { N: entry.kdf.N, r: entry.kdf.r, p: entry.kdf.p },
    });
  } finally {
    priv.fill(0);
  }
}

function cleanName(n: string): string {
  const s = n.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 40);
  return s || "Unnamed profile";
}

export const PALETTE = ["#38bdf8", "#34d399", "#fbbf24", "#f472b6", "#a78bfa", "#fb7185", "#2dd4bf", "#f97316"];

export function colorForAddress(address: string): string {
  let h = 0;
  for (let i = 0; i < address.length; i++) h = (h * 31 + address.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function cleanDisplayName(n: string): string {
  return cleanName(n);
}

export function isColor(c: string): boolean {
  return COLOR.test(c);
}

/** Strict shape and bounds check for an entry coming from storage or an imported file. */
export function validateEntry(x: unknown, opts: { allowWeak?: boolean } = {}): KeystoreEntry {
  const bad = (m: string): never => {
    throw new KeystoreFormatError(`invalid keystore entry: ${m}`);
  };
  if (!x || typeof x !== "object") return bad("not an object");
  const e = x as Record<string, unknown>;
  if (e.v !== KEYSTORE_VERSION) return bad(`unsupported version ${String(e.v)}`);
  if (typeof e.id !== "string" || !HEX(32).test(e.id)) return bad("id");
  if (typeof e.name !== "string") return bad("name");
  if (typeof e.color !== "string" || !COLOR.test(e.color)) return bad("color");
  if (typeof e.address !== "string" || !isValidAddress(e.address)) return bad("address");
  if (typeof e.pubHex !== "string" || !HEX(66).test(e.pubHex)) return bad("public key");
  if (typeof e.createdAt !== "number" || !Number.isFinite(e.createdAt)) return bad("createdAt");
  const k = e.kdf as Record<string, unknown> | undefined;
  if (!k || k.alg !== "scrypt") return bad("kdf algorithm");
  const { N, r, p } = k as { N: unknown; r: unknown; p: unknown };
  if (typeof N !== "number" || typeof r !== "number" || typeof p !== "number") return bad("kdf parameters");
  if (!Number.isInteger(N) || N < 2 || (N & (N - 1)) !== 0 || !Number.isInteger(r) || r < 1 || !Number.isInteger(p) || p < 1) return bad("kdf parameters");
  if (N > MAX_KDF.N || r > MAX_KDF.r || p > MAX_KDF.p) return bad("kdf cost too high");
  if (!opts.allowWeak && (N < MIN_KDF.N || r < MIN_KDF.r || p < MIN_KDF.p)) return bad("kdf cost too low");
  if (typeof k.salt !== "string" || !HEX(64).test(k.salt)) return bad("salt");
  const c = e.cipher as Record<string, unknown> | undefined;
  if (!c || c.alg !== "AES-256-GCM") return bad("cipher");
  if (typeof c.iv !== "string" || !HEX(24).test(c.iv)) return bad("iv");
  if (typeof c.ct !== "string" || !HEX(96).test(c.ct)) return bad("ciphertext"); // 32-byte key + 16-byte tag
  return {
    v: 1,
    id: e.id,
    name: cleanName(e.name),
    color: e.color.toLowerCase(),
    address: e.address,
    pubHex: e.pubHex,
    createdAt: e.createdAt,
    kdf: { alg: "scrypt", N, r, p, salt: k.salt },
    cipher: { alg: "AES-256-GCM", iv: c.iv, ct: c.ct },
  };
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: 1;
  exportedAt: string;
  entries: KeystoreEntry[];
}

export function exportBackup(entries: KeystoreEntry[], now = new Date()): string {
  const file: BackupFile = { format: BACKUP_FORMAT, version: 1, exportedAt: now.toISOString(), entries };
  return JSON.stringify(file, null, 2) + "\n";
}

export function parseBackup(text: string, opts: { allowWeak?: boolean } = {}): KeystoreEntry[] {
  if (text.length > 1_000_000) throw new KeystoreFormatError("backup file is too large");
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw new KeystoreFormatError("backup is not valid JSON");
  }
  const f = j as Partial<BackupFile> | null;
  if (!f || f.format !== BACKUP_FORMAT || f.version !== 1 || !Array.isArray(f.entries) || f.entries.length === 0) {
    throw new KeystoreFormatError("this is not a VaultChain keystore backup");
  }
  if (f.entries.length > 50) throw new KeystoreFormatError("too many entries");
  return f.entries.map((e) => validateEntry(e, opts));
}

/** Rough passphrase screening: length and variety. Returns problems, empty when acceptable. */
export function passphraseIssues(p: string): string[] {
  const out: string[] = [];
  if (p.length < 12) out.push("use at least 12 characters (a few random words work well)");
  if (new Set(p).size < 6) out.push("use more distinct characters");
  if (/^(password|passphrase|12345678|qwertyuiop|letmein)/i.test(p)) out.push("this is a very common passphrase");
  return out;
}
