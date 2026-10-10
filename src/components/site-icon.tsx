"use client";

import { useEffect, useState } from "react";
import { Globe2 } from "lucide-react";

function candidates(url: string, icon?: string) {
  const sources: string[] = [];
  for (const value of [icon]) {
    if (!value) continue;
    try {
      const parsed = new URL(value);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") sources.push(parsed.href);
    } catch { /* Ignore invalid saved icon URLs. */ }
  }
  try {
    const site = new URL(url);
    if (site.protocol === "http:" || site.protocol === "https:") {
      sources.push(new URL("/favicon.ico", site).href);
      sources.push(new URL("/apple-touch-icon.png", site).href);
    }
  } catch { /* The generic globe is used for invalid URLs. */ }
  return [...new Set(sources)];
}

export default function SiteIcon({ url, icon, className = "site-icon" }: { url: string; icon?: string; className?: string }) {
  const [attempt, setAttempt] = useState(0);
  useEffect(() => setAttempt(0), [url, icon]);
  const sources = candidates(url, icon);
  return <span className={className} aria-hidden="true">
    {sources[attempt]
      // Favicons can be ICO or SVG, so use the browser's native image decoder.
      ? <img src={sources[attempt]} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setAttempt(value => value + 1)}/>
      : <Globe2 size={className.includes("large") ? 21 : 16} strokeWidth={1.8}/>}
  </span>;
}
