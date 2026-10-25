"use client";

import { useEffect, useMemo, useState } from "react";
import { previewKind, type PreviewKind } from "@/lib/library";

/** An object URL that is revoked when the blob changes or the component goes away. */
export function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- object URLs must be created and revoked in an effect
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

/**
 * Shows an image, video, audio clip, PDF or short text. Only these allow-listed types are ever rendered; the blob always carries an
 * explicit type, so a file can never be interpreted as a web page or run script on this site.
 */
export function Preview({ blob, name, kind, mime }: { blob: Blob; name: string; kind: Exclude<PreviewKind, null>; mime: string }) {
  const typed = useTyped(blob, mime);
  const url = useObjectUrl(typed);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (kind !== "text") return;
    let dead = false;
    void blob.slice(0, 64 * 1024).text().then((t) => !dead && setText(t));
    return () => {
      dead = true;
    };
  }, [blob, kind]);
  if (kind === "text") return <pre className="preview-text" tabIndex={0} aria-label={`Preview of ${name}`}>{text ?? "Loading…"}</pre>;
  if (!url) return null;
  if (kind === "image")
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img className="preview-img" src={url} alt={`Preview of ${name}`} />
    );
  if (kind === "video") return <video className="preview-video" src={url} controls preload="metadata" aria-label={`Preview of ${name}`} />;
  if (kind === "audio") return <audio className="preview-audio" src={url} controls preload="metadata" aria-label={`Preview of ${name}`} />;
  return <iframe className="preview-pdf" src={url} title={`Preview of ${name}`} />;
}

function useTyped(blob: Blob, mime: string): Blob {
  return useMemo(() => (blob.type === mime ? blob : new Blob([blob], { type: mime })), [blob, mime]);
}

export { previewKind };

/** A tiny thumbnail for the picker (images only; other types get an icon). */
export function Thumb({ file }: { file: File }) {
  const kind = previewKind(file.type, file.size);
  const url = useObjectUrl(kind === "image" ? file : null);
  if (kind === "image" && url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="thumb" src={url} alt="" />;
  }
  const icon = kind === "video" ? "🎞" : kind === "audio" ? "♪" : kind === "pdf" ? "📄" : file.type.startsWith("text/") ? "≡" : "▤";
  return (
    <span className="thumb icon" aria-hidden="true">
      {icon}
    </span>
  );
}
