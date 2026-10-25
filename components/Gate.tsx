"use client";

import type { ReactNode } from "react";
import type { Unlocked } from "@/lib/session";
import type { ProfileRecord } from "@/lib/vaultstore";
import { useAccount } from "@/lib/hooks";
import { Onboarding } from "./onboarding";
import { Skeleton } from "./ui";
import { UnlockPanel } from "./unlock";

/** Shows create-a-profile, unlock, or (when ready) the page content. Pass `needKey` false for content that works while locked. */
export function Gate({ children, needKey = true }: { children: (a: { profile: ProfileRecord; unlocked: Unlocked | null }) => ReactNode; needKey?: boolean }) {
  const { vault, profile, unlocked, mounted } = useAccount();
  if (!mounted) return <Skeleton lines={4} />;
  if (vault.profiles.length === 0 || !profile) return <Onboarding first />;
  if (needKey && !unlocked) return <UnlockPanel key={profile.entry.id} profile={profile} />;
  return <>{children({ profile, unlocked })}</>;
}
