"use client";

import { useSyncExternalStore } from "react";

type Theme = "dark" | "light";
const KEY = "vaultchain:theme";
const listeners = new Set<() => void>();
const get = (): Theme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

/** Inline script (run before first paint) so there is no flash of the wrong theme. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export function ThemeToggle() {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    get,
    () => "dark" as Theme,
  );
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem(KEY, next);
        } catch {
          /* private mode: the choice just will not persist */
        }
        listeners.forEach((l) => l());
      }}
    >
      <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
    </button>
  );
}
