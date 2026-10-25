import { describe, expect, it } from "vitest";
import type { Deal, ManifestRecord } from "../lib/vault/client";
import { ENDING_SOON_BLOCKS, bestDeal, fileHealth, filterRows, isRoot, nameFor, needsAttention, previewKind, shareLink, type LibRow } from "../lib/library";

const deal = (p: Partial<Deal>): Deal => ({ id: 1, class: "", owner: "o", cid: "c", size: 1, start_height: 0, expire_height: 10_000, payment: { denom: "uvault", amount: "1" }, replication: 1, min_replicas: 1, replicas: [], status: "open", ...p });
const active = [{ slot: 0, provider: "p", status: "active" }];
const rec = (p: Partial<ManifestRecord>): ManifestRecord => ({ root: "a".repeat(64), size: 10, chunk_size: 1, mime: "text/plain", name: "n", owner: "o", height: 1, ...p });

describe("file health", () => {
  it("is Stored for a running deal with an active replica", () => {
    const h = fileHealth([deal({ replicas: active as Deal["replicas"] })], 100);
    expect(h.level).toBe("ok");
    expect(h.label).toBe("Stored");
    expect(h.blocksLeft).toBe(9900);
  });
  it("warns while waiting for a provider and when ending", () => {
    expect(fileHealth([deal({})], 1).label).toBe("Waiting for provider");
    expect(fileHealth([deal({ replicas: active as Deal["replicas"] })], 10_000 - ENDING_SOON_BLOCKS).label).toBe("Ends soon");
    expect(fileHealth([deal({ replicas: active as Deal["replicas"] })], 10_001).label).toBe("Ending now");
    expect(fileHealth([deal({ status: "pending" })], 1).label).toBe("Starting");
  });
  it("is bad without a deal or after a failed one, idle when finished", () => {
    expect(fileHealth([], 1).level).toBe("bad");
    expect(fileHealth([deal({ status: "failed" })], 1).level).toBe("bad");
    expect(fileHealth([deal({ status: "closed" })], 1).label).toBe("Storage ended");
    expect(fileHealth([deal({ status: "cancelled" })], 1).level).toBe("idle");
  });
  it("prefers a running deal over a newer closed one", () => {
    expect(bestDeal([deal({ id: 9, status: "closed" }), deal({ id: 2, status: "open" })])?.id).toBe(2);
  });
  it("flags what needs attention", () => {
    expect(needsAttention(fileHealth([], 1))).toBe(true);
    expect(needsAttention(fileHealth([deal({ status: "closed" })], 1))).toBe(true);
    expect(needsAttention(fileHealth([deal({ replicas: active as Deal["replicas"] })], 1))).toBe(false);
  });
});

describe("search, filter and sort", () => {
  const rows: LibRow[] = [
    { rec: rec({ root: "1".repeat(64), name: "Holiday.png", mime: "image/png", height: 5, size: 300, encryption: "v1" }), health: fileHealth([], 1) },
    { rec: rec({ root: "2".repeat(64), name: "budget.csv", mime: "text/csv", height: 9, size: 50 }), health: fileHealth([deal({ replicas: active as Deal["replicas"] })], 1) },
    { rec: rec({ root: "3".repeat(64), name: "Zebra.txt", mime: "text/plain", height: 7, size: 900, encryption: "v1" }), health: fileHealth([deal({ replicas: active as Deal["replicas"] })], 1) },
  ];
  const names = (r: LibRow[]) => r.map((x) => x.rec.name);
  it("searches name, type and file id, ignoring case", () => {
    expect(names(filterRows(rows, { q: "holi" }))).toEqual(["Holiday.png"]);
    expect(names(filterRows(rows, { q: "CSV" }))).toEqual(["budget.csv"]);
    expect(names(filterRows(rows, { q: "333" }))).toEqual(["Zebra.txt"]);
    expect(filterRows(rows, { q: "nothing" })).toEqual([]);
  });
  it("filters by privacy and attention", () => {
    expect(names(filterRows(rows, { filter: "private", sort: "name" }))).toEqual(["Holiday.png", "Zebra.txt"]);
    expect(names(filterRows(rows, { filter: "public" }))).toEqual(["budget.csv"]);
    expect(names(filterRows(rows, { filter: "attention" }))).toEqual(["Holiday.png"]);
  });
  it("sorts", () => {
    expect(names(filterRows(rows, {}))).toEqual(["budget.csv", "Zebra.txt", "Holiday.png"]);
    expect(names(filterRows(rows, { sort: "oldest" }))).toEqual(["Holiday.png", "Zebra.txt", "budget.csv"]);
    expect(names(filterRows(rows, { sort: "name" }))).toEqual(["budget.csv", "Holiday.png", "Zebra.txt"]);
    expect(names(filterRows(rows, { sort: "size" }))).toEqual(["Zebra.txt", "Holiday.png", "budget.csv"]);
  });
});

describe("previews and links", () => {
  it("only previews safe types and sizes", () => {
    expect(previewKind("image/png", 10)).toBe("image");
    expect(previewKind("video/mp4; codecs=avc1", 10)).toBe("video");
    expect(previewKind("audio/mpeg", 10)).toBe("audio");
    expect(previewKind("application/pdf", 10)).toBe("pdf");
    expect(previewKind("text/plain", 10)).toBe("text");
    expect(previewKind("text/plain", 600 * 1024)).toBeNull();
    expect(previewKind("image/png", 30 * 1024 * 1024)).toBeNull();
    for (const bad of ["text/html", "image/svg+xml", "application/javascript", "application/x-msdownload", ""]) expect(previewKind(bad, 10)).toBe(bad.startsWith("text/") ? "text" : null);
  });
  it("builds share links that open the file", () => {
    expect(shareLink("ab", "https://x.app/")).toBe("https://x.app/files?open=ab");
    expect(isRoot("a".repeat(64))).toBe(true);
    expect(isRoot("a".repeat(63))).toBe(false);
    expect(isRoot("../etc/passwd")).toBe(false);
    expect(isRoot(null)).toBe(false);
  });
  it("names people kindly", () => {
    const me = { address: "me", name: "Nico" };
    expect(nameFor("me", me, [], (s) => s)).toBe("Nico (you)");
    expect(nameFor("a", me, [{ name: "Sam", address: "a" }], (s) => s)).toBe("Sam");
    expect(nameFor("zzzzzzzz", me, [], (s) => s.slice(0, 3))).toBe("zzz");
  });
});
