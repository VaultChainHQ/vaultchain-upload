import { describe, expect, it } from "vitest";
import { friendlyError } from "../lib/errors";

describe("friendlyError", () => {
  const cases: [string, string, boolean][] = [
    ["insufficient funds for fee", "funds", false],
    ["TypeError: Failed to fetch", "network", true],
    ["account sequence mismatch, nonce 4", "chain", true],
    ["manifest already committed by another account", "chain", false],
    ["provider is on vault-devnet-0 but the node is on vault-devnet-1", "provider", true],
    ["upload incomplete: 3 of 5 chunks", "provider", true],
    ["provider says not authorized (403)", "auth", false],
    ["empty files cannot be stored", "file", false],
    ["transaction failed: out of gas", "chain", false],
    ["???", "unknown", true],
  ];
  for (const [msg, kind, retry] of cases) {
    it(`${kind}: ${msg}`, () => {
      const e = friendlyError(new Error(msg));
      expect(e.kind).toBe(kind);
      expect(e.retryable).toBe(retry);
      expect(e.detail).toBe(msg);
      expect(e.title.length).toBeGreaterThan(5);
    });
  }
  it("accepts non-Error values and never leaks a stack", () => {
    expect(friendlyError("plain string").detail).toBe("plain string");
    expect(friendlyError(new Error("x")).title).not.toMatch(/\bat\b.*\.ts/);
  });
});
