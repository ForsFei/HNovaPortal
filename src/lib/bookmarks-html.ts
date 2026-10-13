import type { Website, WebsiteFolder } from "@/lib/db";

const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const order = <T extends { sortOrder: number; createdAt: string }>(left: T, right: T) => left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt);

export function bookmarksHtml(folders: WebsiteFolder[], websites: Website[]) {
  const lines = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', '<TITLE>HNova Portal 书签</TITLE>', '<H1>HNova Portal 书签</H1>', '<DL><p>'];
  const visited = new Set<string>();
  const write = (parentId: string | null, depth: number) => {
    const pad = "    ".repeat(depth);
    const entries = [
      ...folders.filter(value => value.parentId === parentId).map(value => ({ type: "folder" as const, value })),
      ...websites.filter(value => value.folderId === parentId).map(value => ({ type: "website" as const, value }))
    ].sort((left, right) => order(left.value, right.value));
    for (const entry of entries) {
      if (entry.type === "folder") {
        const folder = entry.value;
        if (visited.has(folder.id)) continue;
        visited.add(folder.id);
        lines.push(`${pad}<DT><H3>${escape(folder.name)}</H3>`, `${pad}<DL><p>`);
        write(folder.id, depth + 1);
        lines.push(`${pad}</DL><p>`);
      } else {
        const website = entry.value;
        const date = Math.floor(new Date(website.createdAt).getTime() / 1000);
        lines.push(`${pad}<DT><A HREF="${escape(website.url)}" ADD_DATE="${Number.isFinite(date) ? date : 0}">${escape(website.name)}</A>`);
      }
    }
  };
  write(null, 1);
  lines.push("</DL><p>");
  return lines.join("\n");
}
