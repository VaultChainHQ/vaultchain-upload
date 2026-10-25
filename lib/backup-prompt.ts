import type { KeystoreEntry } from "./keystore";

// After a profile is created we nag (once) to download an encrypted backup. A tiny store so any page can raise it and the profile bar can show it.
let current: KeystoreEntry | null = null;
const listeners = new Set<() => void>();
export const backupPromptSnapshot = (): KeystoreEntry | null => current;
export const backupPromptSubscribe = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
export function setBackupPrompt(e: KeystoreEntry | null): void {
  current = e;
  listeners.forEach((l) => l());
}
