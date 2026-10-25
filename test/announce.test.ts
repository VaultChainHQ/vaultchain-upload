import { describe, expect, it } from "vitest";
import { announceKey, signerFromKey } from "../lib/vault/flows";
import type { NodeClient } from "../lib/vault/client";
import { keyFromHex } from "../lib/vault/keys";
import { keyByName } from "./vectors";

describe("announceKey", () => {
  it("signs a 1 uvault self-transfer so the chain learns the public key", async () => {
    const signer = signerFromKey(keyFromHex(keyByName("bob").priv_hex));
    const sent: string[] = [];
    const node = {
      info: async () => ({ chainId: "vault-devnet-1", height: 1 }),
      account: async () => ({ nonce: 0, pending_nonce: 0 }),
      submit: async (raw: string) => (sent.push(raw), "h"),
      waitTx: async () => ({ hash: "h", height: 2, ok: true, result: "ok" }),
    } as unknown as NodeClient;
    await announceKey(node, signer);
    const tx = JSON.parse(sent[0]);
    expect(tx.pubkey).toBe(signer.key.pubHex);
    expect(tx.msgs).toEqual([{ type: "bank/Send", to: signer.key.address, amount: [{ denom: "uvault", amount: "1" }] }]);
    expect(BigInt(tx.fee[0].amount)).toBeGreaterThanOrEqual(1000n);
  });
});
