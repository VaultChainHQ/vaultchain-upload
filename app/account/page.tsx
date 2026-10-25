import type { Metadata } from "next";
import { AccountView } from "@/components/account/AccountView";

export const metadata: Metadata = { title: "Account" };

export default function AccountPage() {
  return (
    <>
      <p className="eyebrow">Account</p>
      <h1>Your account</h1>
      <p className="lead">Your address, free test funds, and the settings for this device.</p>
      <AccountView />
    </>
  );
}
