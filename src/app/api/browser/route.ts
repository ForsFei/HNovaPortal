import fs from "node:fs/promises";
import path from "node:path";
import { localRequest } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Browser = "Chrome" | "Edge";
type Entry = { name: string; url: string; folder: string; browser: Browser; profile: string };
const roots: Record<Browser, string> = {
  Chrome: path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "User Data"),
  Edge: path.join(process.env.LOCALAPPDATA || "", "Microsoft", "Edge", "User Data")
};
function validProfile(value: string) { return value === "Default" || /^Profile [1-9]\d*$/.test(value); }
async function profiles() {
  const result: { browser: Browser; profile: string; label: string }[] = [];
  for (const browser of ["Chrome", "Edge"] as Browser[]) {
    let names: string[] = [];
    try { names = await fs.readdir(/* turbopackIgnore: true */ roots[browser]); } catch { continue; }
    let cache: Record<string, { name?: string }> = {};
    try {
      const state = JSON.parse(await fs.readFile(path.join(roots[browser], "Local State"), "utf8"));
      cache = state.profile?.info_cache || {};
    } catch { /* Local State is optional. */ }
    for (const profile of names.filter(validProfile)) {
      try {
        await fs.access(path.join(roots[browser], profile, "Bookmarks"));
        result.push({ browser, profile, label: cache[profile]?.name || profile });
      } catch { /* No bookmark file in this profile. */ }
    }
  }
  return result;
}
function parseBookmarks(data: unknown, browser: Browser, profile: string): { entries: Entry[]; folders: number } {
  const entries: Entry[] = [];
  let folders = 0;
  const root = data as { roots?: Record<string, unknown> };
  function visit(node: unknown, trail: string[]) {
    if (!node || typeof node !== "object") return;
    const item = node as { type?: string; name?: string; url?: string; children?: unknown[] };
    if (item.type === "url" && typeof item.url === "string" && /^https?:\/\//i.test(item.url)) {
      entries.push({ name: item.name || item.url, url: item.url, folder: trail.join(" / "), browser, profile });
    } else if (item.type === "folder") {
      folders++;
      const next = item.name ? [...trail, item.name] : trail;
      for (const child of item.children || []) visit(child, next);
    }
  }
  for (const node of Object.values(root.roots || {})) visit(node, []);
  return { entries: entries.slice(0, 10000), folders };
}
export async function GET(request: Request) {
  try { localRequest(request); return Response.json({ profiles: await profiles() }); }
  catch (e) { return Response.json({ error: (e as Error).message }, { status: 403 }); }
}
export async function POST(request: Request) {
  try {
    localRequest(request);
    const { browser, profile } = await request.json();
    if ((browser !== "Chrome" && browser !== "Edge") || typeof profile !== "string" || !validProfile(profile)) throw new Error("无效的浏览器资料");
    const match = (await profiles()).some(p => p.browser === browser && p.profile === profile);
    if (!match) throw new Error("浏览器资料未找到");
    const filename = path.join(roots[browser as Browser], profile, "Bookmarks");
    const source = await fs.readFile(filename);
    // Snapshot in memory; the browser's file remains untouched, even if it changes during parsing.
    const copy = Buffer.from(source);
    const parsed = parseBookmarks(JSON.parse(copy.toString("utf8")), browser, profile);
    return Response.json(parsed);
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
}
