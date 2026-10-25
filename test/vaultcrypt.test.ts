import { describe, expect, it } from "vitest";
import { bytesToHex, concatBytes, hexToBytes, randomBytes } from "../lib/vault/bytes";
import { ciphertextSize, decrypt, encrypt, ENVELOPE_SIZE, generateFileKey, openKey, sealKey } from "../lib/vault/vaultcrypt";
import { keyFromHex } from "../lib/vault/keys";
import { pattern, vectors } from "./vectors";

describe("vaultcrypt stream (Go vectors)", () => {
  for (const c of vectors.crypt) {
    it(`decrypts Go ciphertext: plain=${c.plain_size} segment=${c.segment_size}`, () => {
      const plain = decrypt(hexToBytes(c.cipher_hex), hexToBytes(c.key_hex));
      expect(bytesToHex(plain)).toBe(bytesToHex(pattern(c.plain_size)));
    });
  }
});

describe("vaultcrypt stream (TS round trip)", () => {
  const key = generateFileKey();
  for (const [n, seg] of [[0, 16], [1, 16], [16, 16], [17, 16], [32, 16], [1000, 64], [200000, 65536]] as const) {
    it(`round trips plain=${n} segment=${seg} with Go's size formula`, () => {
      const plain = pattern(n);
      const ct = encrypt(plain, key, seg);
      expect(ct.length).toBe(ciphertextSize(n, seg));
      expect(bytesToHex(decrypt(ct, key))).toBe(bytesToHex(plain));
    });
  }
  it("rejects wrong key, truncation, reordering and tampering", () => {
    const plain = randomBytes(100);
    const ct = encrypt(plain, key, 16);
    expect(() => decrypt(ct, generateFileKey())).toThrow();
    expect(() => decrypt(ct.subarray(0, ct.length - 32), key)).toThrow(); // drops the final segment
    const t = ct.slice();
    t[40] ^= 1;
    expect(() => decrypt(t, key)).toThrow();
    const seg = 16 + 16;
    const swapped = concatBytes(ct.subarray(0, 24), ct.subarray(24 + seg, 24 + 2 * seg), ct.subarray(24, 24 + seg), ct.subarray(24 + 2 * seg));
    expect(() => decrypt(swapped, key)).toThrow();
  });
});

describe("key envelope (Go vectors)", () => {
  for (const v of vectors.envelopes) {
    it(`opens the Go envelope for ${v.recipient.slice(0, 12)}â€¦`, () => {
      const holder = vectors.keys.find((k) => k.address === v.recipient);
      expect(holder).toBeDefined();
      const key = openKey(hexToBytes(v.envelope_hex), hexToBytes(holder!.priv_hex), v.root, v.recipient);
      expect(bytesToHex(key)).toBe(v.key_hex);
    });
  }
  it("round trips, and is bound to root and recipient", () => {
    const alice = keyFromHex(vectors.keys[0].priv_hex);
    const bob = keyFromHex(vectors.keys[1].priv_hex);
    const fk = generateFileKey();
    const env = sealKey(fk, hexToBytes(bob.pubHex), "ab".repeat(32), bob.address);
    expect(env.length).toBe(ENVELOPE_SIZE);
    expect(bytesToHex(openKey(env, hexToBytes(bob.privHex), "ab".repeat(32), bob.address))).toBe(bytesToHex(fk));
    expect(() => openKey(env, hexToBytes(alice.privHex), "ab".repeat(32), bob.address)).toThrow();
    expect(() => openKey(env, hexToBytes(bob.privHex), "cd".repeat(32), bob.address)).toThrow();
  });
});
