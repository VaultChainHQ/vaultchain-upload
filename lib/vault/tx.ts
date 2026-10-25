import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "./bytes";
import { goString, goUint } from "./json";
import { coinsJSON, encodeMsg, type Coin, type VaultMsg } from "./msgs";

export const SIGN_DOMAIN = "vaultchain/tx/v1\n";
export const DEFAULT_FEE: Coin[] = [{ denom: "uvault", amount: "1000" }];

export interface UnsignedTx {
  chainId: string;
  nonce: number;
  msgs: string[]; // canonical JSON of each message
  fee: Coin[];
  pubHex: string;
}

function body(tx: UnsignedTx): string {
  return (
    `{"chain_id":${goString(tx.chainId)},"nonce":${goUint(tx.nonce, "nonce")}` +
    `,"msgs":[${tx.msgs.join(",")}],"fee":${coinsJSON(tx.fee)},"pubkey":${goString(tx.pubHex)}`
  );
}

/** The exact bytes that get signed: domain separator + the tx JSON without its signature. */
export function signBytes(tx: UnsignedTx): Uint8Array {
  return utf8ToBytes(SIGN_DOMAIN + body(tx) + "}");
}

export interface SignedTx {
  raw: string;
  signBytes: Uint8Array;
  sigHex: string;
}

export function signTx(
  priv: Uint8Array,
  tx: { chainId: string; nonce: number; msgs: VaultMsg[] | string[]; fee?: Coin[]; pubHex: string },
): SignedTx {
  const msgs = (tx.msgs as (VaultMsg | string)[]).map((m) => (typeof m === "string" ? m : encodeMsg(m)));
  const unsigned: UnsignedTx = {
    chainId: tx.chainId,
    nonce: tx.nonce,
    msgs,
    fee: tx.fee ?? DEFAULT_FEE,
    pubHex: tx.pubHex,
  };
  const sb = signBytes(unsigned);
  // 64-byte compact r||s, low-S, over sha256(signBytes).
  const sig = secp256k1.sign(sha256(sb), priv, { prehash: false, lowS: true });
  const sigHex = bytesToHex(sig);
  return { raw: `${body(unsigned)},"sig":${goString(sigHex)}}`, signBytes: sb, sigHex };
}

export function verifyTxSignature(pubHex: string, sb: Uint8Array, sigHex: string): boolean {
  return secp256k1.verify(hexToBytes(sigHex), sha256(sb), hexToBytes(pubHex), { prehash: false });
}
