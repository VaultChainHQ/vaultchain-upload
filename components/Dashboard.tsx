"use client";
import { useState } from "react";
import { Account } from "./Account";
import { Files } from "./Files";
import { Upload } from "./Upload";
import { node, provider, usePoll } from "@/lib/hooks";
import { DENOM, NODE_URL, PROVIDER_MODE, PROVIDER_URL } from "@/lib/vault/config";
import { activeKeyPair, useWallet } from "@/lib/wallet";

export function Dashboard() {
  const wallet = useWallet();
  const kp = activeKeyPair(wallet);
  const [tick, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);

  const info = usePoll(() => node.info(), 5_000);
  const pstat = usePoll(() => provider.status(), 20_000);
  const bal = usePoll(() => (kp ? node.balance(kp.address, DENOM) : Promise.resolve(undefined)), 6_000, `${kp?.address}:${tick}`);

  return (
    <>
      <section className="card status">
        <div>
          <span className="muted">Chain</span> <b>{info.data?.chainId ?? "…"}</b> · height <b>{info.data?.height ?? "…"}</b>
          {info.error && <span className="error"> node unreachable: {info.error}</span>}
        </div>
        <div>
          <span className="muted">Provider</span> <b>{pstat.data ? `${pstat.data.status} (${pstat.data.version})` : "…"}</b>
          {pstat.error && <span className="error"> unreachable: {pstat.error}</span>}
        </div>
        <div className="muted small">
          node {NODE_URL} · provider {PROVIDER_URL} ({PROVIDER_MODE} mode)
        </div>
      </section>
      <Account wallet={wallet} kp={kp} balance={bal.data} balanceError={bal.error} />
      <Upload
        kp={kp}
        onDone={() => {
          bump();
          bal.reload();
        }}
      />
      <Files kp={kp} tick={tick} onChange={bump} />
    </>
  );
}
