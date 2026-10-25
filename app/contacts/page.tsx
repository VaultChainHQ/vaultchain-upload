import type { Metadata } from "next";
import { ContactsView } from "@/components/account/ContactsView";

export const metadata: Metadata = { title: "Contacts" };

export default function ContactsPage() {
  return (
    <>
      <p className="eyebrow">Contacts</p>
      <h1>Contacts</h1>
      <p className="lead">The people you share files with, saved on this device only.</p>
      <ContactsView />
    </>
  );
}
