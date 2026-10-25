import { goString, goUint } from "./json";

export interface Coin {
  denom: string;
  amount: string;
}

export type VaultMsg =
  | { type: "bank/Send"; to: string; amount: Coin[] }
  | {
      type: "storage/CommitManifest";
      root: string;
      size: number;
      chunk_size: number;
      mime: string;
      name: string;
      encryption?: string;
      key_envelope?: string;
    }
  | {
      type: "storage/OpenDeal";
      class: string;
      cid: string;
      size: number;
      provider: string;
      duration_blocks: number;
      denom: string;
      replication: number;
      min_replicas?: number;
    }
  | {
      type: "access/GrantAccess";
      cid: string;
      grantee: string;
      capability: string;
      expiry_height: number;
      key_envelope?: string;
    }
  | { type: "access/RevokeAccess"; cid: string; grantee?: string; grant_id?: number };

export function coinJSON(c: Coin): string {
  return `{"denom":${goString(c.denom)},"amount":${goString(c.amount)}}`;
}

export function coinsJSON(cs: Coin[]): string {
  return `[${cs.map(coinJSON).join(",")}]`;
}

/** Canonical JSON for a message: same field order and omitempty rules as the Go structs. */
export function encodeMsg(m: VaultMsg): string {
  const t = goString(m.type);
  switch (m.type) {
    case "bank/Send":
      return `{"type":${t},"to":${goString(m.to)},"amount":${coinsJSON(m.amount)}}`;
    case "storage/CommitManifest": {
      let s =
        `{"type":${t},"root":${goString(m.root)},"size":${goUint(m.size, "size")}` +
        `,"chunk_size":${goUint(m.chunk_size, "chunk_size")},"mime":${goString(m.mime)},"name":${goString(m.name)}`;
      if (m.encryption) s += `,"encryption":${goString(m.encryption)}`;
      if (m.key_envelope) s += `,"key_envelope":${goString(m.key_envelope)}`;
      return s + "}";
    }
    case "storage/OpenDeal": {
      let s =
        `{"type":${t},"class":${goString(m.class)},"cid":${goString(m.cid)},"size":${goUint(m.size, "size")}` +
        `,"provider":${goString(m.provider)},"duration_blocks":${goUint(m.duration_blocks, "duration_blocks")}` +
        `,"denom":${goString(m.denom)},"replication":${goUint(m.replication, "replication")}`;
      s += `,"min_replicas":${goUint(m.min_replicas ?? 0, "min_replicas")}`; // not omitempty in Go
      return s + "}";
    }
    case "access/GrantAccess": {
      let s =
        `{"type":${t},"cid":${goString(m.cid)},"grantee":${goString(m.grantee)}` +
        `,"capability":${goString(m.capability)},"expiry_height":${goUint(m.expiry_height, "expiry_height")}`;
      if (m.key_envelope) s += `,"key_envelope":${goString(m.key_envelope)}`;
      return s + "}";
    }
    case "access/RevokeAccess": {
      let s = `{"type":${t},"cid":${goString(m.cid)}`;
      if (m.grantee) s += `,"grantee":${goString(m.grantee)}`;
      if (m.grant_id) s += `,"grant_id":${goUint(m.grant_id, "grant_id")}`;
      return s + "}";
    }
  }
}
