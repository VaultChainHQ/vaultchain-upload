// Opt-in end-to-end test against a real devnet. It SPENDS devnet funds and writes to the chain.
//   VAULT_LIVE_PRIVKEY=<64 hex of a funded devnet key> [VAULT_LIVE_GRANTEE=vault1...] npm run test:live
// Skipped unless VAULT_LIVE_PRIVKEY is set. Talks to the provider directly (no CORS in Node).
import { describe, expect, it } from "vitest";
import { NodeClient, ProviderClient } from "../lib/vault/client";
import { DEFAULT_PROVIDER, DEFAULT_REST } from "../lib/vault/config";
import { downloadObject, grantRead, revokeRead, signerFromKey, uploadObject } from "../lib/vault/flows";
import { keyFromHex } from "../lib/vault/keys";
import { pattern } from "./vectors";

const priv = process.env.VAULT_LIVE_PRIVKEY;
const grantee = process.env.VAULT_LIVE_GRANTEE;
const node = new NodeClient(process.env.NEXT_PUBLIC_VAULT_REST || DEFAULT_REST);
const provider = new ProviderClient(process.env.NEXT_PUBLIC_VAULT_PROVIDER || DEFAULT_PROVIDER, "direct");

describe.skipIf(!priv)("live devnet e2e", () => {
  const signer = signerFromKey(keyFromHex(priv ?? "11".repeat(32)));

  async function roundTrip(encrypt: boolean, size: number) {
    // Unique content per run so the manifest root is new.
    const data = pattern(size);
    new DataView(data.buffer).setUint32(0, Date.now() % 0xffffffff);
    const up = await uploadObject({
      node,
      provider,
      signer,
      data,
      name: `e2e-${encrypt ? "enc" : "plain"}-${size}.bin`,
      mime: "application/octet-stream",
      encrypt,
      durationBlocks: 200,
    });
    expect(up.dealId).toBeGreaterThan(0);
    const down = await downloadObject({ node, provider, signer, root: up.root });
    expect(down.decrypted).toBe(encrypt);
    expect(Buffer.from(down.data).equals(Buffer.from(data))).toBe(true);
    return up;
  }

  it("plaintext, multi-chunk (300000 bytes): commit, deal, upload, download, verify", async () => {
    await roundTrip(false, 300_000);
  }, 180_000);

  it("encrypted (70000 bytes): commit with key envelope, deal, upload, download, decrypt", async () => {
    const up = await roundTrip(true, 70_000);
    expect(up.encrypted).toBe(true);
  }, 180_000);

  it.skipIf(!grantee)("grants an encrypted file to another account and revokes it", async () => {
    const up = await roundTrip(true, 1_000);
    const rec = (await node.manifest(up.root))!;
    await grantRead(node, signer, rec, grantee!, 0);
    const grants = await node.grants(up.root);
    const g = grants.find((x) => x.grantee === grantee);
    expect(g?.key_envelope).toBeTruthy();
    await revokeRead(node, signer, rec, { grantId: g!.id });
    expect((await node.grants(up.root)).find((x) => x.grantee === grantee)).toBeUndefined();
  }, 240_000);
});
