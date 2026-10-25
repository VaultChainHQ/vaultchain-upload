import { describe, expect, it } from "vitest";
import {
  DURATIONS, FEE_UVAULT, GIB, MAX_BATCH_BYTES, MAX_FILES, MAX_FILE_BYTES, blocksForHours, checkFunds, escrowFor, estimateCost, storedBytes, validateFiles,
} from "../lib/cost";

const PRICE = 1_000_000n;

describe("escrow", () => {
  it("is at least one GiB for one pricing unit", () => {
    expect(escrowFor(1, 1000, PRICE)).toBe(1_000_000n);
    expect(escrowFor(GIB, 1000, PRICE)).toBe(1_000_000n);
    expect(escrowFor(GIB + 1, 1000, PRICE)).toBe(2_000_000n);
  });
  it("scales with whole 1,000-block units and never drops below one", () => {
    expect(escrowFor(1, 999, PRICE)).toBe(1_000_000n);
    expect(escrowFor(1, 10_000, PRICE)).toBe(10_000_000n);
    expect(escrowFor(1, 10_999, PRICE)).toBe(10_000_000n);
    expect(escrowFor(1, 100_000, PRICE)).toBe(100_000_000n);
  });
});

describe("estimate", () => {
  it("adds two fees per file and sums escrow", () => {
    const e = estimateCost([{ name: "a", size: 10 }, { name: "b", size: 20 }], { encrypt: true, durationBlocks: 1000, pricePerGb: PRICE });
    expect(e.fees).toBe(FEE_UVAULT * 4n);
    expect(e.escrow).toBe(2_000_000n);
    expect(e.total).toBe(e.escrow + e.fees);
    expect(e.lines[0].stored).toBe(storedBytes(10, true));
  });
  it("encrypted storage is a little larger than the plain file", () => {
    expect(storedBytes(100, true)).toBeGreaterThan(100);
    expect(storedBytes(100, false)).toBe(100);
  });
  it("every duration preset has a positive price", () => {
    for (const d of DURATIONS) expect(estimateCost([{ name: "x", size: 1 }], { encrypt: false, durationBlocks: d.blocks, pricePerGb: PRICE }).total).toBeGreaterThan(0n);
  });
});

describe("duration", () => {
  it("rounds hours up to the pricing unit", () => {
    expect(blocksForHours(1)).toBe(2000); // 1 h is 1,200 blocks, priced as 2 units
    expect(blocksForHours(8)).toBe(10_000);
    expect(blocksForHours(0.1)).toBe(1000);
  });
});

describe("funds", () => {
  const cost = estimateCost([{ name: "a", size: 1 }], { encrypt: false, durationBlocks: 1000, pricePerGb: PRICE });
  it("is unknown until the balance is", () => expect(checkFunds(undefined, cost)).toBeUndefined());
  it("reports how much is missing", () => {
    expect(checkFunds(cost.total, cost)).toEqual({ ok: true });
    expect(checkFunds(cost.total - 5n, cost)).toEqual({ ok: false, shortBy: 5n });
  });
});

describe("validateFiles", () => {
  it("rejects empty and oversize files with a reason, accepts the rest by index", () => {
    const r = validateFiles([{ name: "a", size: 0 }, { name: "b", size: 5 }, { name: "c", size: MAX_FILE_BYTES + 1 }]);
    expect(r.accepted).toEqual([1]);
    expect(r.issues.map((i) => i.reason)).toEqual(["empty", "too-large"]);
    expect(r.issues[0].message).toMatch(/empty/);
    expect(r.issues[1].message).toMatch(/MiB/);
  });
  it("counts files already picked", () => {
    const existing = Array.from({ length: MAX_FILES }, (_, i) => ({ name: `f${i}`, size: 1 }));
    const r = validateFiles([{ name: "x", size: 1 }], existing);
    expect(r.accepted).toEqual([]);
    expect(r.issues[0].message).toMatch(/Only 20 files/);
  });
  it("caps the batch size", () => {
    const r = validateFiles([{ name: "x", size: MAX_FILE_BYTES }], [{ name: "e", size: MAX_BATCH_BYTES - 10 }]);
    expect(r.accepted).toEqual([]);
    expect(r.issues[0].message).toMatch(/in total/);
  });
});
