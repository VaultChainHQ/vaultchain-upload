// Pure helpers behind the "My files" page: how healthy a file is, filtering, sorting, and what can be previewed.
import { fmtDuration } from "./format";
import type { Deal, ManifestRecord } from "./vault/client";

export type Level = "ok" | "warn" | "bad" | "idle" | "info";
export interface FileHealth {
  level: Level;
  label: string;
  why: string;
  /** Blocks until the storage term ends, when a deal is running. */
  blocksLeft?: number;
  /** True only when the file is really at risk: failed, never stored, or about to lapse (or already lapsed) with nothing renewing it. */
  attention: boolean;
}

const RANK: Record<string, number> = { open: 4, pending: 3, closed: 2, failed: 1, cancelled: 0 };

/**
 * The deal that best describes a file's state: a running deal beats a finished one. Among running deals the one that lasts longest wins,
 * so a file that was renewed (a second deal that ends later) is judged by the renewal, not by the first deal that is about to end.
 */
export function bestDeal(deals: Deal[]): Deal | undefined {
  return [...deals].sort((a, b) => {
    const r = (RANK[b.status] ?? -1) - (RANK[a.status] ?? -1);
    if (r) return r;
    if (a.status === "open" || a.status === "pending") return b.expire_height - a.expire_height || b.id - a.id;
    return b.id - a.id;
  })[0];
}

/** Within this many blocks of the end (about 50 minutes) a running deal is flagged as ending soon. */
export const ENDING_SOON_BLOCKS = 1000;

/** A deal that paid for at most this many blocks (about 4 hours) is a quick test, not a real storage term. */
export const SHORT_TERM_BLOCKS = 5000;

export const isShortTerm = (d: Pick<Deal, "start_height" | "expire_height">): boolean => d.expire_height - d.start_height <= SHORT_TERM_BLOCKS;

export function fileHealth(deals: Deal[], height: number | undefined): FileHealth {
  const d = bestDeal(deals);
  if (!d)
    return { level: "bad", attention: true, label: "Not stored", why: "The file is recorded on the chain but no storage deal exists, so nobody is paid to keep it. Upload it again to open a deal." };
  const left = height !== undefined ? d.expire_height - height : undefined;
  const short = isShortTerm(d);
  switch (d.status) {
    case "pending":
      return { level: "warn", attention: false, label: "Starting", why: "The deal is open and a provider is being chosen. This usually takes a few blocks.", blocksLeft: left };
    case "open": {
      const active = d.replicas.filter((r) => r.status === "active").length;
      if (!active) return { level: "warn", attention: false, label: "Waiting for provider", why: "A provider has been picked but has not confirmed it holds the file yet.", blocksLeft: left };
      if (short)
        return {
          level: "info",
          attention: false,
          label: "Short test duration",
          why:
            left !== undefined && left > 0
              ? `A provider holds it. You chose a short storage term (${fmtDuration(d.expire_height - d.start_height)}), so it ends in ${fmtDuration(left)}. That is fine for a test, nothing is wrong. Choose a longer term to keep files.`
              : "You chose a short storage term and it is ending. That is fine for a test, nothing is wrong. Choose a longer term to keep files.",
          blocksLeft: left,
        };
      if (left !== undefined && left <= 0) return { level: "warn", attention: true, label: "Ending now", why: "The storage term is ending and nothing renews it. Upload the file again to keep it.", blocksLeft: left };
      if (left !== undefined && left <= ENDING_SOON_BLOCKS)
        return { level: "warn", attention: true, label: "Ends soon", why: `A provider holds it, but the paid storage ends in ${fmtDuration(left)} and no renewal is running. Upload it again to extend it.`, blocksLeft: left };
      return {
        level: "ok",
        attention: false,
        label: "Stored",
        why: left !== undefined ? `A provider holds the file and is proving it. Paid storage runs for ${fmtDuration(left)} more.` : "A provider holds the file and is proving it.",
        blocksLeft: left,
      };
    }
    case "closed":
      if (short) return { level: "idle", attention: false, label: "Test storage ended", why: "The short storage term you chose has finished, as expected. The file may no longer be available. Upload it again if you still need it." };
      return { level: "idle", attention: true, label: "Storage ended", why: "The paid storage term finished and nothing renewed it. The file may no longer be available. Upload it again to store it for longer." };
    case "failed":
      return { level: "bad", attention: true, label: "Failed", why: "The term ended and no provider proved it stored the file." };
    case "cancelled":
      return { level: "idle", attention: false, label: "Cancelled", why: "This deal was cancelled before it finished." };
    default:
      return { level: "idle", attention: false, label: d.status, why: "Status reported by the chain." };
  }
}

