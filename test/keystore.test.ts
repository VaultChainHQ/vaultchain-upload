import { describe, expect, it } from "vitest";
import {
  BACKUP_FORMAT,
  DEFAULT_KDF,
  KeystoreFormatError,
  WrongPassphraseError,
  changePassphrase,
  exportBackup,
  openKeystore,
  parseBackup,
  passphraseIssues,
  sealKeystore,
  validateEntry,
  type KeystoreEntry,
} from "../lib/keystore";
import { bytesToHex, hexToBytes } from "../lib/vault/bytes";
import { generateKey, keyFromPriv } from "../lib/vault/keys";

// Low cost so the suite is fast; the production defaults are checked separately below.
const FAST = { N: 1 << 10, r: 8, p: 1 };
const PASS = "correct horse battery staple";

async function make(pass = PASS) {
  const kp = generateKey();
  const entry = await sealKeystore(hexToBytes(kp.privHex), pass, { name: "Test", kdf: FAST });
  return { kp, entry };
}

function flipHex(h: string, i = 0): string {
  const c = h[i] === "0" ? "1" : "0";
  return h.slice(0, i) + c + h.slice(i + 1);
}

describe("keystore: round trip", () => {
  it("opens with the right passphrase and returns the same key", async () => {
    const { kp, entry } = await make();
    expect(entry.address).toBe(kp.address);
    expect(entry.cipher.ct).toHaveLength(96); // 32-byte key + 16-byte GCM tag
    const priv = await openKeystore(entry, PASS);
    expect(bytesToHex(priv)).toBe(kp.privHex);
    expect(keyFromPriv(priv).address).toBe(kp.address);
  });

  it("never contains the private key in the stored entry", async () => {
    const { kp, entry } = await make();
    expect(JSON.stringify(entry)).not.toContain(kp.privHex);
  });

  it("uses a fresh salt, iv and id every time", async () => {
    const kp = generateKey();
    const a = await sealKeystore(hexToBytes(kp.privHex), PASS, { name: "a", kdf: FAST });
    const b = await sealKeystore(hexToBytes(kp.privHex), PASS, { name: "a", kdf: FAST });
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(a.cipher.ct).not.toBe(b.cipher.ct);
    expect(a.id).not.toBe(b.id);
  });

  it("treats equivalent unicode passphrases the same (NFKC)", async () => {
    const kp = generateKey();
    const e = await sealKeystore(hexToBytes(kp.privHex), "caf\u00e9 au lait 123", { name: "u", kdf: FAST });
    expect(bytesToHex(await openKeystore(e, "cafe\u0301 au lait 123"))).toBe(kp.privHex);
  });

  it("changes the passphrase", async () => {
    const { kp, entry } = await make();
    const next = await changePassphrase(entry, PASS, "a brand new passphrase!", FAST);
    expect(next.id).toBe(entry.id); // the profile keeps its identity so the store can replace it in place
    expect(next.createdAt).toBe(entry.createdAt);
    expect(next.kdf.salt).not.toBe(entry.kdf.salt);
    await expect(openKeystore(next, PASS)).rejects.toBeInstanceOf(WrongPassphraseError);
    expect(bytesToHex(await openKeystore(next, "a brand new passphrase!"))).toBe(kp.privHex);
    await expect(changePassphrase(entry, "nope nope nope nope", "x", FAST)).rejects.toBeInstanceOf(WrongPassphraseError);
  });
});

describe("keystore: wrong passphrase", () => {
  it("fails with WrongPassphraseError", async () => {
    const { entry } = await make();
    await expect(openKeystore(entry, "correct horse battery stapl")).rejects.toBeInstanceOf(WrongPassphraseError);
    await expect(openKeystore(entry, "")).rejects.toBeInstanceOf(WrongPassphraseError);
    await expect(openKeystore(entry, PASS.toUpperCase())).rejects.toBeInstanceOf(WrongPassphraseError);
  });
  it("refuses an empty passphrase when sealing", async () => {
    await expect(sealKeystore(hexToBytes(generateKey().privHex), "", { name: "x", kdf: FAST })).rejects.toThrow();
  });
});

