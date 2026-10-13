import { normalizeUrl } from "@/lib/validation";

export type DuplicateEntry = { id: string; area: "website" | "imported" | "private"; name: string; url: string; location: string; description?: string; favorite?: boolean };

export function groupDuplicates(entries: DuplicateEntry[]) {
  const byUrl = new Map<string, DuplicateEntry[]>();
  for (const entry of entries) {
    const key = normalizeUrl(entry.url);
    const group = byUrl.get(key);
    if (group) group.push(entry);
    else byUrl.set(key, [entry]);
  }
  return [...byUrl.entries()].filter(([, members]) => members.length > 1).sort((left, right) => right[1].length - left[1].length);
}