export type LibFilter = "all" | "private" | "public" | "attention";
export type LibSort = "newest" | "oldest" | "name" | "size";

export interface LibRow {
  rec: ManifestRecord;
  health: FileHealth;
}

export const isEncrypted = (rec: Pick<ManifestRecord, "encryption">): boolean => !!rec.encryption;

export function needsAttention(h: FileHealth): boolean {
  return h.attention;
}

export function filterRows(rows: LibRow[], o: { q?: string; filter?: LibFilter; sort?: LibSort }): LibRow[] {
  const q = (o.q ?? "").trim().toLowerCase();
  let out = rows.filter((r) => {
    if (q && !(r.rec.name.toLowerCase().includes(q) || r.rec.root.toLowerCase().startsWith(q.replace(/^0x/, "")) || (r.rec.mime || "").toLowerCase().includes(q))) return false;
    switch (o.filter) {
      case "private":
        return isEncrypted(r.rec);
      case "public":
        return !isEncrypted(r.rec);
      case "attention":
        return needsAttention(r.health);
      default:
        return true;
    }
  });
  const by = o.sort ?? "newest";
  out = [...out].sort((a, b) => {
    switch (by) {
      case "oldest":
        return a.rec.height - b.rec.height;
      case "name":
        return a.rec.name.localeCompare(b.rec.name, undefined, { sensitivity: "base" });
      case "size":
        return b.rec.size - a.rec.size;
      default:
        return b.rec.height - a.rec.height;
    }
  });
  return out;
}

export type PreviewKind = "image" | "video" | "audio" | "pdf" | "text" | null;
/** Largest file we preview inline. Bigger ones can still be downloaded. */
export const PREVIEW_MAX_BYTES = 25 * 1024 * 1024;

export function previewKind(mime: string, size: number): PreviewKind {
  if (size > PREVIEW_MAX_BYTES) return null;
  const m = (mime || "").toLowerCase().split(";")[0].trim();
  if (/^image\/(png|jpe?g|gif|webp|avif|bmp)$/.test(m)) return "image";
  if (/^video\/(mp4|webm|ogg|quicktime)$/.test(m)) return "video";
  if (/^audio\/(mpeg|mp3|ogg|wav|x-wav|webm|aac|mp4|flac)$/.test(m)) return "audio";
  if (m === "application/pdf") return "pdf";
  if (m.startsWith("text/") || m === "application/json") return size <= 512 * 1024 ? "text" : null;
  return null;
}

/** Link to share a file: it opens the recipient straight onto it. */
export function shareLink(root: string, origin: string): string {
  return `${origin.replace(/\/+$/, "")}/files?open=${root}`;
}

export function isRoot(s: string | null | undefined): s is string {
  return !!s && /^[0-9a-f]{64}$/i.test(s);
}

/** What to call someone: a contact name, "You", or a shortened address. */
export function nameFor(addr: string, me: { address: string; name: string }, contacts: { name: string; address: string }[], shorten: (s: string) => string): string {
  if (addr === me.address) return `${me.name} (you)`;
  return contacts.find((c) => c.address === addr)?.name ?? shorten(addr);
}
