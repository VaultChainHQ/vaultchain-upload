import { FALLBACK_PRICE_PER_GB } from "./cost";
import { NODE_URL } from "./vault/config";

/** Storage price per GiB per 1,000 blocks, read from the node, with the devnet default if it cannot be read. */
export async function fetchPricePerGb(base = NODE_URL, f: typeof fetch = (...a) => fetch(...a)): Promise<{ price: bigint; live: boolean }> {
  try {
    const res = await f(`${base}/vaultchain/storage/params`, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const j = (await res.json()) as { params?: { price_per_gb_uvault?: string | number } };
    const v = j.params?.price_per_gb_uvault;
    if (v === undefined || !/^\d+$/.test(String(v))) throw new Error("no price");
    return { price: BigInt(String(v)), live: true };
  } catch {
    return { price: FALLBACK_PRICE_PER_GB, live: false };
  }
}
