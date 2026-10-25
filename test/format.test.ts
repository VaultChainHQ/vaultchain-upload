import { describe, expect, it } from "vitest";
import { ADDRESS_RE, fmtAgo, fmtBytes, fmtDuration, fmtVault, fmtWait, fmtWhen, short, vault } from "../lib/format";

describe("amounts", () => {
  it("formats uvault as VAULT without trailing zeros", () => {
    expect(fmtVault(0n)).toBe("0");
    expect(fmtVault(1n)).toBe("0.000001");
    expect(fmtVault(1_500_000n)).toBe("1.5");
    expect(fmtVault("100000000")).toBe("100");
    expect(fmtVault("")).toBe("0");
  });
  it("groups thousands and adds the unit", () => {
    expect(vault(1_950_000_000n)).toBe("1,950 VAULT");
    expect(vault(1500n)).toBe("0.0015 VAULT");
  });
});

describe("sizes", () => {
  it("uses binary units", () => {
    expect(fmtBytes(0)).toBe("0 B");
    expect(fmtBytes(1023)).toBe("1023 B");
    expect(fmtBytes(2048)).toBe("2.00 KiB");
    expect(fmtBytes(64 * 1024 * 1024)).toBe("64.0 MiB");
    expect(fmtBytes(-1)).toBe("–");
    expect(fmtBytes(NaN)).toBe("–");
  });
});

describe("short", () => {
  it("keeps the head and tail only when it saves space", () => {
    expect(short("abcdef", 3)).toBe("abcdef");
    expect(short("0123456789abcdef", 4)).toBe("0123…cdef");
    expect(short("0123456789abcdef", 4, 2)).toBe("0123…ef");
  });
});

describe("time", () => {
  it("turns blocks (about 3 s each) into plain durations", () => {
    expect(fmtDuration(1)).toBe("a moment");
    expect(fmtDuration(10)).toBe("about 30 seconds");
    expect(fmtDuration(200)).toBe("about 10 minutes");
    expect(fmtDuration(1000)).toBe("about 50 minutes");
    expect(fmtDuration(10_000)).toBe("about 8 hours");
    expect(fmtDuration(100_000)).toBe("about 3 days");
  });
  it("describes past and future heights", () => {
    expect(fmtAgo(1)).toBe("just now");
    expect(fmtAgo(1200)).toBe("about 60 minutes ago");
    expect(fmtWhen(2000, 1000)).toBe("in about 50 minutes");
    expect(fmtWhen(1000, 2000)).toBe("about 50 minutes ago");
    expect(fmtWhen(5, undefined)).toBe("at block 5");
  });
  it("formats cooldown waits", () => {
    expect(fmtWait(30)).toBe("30 seconds");
    expect(fmtWait(600)).toBe("10 minutes");
    expect(fmtWait(3 * 3600)).toBe("3 h");
    expect(fmtWait(24 * 3600 + 1800)).toBe("24 h 30 min");
  });
});

describe("addresses", () => {
  it("accepts vault1 bech32-looking addresses only", () => {
    expect(ADDRESS_RE.test("vault1dwa8g26hsy0p20tx0yfz3mct8k86r8tdv36qye")).toBe(true);
    expect(ADDRESS_RE.test("cosmos1dwa8g26hsy0p20tx0yfz3mct8k86r8tdv36qye")).toBe(false);
    expect(ADDRESS_RE.test("vault1short")).toBe(false);
    expect(ADDRESS_RE.test("vault1dwa8g26hsy0p20tx0yfz3mct8k86r8tdv36qyb")).toBe(false); // 'b' is not in bech32
  });
});
