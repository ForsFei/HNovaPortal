import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type FoundIcon = { bytes: Uint8Array; contentType: string };

const iconCache = new Map<string, { expires: number; value: Promise<FoundIcon | null> }>();
const maxHtmlBytes = 256 * 1024;
const maxIconBytes = 512 * 1024;
const userAgent = "Mozilla/5.0 (compatible; HNovaPortal/1.0; favicon discovery)";

function privateAddress(address: string): boolean {
  if (address.startsWith("::ffff:")) return privateAddress(address.slice(7));
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
  }
  const value = address.toLowerCase();
  return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") || /^fe[89ab]/.test(value);
}

async function allowedTarget(target: URL, original: URL): Promise<boolean> {
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) return false;
  if (target.hostname === "localhost" || target.hostname.endsWith(".localhost")) return target.hostname === original.hostname && target.port === original.port;
  try {
    const addresses = isIP(target.hostname) ? [{ address: target.hostname }] : await lookup(target.hostname, { all: true });
    if (!addresses.length) return false;
    return addresses.every(({ address }) => !privateAddress(address) || (target.hostname === original.hostname && target.port === original.port));
  } catch { return false; }
}

async function fetchLimited(url: URL, original: URL, limit: number, accept: string, timeout: number): Promise<{ bytes: Uint8Array; contentType: string; finalUrl: URL } | null> {
  let current = url;
  for (let redirect = 0; redirect < 4; redirect++) {
    if (!await allowedTarget(current, original)) return null;
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual", signal: AbortSignal.timeout(timeout),
        headers: { Accept: accept, "User-Agent": userAgent }, cache: "no-store"
      });
    } catch { return null; }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) return null;
      try { current = new URL(location, current); } catch { return null; }
      continue;
    }
    if (!response.ok || !response.body || Number(response.headers.get("content-length") || 0) > limit) {
      await response.body?.cancel(); return null;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) { await reader.cancel(); return null; }
        chunks.push(value);
      }
    } catch { return null; }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { bytes, contentType: response.headers.get("content-type")?.split(";")[0]?.toLowerCase() || "", finalUrl: current };
  }
  return null;
}

function attribute(tag: string, name: string): string {
  const match = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  const character = (code: number) => code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  return (match?.[1] || match?.[2] || match?.[3] || "")
    .replace(/&amp;/gi, "&").replace(/&#(\d+);/g, (_, code: string) => character(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => character(parseInt(code, 16)));
}

export function declaredIconUrls(html: string, page: URL): URL[] {
  const baseTag = html.match(/<base\b[^>]*>/i)?.[0];
  let base = page;
  try { if (baseTag) base = new URL(attribute(baseTag, "href"), page); } catch { /* Use the page URL. */ }
  const result: { url: URL; priority: number }[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const rel = attribute(tag, "rel").toLowerCase().split(/\s+/);
    if (!rel.includes("icon") && !rel.some(value => value.startsWith("apple-touch-icon"))) continue;
    const href = attribute(tag, "href");
    if (!href) continue;
    try {
      const url = new URL(href, base);
      if (!["http:", "https:"].includes(url.protocol)) continue;
      const type = attribute(tag, "type");
      result.push({ url, priority: type === "image/svg+xml" ? 1 : rel.includes("icon") ? 0 : 2 });
    } catch { /* Ignore invalid icon URLs. */ }
  }
  return [...new Map(result.sort((a, b) => a.priority - b.priority).map(value => [value.url.href, value.url])).values()].slice(0, 8);
}

function iconType(bytes: Uint8Array, claimed: string): string | null {
  if (bytes.length < 8) return null;
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) return "image/x-icon";
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216) return "image/jpeg";
  if (String.fromCharCode(...bytes.slice(0, 3)) === "GIF") return "image/gif";
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  if (claimed === "image/svg+xml" && /^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(new TextDecoder().decode(bytes.slice(0, 512)))) return "image/svg+xml";
  return null;
}

async function discover(url: URL): Promise<FoundIcon | null> {
  const original = new URL(url.origin);
  const deadline = Date.now() + 9000;
  const knownIcons: Record<string, string> = {
    "mail.google.com": "https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico"
  };
  if (knownIcons[url.hostname]) {
    const image = await fetchLimited(new URL(knownIcons[url.hostname]), original, maxIconBytes, "image/*", 4500);
    if (image) {
      const contentType = iconType(image.bytes, image.contentType);
      if (contentType) return { bytes: image.bytes, contentType };
    }
  }
  const pageUrls = [original];
  if (url.pathname !== "/") { const page = new URL(url); page.search = ""; page.hash = ""; pageUrls.push(page); }
  const candidates: URL[] = [];
  for (const page of pageUrls) {
    if (Date.now() >= deadline) break;
    const html = await fetchLimited(page, original, maxHtmlBytes, "text/html", Math.min(4500, deadline - Date.now()));
    if (!html || !html.contentType.includes("html")) continue;
    candidates.push(...declaredIconUrls(new TextDecoder().decode(html.bytes), html.finalUrl));
    if (candidates.length) break;
  }
  for (const path of ["/favicon.ico", "/apple-touch-icon.png", "/favicon.png", "/favicon.svg"]) candidates.push(new URL(path, original));
  for (const candidate of [...new Map(candidates.map(value => [value.href, value])).values()].slice(0, 10)) {
    if (Date.now() >= deadline) break;
    const image = await fetchLimited(candidate, original, maxIconBytes, "image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.8", Math.min(4500, deadline - Date.now()));
    if (!image) continue;
    const contentType = iconType(image.bytes, image.contentType);
    if (contentType) return { bytes: image.bytes, contentType };
  }
  return null;
}

export function discoverSiteIcon(url: string): Promise<FoundIcon | null> {
  const parsed = new URL(url);
  const key = parsed.origin;
  const cached = iconCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const value = discover(parsed).catch(() => null);
  iconCache.set(key, { value, expires: Date.now() + 60 * 60 * 1000 });
  if (iconCache.size > 500) iconCache.delete(iconCache.keys().next().value!);
  void value.then(result => { const entry = iconCache.get(key); if (entry?.value === value) entry.expires = Date.now() + (result ? 24 : 1) * 60 * 60 * 1000; });
  return value;
}
