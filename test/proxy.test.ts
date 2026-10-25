import { describe, expect, it } from "vitest";
import { isAllowedProviderPath } from "../lib/proxy";

const root = "ab".repeat(32);

describe("provider proxy whitelist", () => {
  it("allows the provider API used by the site", () => {
    for (const p of ["status", "version", `v1/objects/${root}`, `v1/objects/${root}/status`, `v1/chunks/${root}/0`, `v1/chunks/${root}/123`]) {
      expect(isAllowedProviderPath(p), p).toBe(true);
    }
  });
  it("rejects anything else", () => {
    for (const p of ["", "metrics", "../etc/passwd", "v1/objects/zz", `v1/objects/${root}/x`, `v1/chunks/${root}/-1`, `v1/chunks/${root}/0/extra`, `v1/chunks/${root.toUpperCase()}/0`, "v1/admin/anything"]) {
      expect(isAllowedProviderPath(p), p).toBe(false);
    }
  });
});
