"use client";

import { useSyncExternalStore } from "react";

const sub = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

export function OfflineBanner() {
  const online = useSyncExternalStore(sub, () => navigator.onLine, () => true);
  if (online) return null;
  return (
    <div className="offline" role="alert">
      You are offline. What you see may be out of date; it will refresh when your connection returns.
    </div>
  );
}
