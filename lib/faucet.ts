import { fmtWait } from "./format";

// Devnet funds. The faucet lives on the VaultChain web app (vaultchain-web `/api/faucet`) and answers
// cross-origin requests from this site (exact-origin CORS), so a visitor's own IP address is what its
// rate limit sees. Nothing is proxied through here.
export const FAUCET_URL = process.env.NEXT_PUBLIC_FAUCET_URL || "https://vaultchain-web.vercel.app/api/faucet";
export const FAUCET_PAGE = "https://vaultchain-web.vercel.app/vault";

export interface FaucetInfo {
  enabled: boolean;
  network?: string;
  address?: string;
  dripVault?: number;
  ceilingVault?: number;
  cooldownHours?: number;
  low?: boolean;
}

export type DripResult =
  | { ok: true; txHash: string; amountUvault: string }
  | { ok: false; code: string; message: string; retryAfterSeconds?: number; unreachable?: boolean };

type F = typeof fetch;

export async function faucetInfo(f: F = (...a) => fetch(...a), url = FAUCET_URL): Promise<FaucetInfo | null> {
  try {
    const res = await f(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as FaucetInfo;
  } catch {
    return null;
  }
}

export async function requestDrip(address: string, f: F = (...a) => fetch(...a), url = FAUCET_URL): Promise<DripResult> {
  let res: Response;
  try {
    res = await f(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address }) });
  } catch {
    return { ok: false, code: "unreachable", unreachable: true, message: "Could not reach the faucet. Check your connection, or use the faucet on the VaultChain site." };
  }
  let j: Record<string, unknown> = {};
  try {
    j = (await res.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON error page */
  }
  if (res.ok && j.ok === true && typeof j.txHash === "string") return { ok: true, txHash: j.txHash, amountUvault: String(j.amountUvault ?? "0") };
  const retry = typeof j.retryAfterSeconds === "number" ? j.retryAfterSeconds : Number(res.headers.get("retry-after")) || undefined;
  const code = typeof j.code === "string" ? j.code : `http_${res.status}`;
  const raw = typeof j.error === "string" ? j.error : "";
  return { ok: false, code, retryAfterSeconds: retry, message: explainFaucet(code, raw, retry) };
}

/** The faucet's own messages are already plain English; this only adds the wait time and covers odd failures. */
export function explainFaucet(code: string, raw: string, retryAfterSeconds?: number): string {
  const wait = retryAfterSeconds ? ` Try again in about ${fmtWait(retryAfterSeconds)}.` : "";
  switch (code) {
    case "address_cooldown":
      return `This profile already received devnet funds recently.${wait} You can create another profile if you need more now.`;
    case "ip_limit":
    case "too_many_requests":
    case "faucet_busy":
      return `${raw || "The faucet is busy."}${wait}`;
    case "already_funded":
      return raw || "This profile already has plenty of VAULT.";
    case "faucet_empty":
      return "The faucet is out of funds right now. Please try again later.";
    case "disabled":
      return "The faucet is switched off right now.";
    default:
      return raw ? `${raw}${wait}` : `The faucet could not send funds right now.${wait} Please try again in a moment.`;
  }
}
