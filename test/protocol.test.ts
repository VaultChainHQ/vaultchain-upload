import { describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes } from "../lib/vault/bytes";
import { buildManifest, chunkLeaves, contentRoot, parseProofHeader, proofHeader, prove, treeRoot, verifyContent, verifyProof } from "../lib/vault/chunk";
import { goString } from "../lib/vault/json";
import { addressFromPub, isValidAddress, keyFromHex } from "../lib/vault/keys";
import { encodeMsg, type VaultMsg } from "../lib/vault/msgs";
import { signReadToken } from "../lib/vault/readtoken";
import { signTx, verifyTxSignature } from "../lib/vault/tx";
import { keyByName, pattern, priv, vectors } from "./vectors";

describe("keys / addresses (Go vectors)", () => {
  for (const k of vectors.keys) {
    it(`derives the Go pubkey and address for ${k.name}`, () => {
      const kp = keyFromHex(k.priv_hex);
      expect(kp.pubHex).toBe(k.pub_hex);
      expect(kp.address).toBe(k.address);
      expect(addressFromPub(hexToBytes(k.pub_hex))).toBe(k.address);
      expect(isValidAddress(k.address)).toBe(true);
    });
  }
  it("rejects malformed addresses and keys", () => {
    expect(isValidAddress("cosmos1abc")).toBe(false);
    expect(isValidAddress("vault1qqqqqq")).toBe(false);
    expect(() => keyFromHex("00".repeat(32))).toThrow();
    expect(() => keyFromHex("zz")).toThrow();
  });
});

describe("chunking + Merkle root (Go vectors)", () => {
  for (const c of vectors.chunks) {
    it(`matches Go for size=${c.size} chunk=${c.chunk_size}`, () => {
      const data = pattern(c.size);
      const leaves = chunkLeaves(data, c.chunk_size);
      expect(leaves.map(bytesToHex)).toEqual(c.leaves);
      const tree = treeRoot(leaves);
      expect(bytesToHex(tree)).toBe(c.tree_root);
      expect(contentRoot(tree, c.size, c.chunk_size)).toBe(c.root);
      const { manifest } = buildManifest(data, { chunkSize: c.chunk_size, mime: "application/octet-stream", name: "x" });
      expect(manifest.root).toBe(c.root);
      verifyContent(data, manifest);
      // proofs: identical to Go's, and they verify
      leaves.forEach((_, i) => {
        const p = prove(leaves, i);
        expect(proofHeader(p)).toBe(c.proofs[i]);
        expect(parseProofHeader(proofHeader(p)).length).toBe(p.length);
        const chunk = data.subarray(i * c.chunk_size, Math.min((i + 1) * c.chunk_size, c.size));
        verifyProof(manifest, i, chunk, p);
      });
    });
  }
  it("detects tampering", () => {
    const data = pattern(100);
    const { manifest, leaves } = buildManifest(data, { chunkSize: 16, mime: "text/plain", name: "t" });
    const bad = data.slice();
    bad[5] ^= 1;
    expect(() => verifyContent(bad, manifest)).toThrow();
    expect(() => verifyProof(manifest, 0, bad.subarray(0, 16), prove(leaves, 0))).toThrow();
    expect(() => verifyProof(manifest, 1, data.subarray(0, 16), prove(leaves, 1))).toThrow();
  });
});

describe("signed tx envelope (Go vectors)", () => {
  for (const t of vectors.txs) {
    it(`${t.name}: canonical msgs, sign bytes, signature and raw tx match Go`, () => {
      const key = keyFromHex(keyByName(t.key).priv_hex);
      const msgs = t.msgs.map((m) => JSON.parse(m) as VaultMsg);
      // re-encoding the parsed message must give Go's exact bytes
      expect(msgs.map(encodeMsg)).toEqual(t.msgs);
      const s = signTx(priv(keyByName(t.key)), { chainId: t.chain_id, nonce: t.nonce, msgs, fee: t.fee, pubHex: key.pubHex });
      expect(bytesToHex(s.signBytes)).toBe(t.sign_bytes_hex);
      expect(s.sigHex).toBe(t.sig_hex); // RFC6979 deterministic => byte-identical to Go
      expect(s.raw).toBe(t.raw_tx);
      expect(verifyTxSignature(key.pubHex, s.signBytes, s.sigHex)).toBe(true);
    });
  }
});

describe("read tokens (Go vectors)", () => {
  for (const t of vectors.tokens) {
    it(`matches Go for ${t.key}`, () => {
      const key = keyFromHex(keyByName(t.key).priv_hex);
      expect(signReadToken(priv(keyByName(t.key)), key.pubHex, t.provider, t.root, t.exp)).toBe(t.token);
    });
  }
});

describe("Go JSON string escaping", () => {
  it("HTML-escapes like encoding/json", () => {
    expect(goString("a<b>&c\u2028\u2029")).toBe('"a\\u003cb\\u003e\\u0026c\\u2028\\u2029"');
    expect(goString('q"\\\n')).toBe('"q\\"\\\\\\n"');
  });
  it("rejects lone surrogates", () => {
    expect(() => goString("\ud800")).toThrow();
  });
});
