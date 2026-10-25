import type { Metadata } from "next";
import { LibraryView } from "@/components/library/LibraryView";

export const metadata: Metadata = { title: "My files" };

export default function FilesPage() {
  return (
    <>
      <p className="eyebrow">My files</p>
      <h1>Your files</h1>
      <p className="lead">Everything you have stored, how long it is paid for, and who can open it.</p>
      <LibraryView />
    </>
  );
}
