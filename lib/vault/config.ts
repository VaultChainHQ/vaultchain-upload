export const DEFAULT_REST = "https://vaultl1-devnet.fly.dev";
export const DEFAULT_PROVIDER = "https://vaultl1-provider.fly.dev";

/** Public devnet node REST endpoint (it answers CORS with `*`, so the browser calls it directly). */
export const NODE_URL = (process.env.NEXT_PUBLIC_VAULT_REST || DEFAULT_REST).replace(/\/+$/, "");

/** Public provider endpoint. Only used directly in "direct" mode. */
export const PROVIDER_URL = (process.env.NEXT_PUBLIC_VAULT_PROVIDER || DEFAULT_PROVIDER).replace(/\/+$/, "");

/**
 * "proxy" (default): the browser talks to this site's /api/provider route, which forwards the
 * request to the provider. Needed while the provider has no CORS origin configured for this site.
 * "direct": the browser talks to the provider itself (set the provider's ALLOW_ORIGIN to this site).
 * Either way the proxy only ever sees ciphertext/plaintext chunks and signed read tokens, never a private key.
 */
export type ProviderMode = "proxy" | "direct";
export const PROVIDER_MODE: ProviderMode = process.env.NEXT_PUBLIC_VAULT_PROVIDER_MODE === "direct" ? "direct" : "proxy";

export const DENOM = "uvault";
export const DEFAULT_DEAL_BLOCKS = 10000;
