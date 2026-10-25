import type { Metadata, Viewport } from "next";
import { AppRoot } from "@/components/AppRoot";
import { OfflineBanner } from "@/components/OfflineBanner";
import { SiteFooter, SiteHeader } from "@/components/site";
import { THEME_SCRIPT } from "@/components/ThemeToggle";
import "./brand.css";
import "./upload.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://vaultchain-upload.vercel.app"),
  title: { default: "VaultChain Upload: store a file in a few steps", template: "%s · VaultChain Upload" },
  description: "Store files on the VaultChain devnet from your browser, in a guided seven-step flow. Private by default; your key never leaves this device.",
  openGraph: {
    title: "VaultChain Upload",
    description: "Store, share and check files on the VaultChain devnet. Private by default; your key never leaves your browser.",
    type: "website",
    siteName: "VaultChain",
  },
  twitter: { card: "summary_large_image", title: "VaultChain Upload", description: "Store, share and check files on the VaultChain devnet." },
};

export const viewport: Viewport = { themeColor: "#07090d", colorScheme: "dark light" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <OfflineBanner />
        <SiteHeader />
        <AppRoot>{children}</AppRoot>
        <SiteFooter />
      </body>
    </html>
  );
}
