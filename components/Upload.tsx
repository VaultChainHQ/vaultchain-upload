"use client";
import { useRef, useState } from "react";
import { errMsg, fmtBytes, node, provider } from "@/lib/hooks";
import { DEFAULT_DEAL_BLOCKS } from "@/lib/vault/config";
import { signerFromKey, uploadObject, type UploadResult } from "@/lib/vault/flows";
import type { KeyPair } from "@/lib/vault/keys";

// The chain allows much larger objects; this cap only keeps the whole file + ciphertext in browser memory.
const MAX_BROWSER_BYTES = 64 * 1024 * 1024;

export function Upload({ kp, onDone }: { kp: KeyPair | null; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [encrypt, setEncrypt] = useState(true);
  const [blocks, setBlocks] = useState(DEFAULT_DEAL_BLOCKS);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [frac, setFrac] = useState<number>();
  const [result, setResult] = useState<UploadResult>();
  const [err, setErr] = useState<string>();

  const start = async () => {
    if (!kp || !file) return;
    setBusy(true);
    setErr(undefined);
    setResult(undefined);
    setLog([]);
    setFrac(undefined);
    try {
      if (file.size > MAX_BROWSER_BYTES) throw new Error("file is larger than the 64 MiB browser limit of this site");
      const data = new Uint8Array(await file.arrayBuffer());
      const r = await uploadObject({
        node,
        provider,
        signer: signerFromKey(kp),
        data,
        name: file.name,
        mime: file.type || "application/octet-stream",
        encrypt,
        durationBlocks: blocks,
        progress: (s, f) => {
          setFrac(f);
          setLog((l) => (l[l.length - 1] === s ? l : [...l, s]));
        },
      });
      setResult(r);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      onDone();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>Upload</h2>
      {!kp && <p className="muted">Create or import a key first.</p>}
      <label className="col">
        <span>File (max 64 MiB)</span>
        <input ref={fileRef} type="file" disabled={!kp || busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={encrypt} disabled={busy} onChange={(e) => setEncrypt(e.target.checked)} />
        Encrypt in the browser before upload (recommended). Without it, the provider and anyone with a read token or grant can read the plaintext.
      </label>
      <label className="col">
        <span>Storage duration (blocks)</span>
        <input type="number" min={1} value={blocks} disabled={busy} onChange={(e) => setBlocks(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
      </label>
      <p className="muted">
        Uploading sends up to two signed transactions (commit manifest, open deal). Each pays a network fee (1000 uvault); the deal price is computed by the chain and escrowed from your balance.
      </p>
      <button className="primary" disabled={!kp || !file || busy} onClick={() => void start()}>
        {busy ? "Workingâ€¦" : file ? `Upload ${file.name} (${fmtBytes(file.size)})` : "Choose a file"}
      </button>
      {frac !== undefined && busy && <progress value={frac} max={1} />}
      {log.length > 0 && (
        <ol className="log">
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
      )}
      {err && <p className="error">{err}</p>}
      {result && (
        <p className="ok">
          Stored. Root <code>{result.root}</code>
          {result.dealId !== undefined && <> (deal #{result.dealId})</>}
          {result.encrypted ? ", encrypted." : ", plaintext."}
        </p>
      )}
    </section>
  );
}
