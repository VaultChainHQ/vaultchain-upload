"use client";
import { useState } from "react";
import { errMsg, fmtVault } from "@/lib/hooks";
import type { KeyPair } from "@/lib/vault/keys";
import { addKey, createKey, forgetKey, selectKey, type WalletState } from "@/lib/wallet";

export function Account({ wallet, kp, balance, balanceError }: { wallet: WalletState; kp: KeyPair | null; balance?: bigint; balanceError?: string }) {
  const [name, setName] = useState("");
  const [importHex, setImportHex] = useState("");
  const [err, setErr] = useState<string>();
  const [reveal, setReveal] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const [copied, setCopied] = useState(false);

  const run = (f: () => void) => {
    try {
      setErr(undefined);
      f();
    } catch (e) {
      setErr(errMsg(e));
    }
  };

  return (
    <section className="card">
      <h2>Account</h2>
      {wallet.keys.length > 1 && (
        <label className="row">
          <span>Active key</span>
          <select
            value={wallet.active}
            onChange={(e) => {
              setReveal(false);
              setConfirmForget(false);
              selectKey(Number(e.target.value));
            }}
          >
            {wallet.keys.map((k, i) => (
              <option key={k.privHex} value={i}>
                {k.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {kp ? (
        <>
          <p className="kv">
            <span>Address</span>
            <code className="addr">{kp.address}</code>
            <button
              className="link"
              onClick={() => {
                void navigator.clipboard.writeText(kp.address).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? "copied" : "copy"}
            </button>
          </p>
          <p className="kv">
            <span>Balance</span>
            <b>{balance === undefined ? (balanceError ? "unavailable" : "…") : `${fmtVault(balance)} VAULT`}</b>
            {balance !== undefined && <small className="muted">({balance.toString()} uvault)</small>}
          </p>
          {balance === 0n && (
            <p className="note">
              This account has no funds. Devnet has no public faucet yet: ask the devnet operator to send some VAULT to the address above, then it will show up here.
            </p>
          )}
          <div className="actions">
            <button onClick={() => setReveal((r) => !r)}>{reveal ? "Hide private key" : "Show private key"}</button>
            {!confirmForget ? (
              <button className="danger" onClick={() => setConfirmForget(true)}>
                Forget this key
              </button>
            ) : (
              <>
                <span className="muted">Removes it from this browser. Without a backup the funds are gone.</span>
                <button
                  className="danger"
                  onClick={() => {
                    setConfirmForget(false);
                    setReveal(false);
                    forgetKey(wallet.active);
                  }}
                >
                  Yes, forget it
                </button>
                <button onClick={() => setConfirmForget(false)}>Cancel</button>
              </>
            )}
          </div>
          {reveal && (
            <p className="secret">
              <b>Private key (hex), never share it:</b>
              <br />
              <code>{kp.privHex}</code>
            </p>
          )}
        </>
      ) : (
        <p>No key in this browser yet. Create one or import an existing devnet key.</p>
      )}

      <details open={!kp}>
        <summary>{kp ? "Add another key" : "Create or import a key"}</summary>
        <div className="grid2">
          <div>
            <label className="col">
              <span>Name (optional)</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my devnet key" />
            </label>
            <button className="primary" onClick={() => run(() => createKey(name))}>
              Generate new key in this browser
            </button>
          </div>
          <div>
            <label className="col">
              <span>Import private key (64 hex chars)</span>
              <input type="password" autoComplete="off" value={importHex} onChange={(e) => setImportHex(e.target.value.trim())} placeholder="hex secp256k1 private key" />
            </label>
            <button
              onClick={() =>
                run(() => {
                  addKey(name, importHex);
                  setImportHex("");
                })
              }
              disabled={!importHex}
            >
              Import
            </button>
          </div>
        </div>
      </details>
      {err && <p className="error">{err}</p>}
    </section>
  );
}
