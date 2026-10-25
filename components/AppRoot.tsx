"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { batchFraction } from "@/lib/flow";
import { session, setAutoLockSource } from "@/lib/session";
import { useAccount } from "@/lib/hooks";
import { vaultStore } from "@/lib/vaultstore";
import { useFlow } from "./flow/useFlow";
import { ProfileBar } from "./ProfileBar";
import { Toasts } from "./Toasts";

/** Wires auto-lock for the whole app and renders the profile strip and toasts around every page. */
export function AppRoot({ children }: { children: React.ReactNode }) {
  const { vault, profile, unlocked } = useAccount();
  const minutes = vault.settings.autoLockMinutes;
  const flow = useFlow();
  const path = usePathname();

  // Closing the tab mid-upload would stop it; ask first.
  useEffect(() => {
    if (!flow.running) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [flow.running]);

  useEffect(() => {
    setAutoLockSource(() => vaultStore().snapshot().settings.autoLockMinutes);
    const s = session();
    let last = 0;
    const activity = () => {
      const t = Date.now();
      if (t - last > 1000) {
        last = t;
        s.touch();
      }
    };
    const vis = () => {
      if (document.visibilityState === "visible") s.check();
    };
    const hide = () => s.lock();
    const evs = ["pointerdown", "keydown", "touchstart", "wheel"] as const;
    evs.forEach((e) => window.addEventListener(e, activity, { passive: true }));
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("pagehide", hide);
    return () => {
      evs.forEach((e) => window.removeEventListener(e, activity));
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("pagehide", hide);
      s.lock();
    };
  }, []);

  useEffect(() => {
    session().touch();
  }, [minutes]);

  // A key unlocked for a profile that is no longer the active one must not linger.
  useEffect(() => {
    if (unlocked === null) {
      const u = session().snapshot();
      if (u && (!profile || u.profileId !== profile.entry.id)) session().lock();
    }
  }, [unlocked, profile]);

  return (
    <>
      <ProfileBar />
      {flow.running && path !== "/" ? (
        <div className="wrap">
          <p className="callout" role="status">
            Uploading… {Math.round(batchFraction(flow.items) * 100)}% done. Keep this tab open. <Link href="/">Watch progress</Link>
          </p>
        </div>
      ) : null}
      <main id="main" className="wrap page">
        {children}
      </main>
      <Toasts />
    </>
  );
}
