"use client";

import { useAccount } from "@/lib/hooks";
import { Gate } from "../Gate";
import { Account } from "./Account";

export function AccountView() {
  const { vault } = useAccount();
  return <Gate needKey={false}>{({ profile, unlocked }) => <Account vault={vault} profile={profile} unlocked={unlocked} />}</Gate>;
}
