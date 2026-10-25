import { describe, expect, it } from "vitest";
import { sealKeystore } from "../lib/keystore";
import { Session } from "../lib/session";
import { STORAGE_KEY, VaultStore, parseVault, type KV } from "../lib/vaultstore";
import { bytesToHex, hexToBytes } from "../lib/vault/bytes";
import { generateKey } from "../lib/vault/keys";

class MemKV implements KV {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

async function profile(name: string) {
  const kp = generateKey();
  return { kp, entry: await sealKeystore(hexToBytes(kp.privHex), "a long enough passphrase", { name, kdf: { N: 1 << 10, r: 8, p: 1 } }) };
}

describe("vault store", () => {
  it("adds, switches and removes profiles", async () => {
    const kv = new MemKV();
    const s = new VaultStore(kv);
    expect(s.snapshot().profiles).toHaveLength(0);
    const a = await profile("Alice");
    const b = await profile("Bob");
    s.addProfile(a.entry);
    s.addProfile(b.entry);
    expect(s.snapshot().profiles.map((p) => p.entry.name)).toEqual(["Alice", "Bob"]);
    expect(s.snapshot().activeId).toBe(b.entry.id);
    s.setActive(a.entry.id);
    expect(s.snapshot().activeId).toBe(a.entry.id);
    s.removeProfile(a.entry.id);
    expect(s.snapshot().profiles).toHaveLength(1);
    expect(s.snapshot().activeId).toBe(b.entry.id);
  });

  it("persists to storage and never writes a raw private key", async () => {
    const kv = new MemKV();
    const s = new VaultStore(kv);
    const a = await profile("Alice");
    s.addProfile(a.entry);
    const raw = kv.getItem(STORAGE_KEY)!;
    expect(raw).not.toContain(a.kp.privHex);
    const s2 = new VaultStore(kv);
    expect(s2.snapshot().profiles[0].entry.address).toBe(a.kp.address);
  });

  it("rejects duplicates, keeps a stable snapshot and notifies subscribers", async () => {
    const s = new VaultStore(new MemKV());
    const a = await profile("A");
    let n = 0;
    s.subscribe(() => n++);
    s.addProfile(a.entry);
    expect(n).toBe(1);
    expect(s.snapshot()).toBe(s.snapshot());
    expect(() => s.addProfile(a.entry)).toThrow();
  });

  it("manages contacts per profile", async () => {
    const s = new VaultStore(new MemKV());
    const a = await profile("A");
    const b = await profile("B");
    s.addProfile(a.entry);
    s.addProfile(b.entry);
    s.addContact(a.entry.id, "Bob", b.kp.address);
    expect(s.snapshot().profiles[0].contacts).toHaveLength(1);
    expect(s.snapshot().profiles[1].contacts).toHaveLength(0);
    expect(() => s.addContact(a.entry.id, "again", b.kp.address)).toThrow();
    expect(() => s.addContact(a.entry.id, "bad", "vault1notanaddress")).toThrow();
    s.removeContact(a.entry.id, s.snapshot().profiles[0].contacts[0].id);
    expect(s.snapshot().profiles[0].contacts).toHaveLength(0);
  });

  it("edits name/colour and settings, rejecting bad values", async () => {
    const s = new VaultStore(new MemKV());
    const a = await profile("A");
    s.addProfile(a.entry);
    s.editProfile(a.entry.id, "  Renamed  ", "#ABCDEF");
    expect(s.snapshot().profiles[0].entry.name).toBe("Renamed");
    expect(s.snapshot().profiles[0].entry.color).toBe("#abcdef");
    s.setAutoLock(5);
    expect(s.snapshot().settings.autoLockMinutes).toBe(5);
    expect(() => s.setAutoLock(7)).toThrow();
  });

  it("survives corrupted storage", () => {
    expect(parseVault("{{{").profiles).toHaveLength(0);
    expect(parseVault(JSON.stringify({ profiles: [{ entry: { nope: 1 } }] })).profiles).toHaveLength(0);
  });
});

describe("unlock session", () => {
  it("locks after the inactivity timeout and wipes the key", () => {
    let t = 1_000;
    const s = new Session(() => 1, () => t);
    const priv = hexToBytes(generateKey().privHex);
    const u = s.unlock("p1", priv);
    expect(s.snapshot()).toBe(u);
    t += 59_000;
    expect(s.check()).toBe(false);
    s.touch(); // activity resets the deadline
    t += 59_000;
    expect(s.check()).toBe(false);
    t += 2_000;
    expect(s.check()).toBe(true);
    expect(s.snapshot()).toBeNull();
    expect(bytesToHex(priv)).toBe("00".repeat(32));
  });

  it("manual lock wipes the key and notifies", () => {
    const s = new Session(() => 10);
    const priv = hexToBytes(generateKey().privHex);
    let n = 0;
    s.subscribe(() => n++);
    s.unlock("p", priv);
    s.lock();
    expect(s.snapshot()).toBeNull();
    expect(bytesToHex(priv)).toBe("00".repeat(32));
    expect(n).toBe(2);
  });

  it("unlocking another profile locks the previous one", () => {
    const s = new Session(() => 10);
    const a = hexToBytes(generateKey().privHex);
    const b = hexToBytes(generateKey().privHex);
    s.unlock("a", a);
    s.unlock("b", b);
    expect(s.snapshot()?.profileId).toBe("b");
    expect(bytesToHex(a)).toBe("00".repeat(32));
    s.lock();
  });
});
