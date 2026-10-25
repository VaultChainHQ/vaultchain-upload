"use client";
import { useState } from "react";
import { errMsg, fmtBytes, node, provider, saveBytes, short, usePoll } from "@/lib/hooks";
import type { Deal, Grant, ManifestRecord } from "@/lib/vault/client";
import { downloadObject, grantRead, revokeRead, signerFromKey, type Signer } from "@/lib/vault/flows";
import type { KeyPair } from "@/lib/vault/keys";

interface Mine {
  manifests: ManifestRecord[];
  deals: Deal[];
  grants: Grant[];
  shared: ManifestRecord[];
}

async function load(addr: string): Promise<Mine> {
  const [manifests, deals, grants] = await Promise.all([node.manifests(addr), node.deals({ owner: addr }), node.grants()]);
  const incoming = grants.filter((g) => g.grantee === addr && g.owner !== addr);
  const shared = (await Promise.all([...new Set(incoming.map((g) => g.cid))].map((c) => node.manifest(c)))).filter((m): m is ManifestRecord => !!m);
  return { manifests, deals, grants, shared };
}

function FileRow({ m, kp, deals, grants, mine, onChange }: { m: ManifestRecord; kp: KeyPair; deals: Deal[]; grants: Grant[]; mine: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>();
  const [err, setErr] = useState<string>();
  const [grantee, setGrantee] = useState("");
  const [expiry, setExpiry] = useState(0);
  const signer: Signer = signerFromKey(kp);
  const encrypted = m.encryption === "vle1";

  const act = async (f: () => Promise<void>) => {
    setBusy(true);
    setErr(undefined);
    setStatus(undefined);
    try {
      await f();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="file">
      <div className="filehead">
        <b>{m.name || "(unnamed)"}</b>
        <span className="muted">
          {fmtBytes(m.size)} · {m.mime || "?"} · {encrypted ? "encrypted (vle1)" : "plaintext"}
        </span>
      </div>
      <div className="muted">
        root <code title={m.root}>{short(m.root, 10)}</code> · committed at height {m.height}
        {!mine && <> · owner <code>{short(m.owner, 8)}</code></>}
      </div>
      {deals.map((d) => (
        <div key={d.id} className="muted">
          deal #{d.id}: {d.status}, expires at height {d.expire_height}, replicas {d.replicas?.map((r) => r.status).join(", ") || "none"}
        </div>
      ))}
      <div className="actions">
        <button
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const d = await downloadObject({ node, provider, signer, root: m.root, progress: (s) => setStatus(s) });
              saveBytes(d.data, d.name, d.mime);
              setStatus(d.decrypted ? "Downloaded and decrypted" : "Downloaded");
            })
          }
        >
          Download{encrypted ? " + decrypt" : ""}
        </button>
        {mine && encrypted && (
          <button
            disabled={busy}
            title="Download the encrypted bytes without decrypting"
            onClick={() =>
              void act(async () => {
                const d = await downloadObject({ node, provider, signer, root: m.root, decrypt: false, progress: (s) => setStatus(s) });
                saveBytes(d.data, `${d.name}.vle1`, "application/octet-stream");
                setStatus("Downloaded ciphertext");
              })
            }
          >
            Raw ciphertext
          </button>
        )}
      </div>
      {mine && (
        <details>
          <summary>Sharing ({grants.length})</summary>
          {grants.length > 0 && (
            <ul className="grants">
              {grants.map((g) => (
                <li key={g.id}>
                  <code>{g.grantee === "*" ? "everyone (*)" : short(g.grantee, 10)}</code> · {g.capability}
                  {g.expiry_height ? ` · until height ${g.expiry_height}` : ""}
                  <button
                    className="link danger"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await revokeRead(node, signer, m, { grantId: g.id }, setStatus);
                        setStatus("Revoked");
                        onChange();
                      })
                    }
                  >
                    revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid2">
            <label className="col">
              <span>Grant read access to</span>
              <input value={grantee} onChange={(e) => setGrantee(e.target.value.trim())} placeholder="vault1… (or * for public, plaintext only)" />
            </label>
            <label className="col">
              <span>Expires at height (0 = never)</span>
              <input type="number" min={0} value={expiry} onChange={(e) => setExpiry(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
            </label>
          </div>
          <button
            disabled={busy || !grantee}
            onClick={() =>
              void act(async () => {
                await grantRead(node, signer, m, grantee, expiry, setStatus);
                setStatus("Granted");
                setGrantee("");
                onChange();
              })
            }
          >
            Grant read
          </button>
        </details>
      )}
      {status && <p className="muted">{status}</p>}
      {err && <p className="error">{err}</p>}
    </li>
  );
}

export function Files({ kp, tick, onChange }: { kp: KeyPair | null; tick: number; onChange: () => void }) {
  const { data, error, reload } = usePoll(() => (kp ? load(kp.address) : Promise.resolve(undefined)), 15_000, `${kp?.address}:${tick}`);
  const refresh = () => {
    reload();
    onChange();
  };
  return (
    <section className="card">
      <h2>My files</h2>
      {!kp && <p className="muted">Create or import a key to see your files.</p>}
      {error && <p className="error">{error}</p>}
      {kp && data && (
        <>
          {data.manifests.length === 0 && <p className="muted">No files yet.</p>}
          <ul className="files">
            {[...data.manifests].reverse().map((m) => (
              <FileRow key={m.root} m={m} kp={kp} mine deals={data.deals.filter((d) => d.cid === m.root)} grants={data.grants.filter((g) => g.cid === m.root)} onChange={refresh} />
            ))}
          </ul>
          {data.shared.length > 0 && (
            <>
              <h3>Shared with me</h3>
              <ul className="files">
                {data.shared.map((m) => (
                  <FileRow key={m.root} m={m} kp={kp} mine={false} deals={[]} grants={[]} onChange={refresh} />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
