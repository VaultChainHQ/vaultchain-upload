/** Seconds per block on the public devnet. Only used to turn block counts into rough durations. */
export const BLOCK_SECONDS = 3;
const UVAULT = 1_000_000n;

/** "1950", "0.0015": a bare amount without a unit or grouping (6 decimals max). */
export function fmtVault(amount: string | bigint): string {
  const u = typeof amount === "bigint" ? amount : BigInt(amount || "0");
  const whole = u / UVAULT;
  const frac = (u % UVAULT).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** "1,950 VAULT" / "0.0015 VAULT": what people should see instead of raw uvault. */
export function vault(amount: string | bigint): string {
  const u = typeof amount === "bigint" ? amount : BigInt(amount || "0");
  const whole = (u / UVAULT).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (u % UVAULT).toString().padStart(6, "0").replace(/0+$/, "");
  return `${frac ? `${whole}.${frac}` : whole} VAULT`;
}

export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "–";
  if (n < 1024) return `${n} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 2 : 1)} ${units[i]}`;
}

export function short(s: string, head = 8, tail = head): string {
  return s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
}

/** A span of blocks as a rough human duration: "about 8 hours". */
export function fmtDuration(blocks: number): string {
  const s = Math.max(0, Math.round(blocks * BLOCK_SECONDS));
  if (s < 5) return "a moment";
  if (s < 60) return `about ${s} seconds`;
  const m = Math.round(s / 60);
  if (m < 90) return `about ${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.round(s / 3600);
  if (h < 36) return `about ${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.round(s / 86400);
  return `about ${d} day${d === 1 ? "" : "s"}`;
}

/** "just now" / "about 2 minutes ago", given how many blocks ago something happened. */
export function fmtAgo(blocksAgo: number): string {
  if (blocksAgo <= 1) return "just now";
  return `${fmtDuration(blocksAgo)} ago`;
}

/** "in about 8 hours" / "ended about 2 hours ago" for a target height. */
export function fmtWhen(target: number, now: number | undefined): string {
  if (now === undefined) return `at block ${target}`;
  if (target > now) return `in ${fmtDuration(target - now)}`;
  return fmtAgo(now - target);
}

export const ADDRESS_RE = /^vault1[02-9ac-hj-np-z]{20,80}$/;
export const HEX64_RE = /^[0-9a-fA-F]{64}$/;

/** "45 seconds" / "12 minutes" / "1 h 30 min": a wait given in seconds (faucet cooldowns). */
export function fmtWait(seconds: number): string {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} seconds`;
  const m = Math.round(seconds / 60);
  if (m < 90) return `${m} minutes`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h} h ${rem} min` : `${h} h`;
}
