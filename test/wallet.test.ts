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
