import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VaultChain Upload (devnet)",
  description: "Browser-signing upload and download site for the VaultChain devnet. Keys never leave your browser.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
