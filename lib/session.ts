// In-memory unlock session. The decrypted private key lives only here (a Uint8Array we can wipe),
// never in storage, and is dropped on manual lock, on auto-lock, and when the page is hidden for
// longer than the auto-lock time or navigates away.
import { keyFromPriv, type KeyPair } from "./vault/keys";

export interface Unlocked {
  profileId: string;
  key: KeyPair;
  priv: Uint8Array;
}

export class Session {
  private current: Unlocked | null = null;
  private deadline = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(
    private minutes: () => number,
    private now: () => number = () => Date.now(),
  ) {}

  snapshot = (): Unlocked | null => this.current;
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  unlock(profileId: string, priv: Uint8Array): Unlocked {
    this.lock(false);
    const key = keyFromPriv(priv);
    this.current = { profileId, key, priv };
    this.touch();
    this.emit();
    return this.current;
  }

  lock(notify = true): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.current) {
      this.current.priv.fill(0);
      this.current = null;
      if (notify) this.emit();
    }
  }

  /** Reset the inactivity timer; call on user activity. */
  touch(): void {
    if (!this.current) return;
    this.deadline = this.now() + this.minutes() * 60_000;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.check(), this.minutes() * 60_000 + 50);
  }

  /** Lock if the deadline has passed (also called when the tab becomes visible again). */
  check(): boolean {
    if (this.current && this.now() >= this.deadline) {
      this.lock();
      return true;
    }
    return false;
  }

  remainingMs(): number {
    return this.current ? Math.max(0, this.deadline - this.now()) : 0;
  }
}

let shared: Session | undefined;
let minutesSource: () => number = () => 10;
export function setAutoLockSource(fn: () => number) {
  minutesSource = fn;
}
export function session(): Session {
  return (shared ??= new Session(() => minutesSource()));
}
