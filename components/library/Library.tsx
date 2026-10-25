"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import type { Unlocked } from "@/lib/session";
import type { ProfileRecord } from "@/lib/vaultstore";
import { fmtBytes, fmtWhen, short } from "@/lib/format";
import { node, usePoll } from "@/lib/hooks";
import { filterRows, isRoot, nameFor, fileHealth, type LibFilter, type LibRow, type LibSort } from "@/lib/library";
import { EmptyState, ErrorNote, Pill, Skeleton } from "../ui";
import { FileActions } from "./Download";
import { FileRow } from "./FileRow";

type Tab = "mine" | "shared";

export function Library({ profile, unlocked }: { profile: ProfileRecord; unlocked: Unlocked | null }) {
  const params = useSearchParams();
  const openRoot = params.get("open");
  const [tab, setTab] = useState<Tab>("mine");
  return (
    <div>
      {isRoot(openRoot) ? <OpenedFile root={openRoot} profile={profile} unlocked={unlocked} /> : openRoot ? <p className="callout warn">That link does not look like a file link, so it was ignored.</p> : null}
      <div className="tabs" role="tablist" aria-label="File lists">
        <button type="button" role="tab" id="tab-mine" aria-selected={tab === "mine"} aria-controls="panel-files" className={tab === "mine" ? "on" : ""} onClick={() => setTab("mine")}>
          My files
        </button>
        <button type="button" role="tab" id="tab-shared" aria-selected={tab === "shared"} aria-controls="panel-files" className={tab === "shared" ? "on" : ""} onClick={() => setTab("shared")}>
          Shared with me
        </button>
      </div>
      <div role="tabpanel" id="panel-files" aria-labelledby={tab === "mine" ? "tab-mine" : "tab-shared"}>
        {tab === "mine" ? <MyFiles profile={profile} unlocked={unlocked} openRoot={isRoot(openRoot) ? openRoot : null} /> : <SharedWithMe profile={profile} unlocked={unlocked} />}
      </div>
    </div>
  );
}

