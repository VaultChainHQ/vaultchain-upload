// Turns the raw errors from the node, the provider and the browser into sentences a person can act on.
// The original text is kept as `detail` so nothing is hidden, just not shown first.
export interface FriendlyError {
  title: string;
  hint?: string;
  detail: string;
  /** Whether trying again can help without changing anything. */
  retryable: boolean;
  kind: "funds" | "network" | "auth" | "chain" | "provider" | "file" | "unknown";
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function friendlyError(e: unknown): FriendlyError {
  const detail = errMsg(e);
  const m = detail.toLowerCase();
  if (/insufficient|not enough|balance/.test(m)) {
    return { kind: "funds", title: "Not enough VAULT for this upload.", hint: "Get devnet funds in step 2, then retry. Nothing was lost; any step that already finished is kept.", detail, retryable: false };
  }
  if (/failed to fetch|networkerror|network request failed|load failed|timed out|timeout|econnre|aborted/.test(m)) {
    return { kind: "network", title: "Could not reach the network.", hint: "Check your connection and press Retry. Finished steps are not repeated.", detail, retryable: true };
  }
  if (/nonce|sequence/.test(m)) {
    return { kind: "chain", title: "The chain rejected the transaction order.", hint: "Another transaction from this account was in flight. Wait a few seconds and retry.", detail, retryable: true };
  }
  if (/already committed by another account/.test(m)) {
    return { kind: "chain", title: "Someone else has already stored this exact content.", hint: "Files are identified by their content, so identical bytes can only have one owner. Change the file, even by a byte, to store your own copy.", detail, retryable: false };
  }
  if (/provider is on .* but the node is on/.test(m)) {
    return { kind: "provider", title: "The storage provider and the chain are on different networks.", hint: "This usually means the devnet was just reset. Try again in a minute.", detail, retryable: true };
  }
  if (/incomplete|provider/.test(m) && !/not authori/.test(m)) {
    return { kind: "provider", title: "The storage provider did not accept the whole file.", hint: "Press Retry: chunks that already arrived are not sent again.", detail, retryable: true };
  }
  if (/not authori|forbidden|403|401|no grant|no key envelope/.test(m)) {
    return { kind: "auth", title: "This account is not allowed to read that file.", hint: "Ask the owner to share it with your address (Account page → copy address).", detail, retryable: false };
  }
  if (/empty files|64 mib|too large/.test(m)) {
    return { kind: "file", title: "This file cannot be stored.", detail, retryable: false };
  }
  if (/transaction failed/.test(m)) {
    return { kind: "chain", title: "The chain refused the transaction.", hint: detail.replace(/^transaction failed:\s*/i, ""), detail, retryable: false };
  }
  return { kind: "unknown", title: "Something went wrong.", hint: "You can retry. If it keeps happening, open the details and share them in an issue.", detail, retryable: true };
}
