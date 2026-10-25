// Pure helpers behind the "My files" page: how healthy a file is, filtering, sorting, and what can be previewed.
import { fmtDuration } from "./format";
import type { Deal, ManifestRecord } from "./vault/client";

export type Level = "ok" | "warn" | "bad" | "idle";
export interface FileHealth {
  level: Level;
  label: string;
  why: string;
  /** Blocks until the storage term ends, when a deal is running. */
  blocksLeft?: number;
}

const RANK: Record<string, number> = { open: 4, pending: 3, closed: 2, failed: 1, cancelled: 0 };

/** The deal that best describes a file's state: a running deal beats a finished one, newer beats older. */
export function bestDeal(deals: Deal[]): Deal | undefined {
  return [...deals].sort((a, b) => (RANK[b.status] ?? -1) - (RANK[a.status] ?? -1) || b.id - a.id)[0];
}

/** Within this many blocks of the end (about 50 minutes) a running deal is flagged as ending soon. */
export const ENDING_SOON_BLOCKS = 1000;

export function fileHealth(deals: Deal[], height: number | undefined): FileHealth {
  const d = bestDeal(deals);
  if (!d) return { level: "bad", label: "Not stored", why: "The file is recorded on the chain but no storage deal exists, so nobody is paid to keep it. Upload it again to open a deal." };
  const left = height !== undefined ? d.expire_height - height : undefined;
  switch (d.status) {
    case "pending":
      return { level: "warn", label: "Starting", why: "The deal is open and a provider is being chosen. This usually takes a few blocks.", blocksLeft: left };
    case "open": {
      const active = d.replicas.filter((r) => r.status === "active").length;
      if (!active) return { level: "warn", label: "Waiting for provider", why: "A provider has been picked but has not confirmed it holds the file yet.", blocksLeft: left };
      if (left !== undefined && left <= 0) return { level: "warn", label: "Ending now", why: "The storage term is ending.", blocksLeft: left };
      if (left !== undefined && left <= ENDING_SOON_BLOCKS)
        return { level: "warn", label: "Ends soon", why: `A provider holds it, but the paid storage ends in ${fmtDuration(left)}. Upload it again to extend it.`, blocksLeft: left };
      return {
        level: "ok",
        label: "Stored",
        why: left !== undefined ? `A provider holds the file and is proving it. Paid storage runs for ${fmtDuration(left)} more.` : "A provider holds the file and is proving it.",
        blocksLeft: left,
      };
    }
    case "closed":
      return { level: "idle", label: "Storage ended", why: "The paid storage term finished. The file may no longer be available. Upload it again to store it for longer." };
    case "failed":
      return { level: "bad", label: "Failed", why: "The term ended and no provider proved it stored the file." };
    case "cancelled":
      return { level: "idle", label: "Cancelled", why: "This deal was cancelled before it finished." };
    default:
      return { level: "idle", label: d.status, why: "Status reported by the chain." };
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
  return h.level === "bad" || h.level === "warn" || h.label === "Storage ended";
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
