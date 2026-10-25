import { describe, expect, it } from "vitest";
import { explainFaucet, faucetInfo, requestDrip } from "../lib/faucet";
import { fetchPricePerGb } from "../lib/params";
import { FALLBACK_PRICE_PER_GB } from "../lib/cost";

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, ...init });
const A = "vault1dwa8g26hsy0p20tx0yfz3mct8k86r8tdv36qye";

describe("faucet client", () => {
  it("reads the faucet info and tolerates an outage", async () => {
    expect((await faucetInfo(async () => json({ enabled: true, dripVault: 100 }), "x"))?.dripVault).toBe(100);
    expect(await faucetInfo(async () => json({}, { status: 500 }), "x")).toBeNull();
    expect(await faucetInfo(async () => Promise.reject(new Error("net")), "x")).toBeNull();
  });
  it("posts the address and returns the tx", async () => {
    let body = "";
    const r = await requestDrip(A, async (_u, init) => ((body = String(init?.body)), json({ ok: true, txHash: "AB12", amountUvault: "100000000" })), "x");
    expect(JSON.parse(body)).toEqual({ address: A });
    expect(r).toEqual({ ok: true, txHash: "AB12", amountUvault: "100000000" });
  });
  it("turns a cooldown into a message with the wait", async () => {
    const r = await requestDrip(A, async () => json({ code: "address_cooldown", error: "x", retryAfterSeconds: 7200 }, { status: 429 }), "x");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("address_cooldown");
      expect(r.retryAfterSeconds).toBe(7200);
      expect(r.message).toMatch(/2 h/);
    }
  });
  it("reports an unreachable faucet and non-JSON failures", async () => {
    const down = await requestDrip(A, async () => Promise.reject(new TypeError("Failed to fetch")), "x");
    expect(down).toMatchObject({ ok: false, code: "unreachable", unreachable: true });
    const html = await requestDrip(A, async () => new Response("<html>bad gateway</html>", { status: 502 }), "x");
    expect(html).toMatchObject({ ok: false, code: "http_502" });
  });
  it("explains each documented code in plain words", () => {
    for (const c of ["address_cooldown", "ip_limit", "too_many_requests", "faucet_busy", "already_funded", "faucet_empty", "disabled", "node_error"]) {
      const m = explainFaucet(c, "", 90);
      expect(m.length).toBeGreaterThan(10);
      expect(m).not.toMatch(/undefined|\[object/);
    }
  });
});

describe("price from the node", () => {
  it("reads price_per_gb_uvault", async () => {
    expect(await fetchPricePerGb("n", async () => json({ params: { price_per_gb_uvault: "2500000" } }))).toEqual({ price: 2_500_000n, live: true });
  });
  it("falls back to the devnet default", async () => {
    for (const f of [async () => json({}, { status: 500 }), async () => json({ params: {} }), async () => json({ params: { price_per_gb_uvault: "abc" } }), async () => Promise.reject(new Error("x"))]) {
      expect(await fetchPricePerGb("n", f)).toEqual({ price: FALLBACK_PRICE_PER_GB, live: false });
    }
  });
});