function MyFiles({ profile, unlocked, openRoot }: { profile: ProfileRecord; unlocked: Unlocked | null; openRoot: string | null }) {
  const addr = profile.entry.address;
  const q = usePoll(
    `files:${addr}`,
    async () => {
      const [m, d, i] = await Promise.all([node.manifests(addr), node.deals({ owner: addr }), node.info()]);
      return { manifests: m, deals: d, height: i.height };
    },
    12_000,
  );
  const [text, setText] = useState("");
  const [filter, setFilter] = useState<LibFilter>("all");
  const [sort, setSort] = useState<LibSort>("newest");

  const rows: LibRow[] = useMemo(
    () => (q.data ? q.data.manifests.map((rec) => ({ rec, health: fileHealth(q.data!.deals.filter((d) => d.cid === rec.root), q.data!.height) })) : []),
    [q.data],
  );
  const shown = filterRows(rows, { q: text, filter, sort });
  const attention = rows.filter((r) => filterRows([r], { filter: "attention" }).length).length;

  if (q.loading) return <Skeleton lines={4} />;
  return (
    <div>
      <ErrorNote error={q.error} title="Could not load your files." />
      {q.data && rows.length === 0 ? (
        <EmptyState
          icon="🗂"
          title="No files yet"
          action={
            <Link href="/" className="btn primary">
              Upload your first file
            </Link>
          }
        >
          Files you store appear here, with how long they are paid for and who can open them. The list comes from the chain, so it is the same on any device you sign in on.
        </EmptyState>
      ) : null}
      {rows.length > 0 ? (
        <>
          <div className="libbar" role="search">
            <input type="search" aria-label="Search your files" placeholder="Search by name, type or file ID" value={text} onChange={(e) => setText(e.target.value)} />
            <select aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value as LibFilter)}>
              <option value="all">All files</option>
              <option value="private">Private</option>
              <option value="public">Public</option>
              <option value="attention">Needs attention{attention ? ` (${attention})` : ""}</option>
            </select>
            <select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as LibSort)}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="name">Name</option>
              <option value="size">Largest first</option>
            </select>
          </div>
          <p className="muted small" role="status">
            {shown.length === rows.length ? `${rows.length} file${rows.length === 1 ? "" : "s"}` : `${shown.length} of ${rows.length} files`}
            {attention && filter !== "attention" ? (
              <>
                {" "}· <button type="button" className="linklike" onClick={() => setFilter("attention")}>{attention} need attention</button>
              </>
            ) : null}
          </p>
          {shown.length === 0 ? (
            <EmptyState icon="🔎" title="Nothing matches" action={<button type="button" className="btn" onClick={() => (setText(""), setFilter("all"))}>Clear search and filters</button>}>
              Try a different word, or clear the filters.
            </EmptyState>
          ) : (
            <ul className="files">
              {shown.map((r) => (
                <FileRow key={r.rec.root} rec={r.rec} deals={q.data!.deals.filter((d) => d.cid === r.rec.root)} height={q.data!.height} profile={profile} unlocked={unlocked} opened={r.rec.root === openRoot} />
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}

function SharedWithMe({ profile, unlocked }: { profile: ProfileRecord; unlocked: Unlocked | null }) {
  const addr = profile.entry.address;
  const me = { address: addr, name: profile.entry.name };
  const q = usePoll(
    `shared:${addr}`,
    async () => {
      const [grants, i] = await Promise.all([node.grants(), node.info()]);
      const mine = grants.filter((g) => g.grantee === addr);
      const recs = await Promise.all(mine.map((g) => node.manifest(g.cid)));
      return { rows: mine.map((g, n) => ({ g, rec: recs[n] })), height: i.height };
    },
    20_000,
  );
  if (q.loading) return <Skeleton lines={3} />;
  return (
    <div>
      <ErrorNote error={q.error} title="Could not load shared files." />
      {q.data && q.data.rows.length === 0 ? (
        <EmptyState icon="📬" title="Nothing shared with you yet">
          When someone shares a file with your address, it appears here. Give them your address from the Account page (and press “Publish my key” there first, so they can lock files for you).
        </EmptyState>
      ) : null}
      <ul className="files">
        {q.data?.rows.map(({ g, rec }) => {
          const expired = g.expiry_height <= q.data!.height;
          return (
            <li key={g.id} className="file">
              <div className="file-head">
                <div className="file-main">
                  <span className="file-title">{rec?.name ?? short(g.cid, 10, 6)}</span>
                  <span className="file-meta">
                    {rec?.encryption ? <Pill tone="info">Private</Pill> : null}
                    {expired ? <Pill tone="bad">Access ended</Pill> : <Pill tone="ok">You have access</Pill>}
                    <span>from {nameFor(g.owner, me, profile.contacts, (a) => short(a, 12, 6))}</span>
                    {rec ? <span>{fmtBytes(rec.size)}</span> : null}
                    <span>{expired ? "ended" : "until"} {fmtWhen(g.expiry_height, q.data!.height)}</span>
                  </span>
                </div>
                <div className="file-actions">{!expired ? <FileActions root={g.cid} unlocked={unlocked} name={rec?.name} mime={rec?.mime} size={rec?.size ?? 0} profile={profile} /> : null}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A file reached through a link: what it is, who owns it, and (when you can open it) a Download button. */
function OpenedFile({ root, profile, unlocked }: { root: string; profile: ProfileRecord; unlocked: Unlocked | null }) {
  const q = usePoll(
    `open:${root}`,
    async () => {
      const [rec, deals, info] = await Promise.all([node.manifest(root), node.deals({ cid: root }), node.info()]);
      return { rec, deals, height: info.height };
    },
    0,
  );
  const me = { address: profile.entry.address, name: profile.entry.name };
  if (q.loading) return <div className="panel"><Skeleton lines={3} /></div>;
  if (q.error) return <ErrorNote error={q.error} title="Could not look up that file." />;
  if (!q.data?.rec)
    return (
      <div className="callout warn" role="alert">
        <strong>We could not find that file.</strong> It may have been mistyped, or the devnet was reset since the link was made (a reset erases every file).
      </div>
    );
  const { rec, deals, height } = q.data;
  const mine = rec.owner === me.address;
  if (mine) return null; // shown, highlighted, in My files below
  const h = fileHealth(deals, height);
  return (
    <section className="panel opened-file" aria-labelledby="opened-h">
      <p className="eyebrow">Shared link</p>
      <h2 id="opened-h" className="wrap-any">{rec.name || "(unnamed)"}</h2>
      <p className="file-meta">
        {rec.encryption ? <Pill tone="info">Private</Pill> : <Pill tone="warn">Public</Pill>}
        <Pill tone={h.level} title={h.why}>{h.label}</Pill>
        <span>{fmtBytes(rec.size)}</span>
        <span>from {nameFor(rec.owner, me, profile.contacts, (a) => short(a, 12, 6))}</span>
      </p>
      <p className="muted small">{h.why}</p>
      {rec.encryption ? (
        <p className="callout">This file is private. It opens for you only if its owner shared it with your address ({short(me.address, 10, 6)}). If not, ask them to share it; you may need to publish your key first (Account page).</p>
      ) : null}
      <FileActions root={rec.root} unlocked={unlocked} name={rec.name} mime={rec.mime} size={rec.size} profile={profile} />
    </section>
  );
}
