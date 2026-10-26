// Cost and duration maths for the upload flow. It mirrors the chain's price rule, so the number
// shown in the review step is what the chain will escrow:
//
//   escrow = ceil(storedBytes / 1 GiB) * price_per_gb * max(1, floor(durationBlocks / 1000))
//
// plus one network fee per transaction (one to record the file, one to open the storage deal).
import { BLOCK_SECONDS, fmtBytes, fmtDuration } from "./format";
import { ciphertextSize } from "./vault/vaultcrypt";

export const GIB = 1024 * 1024 * 1024;
/** Default network fee per transaction, in uvault. */
export const FEE_UVAULT = 1000n;
/** Transactions a fresh upload signs: record the file (CommitManifest) and open the deal (OpenDeal). */
export const TXS_PER_UPLOAD = 2n;
/** The chain prices storage in whole units of 1,000 blocks. */
export const PRICE_BLOCK_UNIT = 1000;
/** Fallback if the node's pricing cannot be read: 1 VAULT per GiB per 1,000 blocks (the devnet default). */
export const FALLBACK_PRICE_PER_GB = 1_000_000n;
/**
 * Per-file cap. Files are read in slices and kept as chunks in the browser's IndexedDB, so memory is not the limit any more.
 * The real ceilings are the chain (max_object_bytes = 4 GiB), the storage provider (700 MB of capacity on this devnet, shared by everyone;
 * the upload engine also checks its free space before paying) and how long you want to wait and how much disk the browser grants.
 */
export const MAX_FILE_BYTES = 256 * 1024 * 1024;
/** Per-batch cap: files go one after another, so this only bounds the total time and provider space one batch can take. */
export const MAX_BATCH_BYTES = 512 * 1024 * 1024;
export const MAX_FILES = 20;

export interface DurationChoice {
  blocks: number;
  /** Short plain label shown on the option. */
  label: string;
  note: string;
}

export const DURATIONS: readonly DurationChoice[] = [
  { blocks: 1_000, label: "About 1 hour", note: "A quick test or a hand-off." },
  { blocks: 5_000, label: "About 4 hours", note: "A working session." },
  { blocks: 10_000, label: "About 8 hours", note: "A working day. The default." },
  { blocks: 30_000, label: "About 1 day", note: "Overnight and then some." },
  { blocks: 100_000, label: "About 3 days", note: "Costs more than one faucet request." },
];
export const DEFAULT_DURATION = 10_000;

/** Whether `blocks` is one of the offered durations. */
export const isDuration = (blocks: number): boolean => DURATIONS.some((d) => d.blocks === blocks);

/** Rough wall-clock length of a block count ("about 8 hours"). */
export const durationLabel = (blocks: number): string => fmtDuration(blocks);

/** Blocks that cover roughly `hours`, rounded up to the chain's pricing unit. */
export function blocksForHours(hours: number): number {
  const raw = Math.ceil((hours * 3600) / BLOCK_SECONDS);
  return Math.max(PRICE_BLOCK_UNIT, Math.ceil(raw / PRICE_BLOCK_UNIT) * PRICE_BLOCK_UNIT);
}

/** Bytes the provider stores for a file of `size` bytes. */
export function storedBytes(size: number, encrypted: boolean): number {
  return encrypted ? ciphertextSize(size) : size;
}

/** Storage escrow for one object. Never below one pricing unit. */
export function escrowFor(stored: number, durationBlocks: number, pricePerGb: bigint): bigint {
  const gibs = BigInt(Math.max(1, Math.ceil(stored / GIB)));
  const units = BigInt(Math.max(1, Math.floor(durationBlocks / PRICE_BLOCK_UNIT)));
  return gibs * pricePerGb * units;
}

export interface CostLine {
  name: string;
  size: number;
  stored: number;
  escrow: bigint;
  fees: bigint;
}

export interface CostEstimate {
  lines: CostLine[];
  escrow: bigint;
  fees: bigint;
  total: bigint;
}

export function estimateCost(files: { name: string; size: number }[], o: { encrypt: boolean; durationBlocks: number; pricePerGb: bigint; fee?: bigint }): CostEstimate {
  const fee = o.fee ?? FEE_UVAULT;
  const lines = files.map((f) => {
    const stored = storedBytes(f.size, o.encrypt);
    return { name: f.name, size: f.size, stored, escrow: escrowFor(stored, o.durationBlocks, o.pricePerGb), fees: fee * TXS_PER_UPLOAD };
  });
  const escrow = lines.reduce((a, l) => a + l.escrow, 0n);
  const fees = lines.reduce((a, l) => a + l.fees, 0n);
  return { lines, escrow, fees, total: escrow + fees };
}

export type FundsCheck = { ok: true } | { ok: false; shortBy: bigint };

export function checkFunds(balance: bigint | undefined, cost: CostEstimate): FundsCheck | undefined {
  if (balance === undefined) return undefined;
  return balance >= cost.total ? { ok: true } : { ok: false, shortBy: cost.total - balance };
}

export interface FileIssue {
  name: string;
  reason: "empty" | "too-large";
  message: string;
}

/** Splits a picked list into files we can upload and files we refuse, with a plain reason for each. */
export function validateFiles(
  picked: { name: string; size: number }[],
  existing: { name: string; size: number }[] = [],
): { accepted: number[]; issues: FileIssue[] } {
  const accepted: number[] = [];
  const issues: FileIssue[] = [];
  let count = existing.length;
  let bytes = existing.reduce((a, f) => a + f.size, 0);
  picked.forEach((f, i) => {
    if (f.size === 0) return void issues.push({ name: f.name, reason: "empty", message: `“${f.name}” is empty. Empty files cannot be stored.` });
    if (f.size > MAX_FILE_BYTES)
      return void issues.push({
        name: f.name,
        reason: "too-large",
        message: `“${f.name}” is ${fmtMB(f.size)}. Each file here is limited to ${fmtMB(MAX_FILE_BYTES)} (the devnet storage provider has limited space). The command line tool can store larger files.`,
      });
    if (count >= MAX_FILES) return void issues.push({ name: f.name, reason: "too-large", message: `Only ${MAX_FILES} files per upload. “${f.name}” was not added.` });
    if (bytes + f.size > MAX_BATCH_BYTES)
      return void issues.push({ name: f.name, reason: "too-large", message: `“${f.name}” would take this upload past ${fmtMB(MAX_BATCH_BYTES)} in total. Upload it separately.` });
    accepted.push(i);
    count++;
    bytes += f.size;
  });
  return { accepted, issues };
}

const fmtMB = fmtBytes;
