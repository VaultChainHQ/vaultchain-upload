"use client";

import { useMemo } from "react";
import { QrTooLongError, qrMatrix, qrSvgPath } from "@/lib/qr";

/** A scannable QR code drawn as one SVG path (black on white with the required quiet zone, so it scans in both themes). */
export function Qr({ text, label, size = 168 }: { text: string; label: string; size?: number }) {
  const q = useMemo(() => {
    try {
      return qrSvgPath(qrMatrix(text));
    } catch (e) {
      if (e instanceof QrTooLongError) return null;
      throw e;
    }
  }, [text]);
  if (!q) return null;
  return (
    <svg className="qr" role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${q.size} ${q.size}`} shapeRendering="crispEdges">
      <rect width={q.size} height={q.size} fill="#fff" />
      <path d={q.d} fill="#000" />
    </svg>
  );
}
