import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { qrMatrix, qrSvgPath, QrTooLongError } from "../lib/qr";

function decode(m: boolean[][], scale = 4, quiet = 4): string | null {
  const n = m.length + quiet * 2;
  const w = n * scale;
  const px = new Uint8ClampedArray(w * w * 4).fill(255);
  m.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) {
          const i = (((y + quiet) * scale + dy) * w + (x + quiet) * scale + dx) * 4;
          px[i] = px[i + 1] = px[i + 2] = 0;
        }
    }),
  );
  return jsQR(px, w, w)?.data ?? null;
}

describe("qr encoder", () => {
  it("round-trips a typical share link", () => {
    const url = `https://vaultchain-upload.vercel.app/files?open=${"ab".repeat(32)}`;
    expect(decode(qrMatrix(url))).toBe(url);
  });
  it("round-trips across many sizes (all version ranges incl. alignment and version info)", () => {
    for (const len of [1, 10, 40, 80, 120, 200, 300, 500, 800, 1200]) {
      const text = Array.from({ length: len }, (_, i) => String.fromCharCode(33 + ((i * 7 + len) % 90))).join("");
      const m = qrMatrix(text);
      expect(decode(m), `length ${len} (version ${(m.length - 17) / 4})`).toBe(text);
    }
  });
  it("handles non-ASCII text as UTF-8", () => {
    expect(decode(qrMatrix("héllo → vault ✓"))).toBe("héllo → vault ✓");
  });
  it("has the right grid size and finder patterns", () => {
    const m = qrMatrix("hi");
    expect(m.length).toBe(21);
    expect(m[0].slice(0, 7).every(Boolean)).toBe(true);
    expect(m[3][3]).toBe(true);
  });
  it("refuses text that cannot fit", () => {
    expect(() => qrMatrix("x".repeat(3000))).toThrow(QrTooLongError);
  });
  it("draws one path covering the dark modules", () => {
    const { d, size } = qrSvgPath(qrMatrix("hi"));
    expect(size).toBe(29);
    expect(d.startsWith("M4 4h7")).toBe(true);
  });
});
