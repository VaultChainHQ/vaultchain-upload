"use client";

import { useId, useRef, useState } from "react";
import { GLOSSARY } from "@/lib/glossary";

/** A word with a dotted underline that explains itself on hover, focus or tap. */
export function Term({ k, children }: { k: string; children?: React.ReactNode }) {
  const t = GLOSSARY[k];
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);
  if (!t) return <>{children}</>;

  function show() {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const below = r.bottom + 120 < window.innerHeight;
    setPos({ x: Math.min(Math.max(r.left + r.width / 2, 150), window.innerWidth - 150), y: below ? r.bottom + 6 : r.top - 6, below });
  }
  return (
    <span
      ref={ref}
      className="term"
      tabIndex={0}
      aria-describedby={pos ? id : undefined}
      onMouseEnter={show}
      onMouseLeave={() => setPos(null)}
      onFocus={show}
      onBlur={() => setPos(null)}
      onKeyDown={(e) => e.key === "Escape" && setPos(null)}
      onClick={() => (pos ? setPos(null) : show())}
    >
      {children ?? t.label}
      {pos ? (
        <span id={id} role="tooltip" className="tip" style={{ left: pos.x, top: pos.y, transform: `translate(-50%, ${pos.below ? "0" : "-100%"})` }}>
          <strong>{t.label}</strong> {t.short}
        </span>
      ) : null}
    </span>
  );
}
