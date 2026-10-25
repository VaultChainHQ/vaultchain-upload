import { describe, expect, it } from "vitest";
import { Session } from "../lib/session";
import { hexToBytes } from "../lib/vault/bytes";
import { generateKey } from "../lib/vault/keys";

function setup(minutes = 5) {
  let t = 1_000_000;
  const s = new Session(() => minutes, () => t);
  const kp = generateKey();
  const priv = hexToBytes(kp.privHex);
  return { s, kp, priv, advance: (ms: number) => (t += ms) };
}

describe("session", () => {
  it("unlocks with the key in memory", () => {
    const { s, kp, priv } = setup();
    const u = s.unlock("p1", priv);
    expect(u.key.address).toBe(kp.address);
    expect(s.snapshot()?.profileId).toBe("p1");
    s.lock();
  });

  it("lock wipes the key bytes and clears the snapshot", () => {
    const { s, priv } = setup();
    const u = s.unlock("p1", priv);
    const held = u.priv;
    s.lock();
    expect(s.snapshot()).toBeNull();
    expect(Array.from(held).every((b) => b === 0)).toBe(true);
  });

  it("locks once the inactivity deadline has passed, not before", () => {
    const { s, priv, advance } = setup(5);
    s.unlock("p1", priv);
    advance(4 * 60_000);
    expect(s.check()).toBe(false);
    expect(s.snapshot()).not.toBeNull();
    advance(61_000);
    expect(s.check()).toBe(true);
    expect(s.snapshot()).toBeNull();
  });

  it("activity pushes the deadline out", () => {
    const { s, priv, advance } = setup(5);
    s.unlock("p1", priv);
    advance(4 * 60_000);
    s.touch();
    advance(4 * 60_000);
    expect(s.check()).toBe(false);
    s.lock();
  });

  it("only one profile is unlocked at a time and the old key is wiped", () => {
    const { s, priv } = setup();
    const first = s.unlock("p1", priv).priv;
    s.unlock("p2", hexToBytes(generateKey().privHex));
    expect(s.snapshot()?.profileId).toBe("p2");
    expect(Array.from(first).every((b) => b === 0)).toBe(true);
    s.lock();
  });

  it("notifies subscribers", () => {
    const { s, priv } = setup();
    let n = 0;
    s.subscribe(() => n++);
    s.unlock("p1", priv);
    s.lock();
    expect(n).toBe(2);
  });
});
