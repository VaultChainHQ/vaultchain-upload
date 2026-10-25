"use client";

import { useRef, useState } from "react";
import { toast } from "@/lib/toast";

/** Copies text to the clipboard and confirms with a toast. Used for addresses, links and file IDs. */
export async function copyText(text: string, what = "Copied"): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    if (!ok) {
      toast("Your browser blocked copying. Select the text and press Ctrl+C.", "bad");
      return false;
    }
  }
  toast(what, "good", 2200);
  return true;
}

export function CopyBtn({ text, label = "Copy", what, className = "btn sm" }: { text: string; label?: string; what?: string; className?: string }) {
  const [done, setDone] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        if (await copyText(text, what ? `${what} copied` : "Copied")) {
          setDone(true);
          clearTimeout(t.current);
          t.current = setTimeout(() => setDone(false), 1600);
        }
      }}
    >
      {done ? "✓ Copied" : label}
    </button>
  );
}
