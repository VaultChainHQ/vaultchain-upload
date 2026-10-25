import type { ProviderMode } from "./config";
import type { Coin } from "./msgs";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

async function errorText(res: Response): Promise<string> {
  const t = (await res.text().catch(() => "")).trim();
  try {
    const j = JSON.parse(t) as { error?: string };
    if (j.error) return j.error;
  } catch {
    /* not json */
  }
  return t || res.statusText || `HTTP ${res.status}`;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) throw new HttpError(res.status, await errorText(res));
  return (await res.json()) as T;
}

export interface ManifestRecord {
  root: string;
  size: number;
  chunk_size: number;
  mime: string;
  name: string;
  owner: string;
  height: number;
  encryption?: string;
  key_envelope?: string;
}

export interface Replica {
  slot: number;
  provider: string;
  status: string;
  assigned_height?: number;
  accepted_height?: number;
  last_proven_height?: number;
  missed_proofs?: number;
}

export interface Deal {
  id: number;
  class: string;
  owner: string;
  cid: string;
  size: number;
  start_height: number;
  expire_height: number;
  payment: Coin;
  replication: number;
  min_replicas: number;
  replicas: Replica[];
  status: string;
}

export interface Provider {
  address: string;
  endpoint: string;
  capacity: number;
  free_bytes: number;
  status: string;
}

export interface Grant {
  id: number;
  cid: string;
  owner: string;
  grantee: string;
  capability: string;
  expiry_height: number;
  key_envelope?: string;
}

export interface TxRecord {
  hash: string;
  height: number;
  ok: boolean;
  result: string;
}

export interface NodeInfo {
  chainId: string;
  height: number;
}

export class NodeClient {
  constructor(
    public base: string,
    private f: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async get<T>(path: string): Promise<T> {
    return jsonOrThrow<T>(await this.f(this.base + path, { cache: "no-store" }));
  }

  private async getOrNull<T>(path: string): Promise<T | null> {
    const res = await this.f(this.base + path, { cache: "no-store" });
    if (res.status === 404) return null;
    return jsonOrThrow<T>(res);
  }

  async info(): Promise<NodeInfo> {
    const r = await this.get<{ height: number; default_node_info: { network: string } }>(
      "/cosmos/base/tendermint/v1beta1/node_info",
    );
    return { chainId: r.default_node_info.network, height: r.height };
  }

  async balances(addr: string): Promise<Coin[]> {
    return (await this.get<{ balances: Coin[] | null }>(`/cosmos/bank/v1beta1/balances/${addr}`)).balances ?? [];
  }

  async balance(addr: string, denom: string): Promise<bigint> {
    const c = (await this.balances(addr)).find((x) => x.denom === denom);
    return BigInt(c?.amount ?? "0");
  }

  async account(addr: string): Promise<{ nonce: number; pending_nonce: number }> {
    return this.get(`/vaultchain/auth/accounts/${addr}`);
  }

  /** Compressed pubkey hex of an account that has signed a tx before, else null. */
  async pubkey(addr: string): Promise<string | null> {
    const r = await this.getOrNull<{ pubkey: string }>(`/vaultchain/auth/pubkeys/${addr}`);
    return r?.pubkey ?? null;
  }

  async manifest(root: string): Promise<ManifestRecord | null> {
    return (await this.getOrNull<{ manifest: ManifestRecord }>(`/vaultchain/storage/manifests/${root}`))?.manifest ?? null;
  }

  async manifests(owner?: string): Promise<ManifestRecord[]> {
    const q = owner ? `?owner=${encodeURIComponent(owner)}` : "";
    return (await this.get<{ manifests: ManifestRecord[] | null }>(`/vaultchain/storage/manifests${q}`)).manifests ?? [];
  }

  async deals(filter: { cid?: string; provider?: string; owner?: string } = {}): Promise<Deal[]> {
    const q = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]).toString();
    return (await this.get<{ deals: Deal[] | null }>(`/vaultchain/storage/deals${q ? "?" + q : ""}`)).deals ?? [];
  }

  async providers(): Promise<Provider[]> {
    return (await this.get<{ providers: Provider[] | null }>("/vaultchain/storage/providers")).providers ?? [];
  }

  async grants(cid?: string): Promise<Grant[]> {
    const q = cid ? `?cid=${cid}` : "";
    return (await this.get<{ grants: Grant[] | null }>(`/vaultchain/access/grants${q}`)).grants ?? [];
  }

  async submit(raw: string): Promise<string> {
    const res = await this.f(this.base + "/vaultchain/txs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: raw,
    });
    return (await jsonOrThrow<{ hash: string }>(res)).hash;
  }

  async tx(hash: string): Promise<TxRecord | null> {
    return (await this.getOrNull<{ tx: TxRecord }>(`/vaultchain/txs/${hash}`))?.tx ?? null;
  }

  async waitTx(hash: string, timeoutMs = 60_000, intervalMs = 1_000): Promise<TxRecord> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const rec = await this.tx(hash);
      if (rec) return rec;
      if (Date.now() > deadline) throw new Error("timed out waiting for the transaction to be included in a block");
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}

export interface ProviderStatus {
  status: string;
  version: string;
  address: string;
  chain_id: string;
  objects: number;
}

export interface ChunkPutResult {
  chunks_have: number;
  chunks_total: number;
  complete: boolean;
}

export class ProviderClient {
  constructor(
    public base: string,
    public mode: ProviderMode,
    private f: typeof fetch = (...a) => fetch(...a),
  ) {}

  private url(path: string): string {
    return this.mode === "proxy" ? `/api/provider/${path}` : `${this.base}/${path}`;
  }

  async status(): Promise<ProviderStatus> {
    return jsonOrThrow(await this.f(this.url("status"), { cache: "no-store" }));
  }

  async objectStatus(root: string): Promise<{ chunks_have: number; chunks_total: number; complete: boolean } | null> {
    const res = await this.f(this.url(`v1/objects/${root}/status`), { cache: "no-store" });
    if (res.status === 404) return null;
    return jsonOrThrow(res);
  }

  async putChunk(root: string, index: number, data: Uint8Array, proofHeader: string): Promise<ChunkPutResult> {
    const res = await this.f(this.url(`v1/chunks/${root}/${index}`), {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream", "X-Vault-Proof": proofHeader },
      body: data as BodyInit,
    });
    return jsonOrThrow(res);
  }

  async getChunk(root: string, index: number, token: string): Promise<Uint8Array> {
    const res = await this.f(this.url(`v1/chunks/${root}/${index}`), {
      headers: { Authorization: `Vault ${token}` },
      cache: "no-store",
    });
    if (!res.ok) throw new HttpError(res.status, await errorText(res));
    return new Uint8Array(await res.arrayBuffer());
  }
}
