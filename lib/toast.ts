// Tiny toast queue: a store that components push to and <Toasts/> renders. Messages are announced politely to screen readers.
export type ToastKind = "info" | "good" | "bad";
export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

let items: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

const emit = () => listeners.forEach((l) => l());

export const toastSnapshot = (): Toast[] => items;
export const toastSubscribe = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export function dismissToast(id: number): void {
  clearTimeout(timers.get(id));
  timers.delete(id);
  items = items.filter((t) => t.id !== id);
  emit();
}

export function toast(text: string, kind: ToastKind = "info", ms = kind === "bad" ? 9000 : 4500): number {
  const id = nextId++;
  items = [...items.slice(-3), { id, kind, text }];
  emit();
  if (typeof window !== "undefined") timers.set(id, setTimeout(() => dismissToast(id), ms));
  return id;
}
