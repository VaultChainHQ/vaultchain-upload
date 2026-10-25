import { ImageResponse } from "next/og";

export const alt = "VaultChain Upload";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OG() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: "#07090d", color: "#e6ebf3" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20, color: "#38e1c6", fontSize: 44, fontWeight: 700 }}>
          <svg width="72" height="72" viewBox="0 0 32 32">
            <rect x="3" y="3" width="26" height="26" rx="7" fill="none" stroke="#38e1c6" strokeWidth="2" />
            <circle cx="16" cy="16" r="6" fill="none" stroke="#38e1c6" strokeWidth="2" />
            <path d="M16 10v-4M16 26v-4M10 16H6M26 16h-4" stroke="#38e1c6" strokeWidth="2" strokeLinecap="round" />
          </svg>
          VaultChain Upload
        </div>
        <div style={{ fontSize: 66, fontWeight: 700, marginTop: 36, lineHeight: 1.1 }}>Store a file in a few simple steps</div>
        <div style={{ fontSize: 30, color: "#93a0b5", marginTop: 28 }}>Private by default · devnet · your key stays in your browser</div>
      </div>
    ),
    size,
  );
}
