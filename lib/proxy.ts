// Pure helpers for the provider proxy route, kept separate so they can be unit tested.

const ROOT = "[0-9a-f]{64}";
const ALLOWED = [
  /^status$/,
  /^version$/,
  new RegExp(`^v1/objects/${ROOT}$`),
  new RegExp(`^v1/objects/${ROOT}/status$`),
  new RegExp(`^v1/chunks/${ROOT}/[0-9]{1,9}$`),
];

export function isAllowedProviderPath(path: string): boolean {
  return ALLOWED.some((re) => re.test(path));
}

/** Only these request headers are forwarded to the provider. */
export const FORWARD_REQUEST_HEADERS = ["content-type", "authorization", "x-vault-proof", "range"];
/** Only these response headers are returned to the browser. */
export const FORWARD_RESPONSE_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "x-vault-proof", "cache-control"];

export function providerTarget(): string {
  return (process.env.VAULT_PROVIDER_URL || process.env.NEXT_PUBLIC_VAULT_PROVIDER || "https://vaultl1-provider.fly.dev").replace(/\/+$/, "");
}
