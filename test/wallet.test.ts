import { describe, expect, it } from "vitest";
import { parseWallet } from "../lib/wallet";

const good = "11".repeat(32);

describe("wallet parsing", () => {
  it("accepts valid stored keys and clamps the active index", () => {
    const w = parseWallet(JSON.stringify({ keys: [{ name: "a", privHex: good }], active: 5 }));
    expect(w.keys).toHaveLength(1);
    expect(w.active).toBe(0);
  });
  it("drops malformed keys and tolerates garbage", () => {
    expect(parseWallet("not json").keys).toEqual([]);
    expect(parseWallet(null).active).toBe(-1);
    expect(parseWallet(JSON.stringify({ keys: [{ name: "x", privHex: "zz" }, 4, null] })).keys).toEqual([]);
  });
});

describe("legacy migration", () => {
  // Throwaway test keys, never funded.
  const k1 = "11".repeat(32);
  const k2 = "22".repeat(32);
  it("lists plain keys with their addresses, deduplicating and skipping what is already in the vault", async () => {
    const { legacyAccounts } = await import("../lib/wallet");
    const raw = JSON.stringify({ keys: [{ name: "one", privHex: k1 }, { name: "again", privHex: k1 }, { name: "two", privHex: k2 }], active: 0 });
    const all = legacyAccounts(raw);
    expect(all.map((a) => a.name)).toEqual(["one", "two"]);
    expect(all[0].address).toMatch(/^vault1/);
    expect(legacyAccounts(raw, new Set([all[0].address])).map((a) => a.name)).toEqual(["two"]);
    expect(legacyAccounts(null)).toEqual([]);
    expect(legacyAccounts("garbage")).toEqual([]);
  });
});
