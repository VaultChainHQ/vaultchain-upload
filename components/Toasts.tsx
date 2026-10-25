"use client";

import { useSyncExternalStore } from "react";
import { dismissToast, toastSnapshot, toastSubscribe } from "@/lib/toast";

export function Toasts() {
  const items = useSyncExternalStore(toastSubscribe, toastSnapshot, () => []);
  return (
    <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role={t.kind === "bad" ? "alert" : "status"}>
          <span>{t.text}</span>
          <button type="button" className="toast-x" aria-label="Dismiss notification" onClick={() => dismissToast(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