describe("keystore: tampering fails", () => {
  const cases: [string, (e: KeystoreEntry) => KeystoreEntry][] = [
    ["ciphertext bit flip", (e) => ({ ...e, cipher: { ...e.cipher, ct: flipHex(e.cipher.ct, 10) } })],
    ["tag bit flip", (e) => ({ ...e, cipher: { ...e.cipher, ct: flipHex(e.cipher.ct, 90) } })],
    ["iv bit flip", (e) => ({ ...e, cipher: { ...e.cipher, iv: flipHex(e.cipher.iv, 3) } })],
    ["salt change", (e) => ({ ...e, kdf: { ...e.kdf, salt: flipHex(e.kdf.salt, 5) } })],
    ["kdf cost downgrade", (e) => ({ ...e, kdf: { ...e.kdf, N: e.kdf.N / 2 } })],
    ["id swap", (e) => ({ ...e, id: flipHex(e.id, 2) })],
  ];
  for (const [name, mutate] of cases) {
    it(name, async () => {
      const { entry } = await make();
      await expect(openKeystore(mutate(entry), PASS)).rejects.toBeInstanceOf(WrongPassphraseError);
    });
  }

  it("swapping the address/public key onto another key's blob fails", async () => {
    const a = await make();
    const b = await make();
    const forged: KeystoreEntry = { ...a.entry, address: b.entry.address, pubHex: b.entry.pubHex };
    await expect(openKeystore(forged, PASS)).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it("moving a sealed blob between profile ids fails", async () => {
    const a = await make();
    const b = await make();
    await expect(openKeystore({ ...a.entry, id: b.entry.id }, PASS)).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it("editing the display name or colour does not break opening (cosmetic only)", async () => {
    const { kp, entry } = await make();
    const e2 = { ...entry, name: "Renamed", color: "#123456" };
    expect(bytesToHex(await openKeystore(e2, PASS))).toBe(kp.privHex);
  });
});

describe("keystore: validation and backup files", () => {
  it("rejects malformed entries", async () => {
    const { entry } = await make();
    const bads: unknown[] = [
      null,
      "x",
      { ...entry, v: 2 },
      { ...entry, id: "zz" },
      { ...entry, address: "cosmos1abc" },
      { ...entry, pubHex: "00" },
      { ...entry, kdf: { ...entry.kdf, alg: "pbkdf2" } },
      { ...entry, kdf: { ...entry.kdf, N: 1000 } }, // not a power of two
      { ...entry, kdf: { ...entry.kdf, N: 1 << 30 } }, // DoS bound
      { ...entry, cipher: { ...entry.cipher, ct: "00" } },
      { ...entry, cipher: { ...entry.cipher, alg: "AES-128-CBC" } },
    ];
    for (const b of bads) expect(() => validateEntry(b, { allowWeak: true })).toThrow(KeystoreFormatError);
  });

  it("enforces a minimum KDF cost on imports unless allowWeak is set", async () => {
    const { entry } = await make(); // N = 2^10
    expect(() => validateEntry(entry)).toThrow(/too low/);
    expect(() => validateEntry(entry, { allowWeak: true })).not.toThrow();
  });

  it("exports and re-imports a backup", async () => {
    const a = await make();
    const b = await make("another passphrase 123");
    const text = exportBackup([a.entry, b.entry], new Date("2026-10-25T12:00:00Z"));
    const j = JSON.parse(text);
    expect(j.format).toBe(BACKUP_FORMAT);
    expect(text).not.toContain(a.kp.privHex);
    expect(text).not.toContain(b.kp.privHex);
    const back = parseBackup(text, { allowWeak: true });
    expect(back).toHaveLength(2);
    expect(bytesToHex(await openKeystore(back[0], PASS))).toBe(a.kp.privHex);
    expect(bytesToHex(await openKeystore(back[1], "another passphrase 123"))).toBe(b.kp.privHex);
  });

  it("rejects things that are not backups", () => {
    expect(() => parseBackup("not json")).toThrow(KeystoreFormatError);
    expect(() => parseBackup("{}")).toThrow(KeystoreFormatError);
    expect(() => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, entries: [] }))).toThrow(KeystoreFormatError);
    expect(() => parseBackup("x".repeat(1_000_001))).toThrow(KeystoreFormatError);
  });
});

describe("keystore: production parameters", () => {
  it("defaults to scrypt N=2^16, r=8, p=2 (64 MiB) and opens with them", async () => {
    expect(DEFAULT_KDF).toEqual({ N: 65536, r: 8, p: 2 });
    const kp = generateKey();
    const t0 = Date.now();
    const entry = await sealKeystore(hexToBytes(kp.privHex), PASS, { name: "prod" });
    expect(entry.kdf).toMatchObject({ alg: "scrypt", N: 65536, r: 8, p: 2 });
    expect(() => validateEntry(entry)).not.toThrow(); // acceptable as an import too
    expect(bytesToHex(await openKeystore(entry, PASS))).toBe(kp.privHex);
    console.log(`scrypt N=2^16 r=8 p=2 seal+open took ${Date.now() - t0} ms in node`);
  }, 60_000);
});

describe("passphrase screening", () => {
  it("flags short, repetitive and common passphrases", () => {
    expect(passphraseIssues("short")).not.toHaveLength(0);
    expect(passphraseIssues("aaaaaaaaaaaaaaaa")).not.toHaveLength(0);
    expect(passphraseIssues("passwordpassword")).not.toHaveLength(0);
    expect(passphraseIssues("correct horse battery staple")).toHaveLength(0);
  });
});
