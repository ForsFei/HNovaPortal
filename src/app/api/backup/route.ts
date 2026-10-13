import db from "@/lib/db";
import { localRequest } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tables = ["websites", "website_folders", "servers", "services", "vault", "protected_items", "import_batches", "trash_entries", "website_checks"] as const;
type Table = typeof tables[number];
type Row = Record<string, unknown>;
type Backup = { format: "HNovaPortalBackup"; version: 1 | 2; exportedAt: string; tables: Record<Table, Row[]> };
const columns: Record<Table, string[]> = {
  websites: ["id", "name", "url", "description", "icon", "tags", "collection", "folder_id", "sort_order", "favorite", "alias", "created_at"],
  website_folders: ["id", "parent_id", "name", "sort_order", "created_at"],
  servers: ["id", "name", "host", "environment", "description", "created_at"],
  services: ["id", "server_id", "name", "host", "port", "protocol", "path", "description", "tags", "environment", "alias", "created_at"],
  vault: ["id", "salt", "verifier_payload", "verifier_nonce", "crypto_version", "created_at"],
  protected_items: ["id", "kind", "payload", "nonce", "crypto_version", "created_at"],
  import_batches: ["id", "source", "scanned", "added", "skipped", "imported_at"],
  trash_entries: ["id", "area", "label", "count", "payload", "deleted_at"],
  website_checks: ["website_id", "state", "code", "checked_at"]
};
function readBackup(input: unknown): Backup {
  if (!input || typeof input !== "object") throw new Error("无效的备份文件");
  const backup = input as Backup;
  if (backup.format !== "HNovaPortalBackup" || ![1, 2].includes(backup.version) || !backup.tables || typeof backup.tables !== "object") throw new Error("备份格式或版本不受支持");
  if (backup.version === 1 && !backup.tables.website_checks) backup.tables.website_checks = [];
  for (const table of tables) {
    const rows = backup.tables[table];
    if (!Array.isArray(rows) || rows.length > 100000) throw new Error(`${table} 数据无效`);
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`${table} 记录无效`);
      for (const column of columns[table]) if (!(column in row)) throw new Error(`${table} 缺少 ${column}`);
    }
  }
  if (backup.tables.vault.length > 1) throw new Error("保险库记录无效");
  return backup;
}
function counts(backup: Backup) { return Object.fromEntries(tables.map(table => [table, backup.tables[table].length])); }

export async function GET(request: Request) {
  try {
    localRequest(request);
    const data = Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
    const backup = { format: "HNovaPortalBackup", version: 2, exportedAt: new Date().toISOString(), tables: data };
    return new Response(JSON.stringify(backup), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="HNovaPortal-${new Date().toISOString().slice(0, 10)}.json"`, "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: (error as Error).message }, { status: 403 }); }
}

export async function POST(request: Request) {
  try {
    localRequest(request);
    const source = await request.text();
    if (source.length > 64 * 1024 * 1024) throw new Error("备份文件超过 64 MB");
    const body = JSON.parse(source) as { action?: string; backup?: unknown };
    const backup = readBackup(body.backup);
    if (body.action === "preview") return Response.json({ exportedAt: backup.exportedAt, counts: counts(backup) });
    if (body.action !== "restore") throw new Error("未知操作");
    db.transaction(() => {
      for (const table of ["website_checks", "websites", "website_folders", "services", "servers", "protected_items", "vault", "import_batches", "trash_entries"] as const) db.prepare(`DELETE FROM ${table}`).run();
      for (const table of ["website_folders", "websites", "website_checks", "servers", "services", "vault", "protected_items", "import_batches", "trash_entries"] as const) {
        const names = columns[table];
        const insert = db.prepare(`INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map(name => `@${name}`).join(",")})`);
        const rows = table === "website_folders" ? [...backup.tables[table]] : backup.tables[table];
        if (table === "website_folders") {
          const pending = [...rows];
          while (pending.length) {
            const index = pending.findIndex(row => !row.parent_id || db.prepare("SELECT 1 FROM website_folders WHERE id = ?").get(row.parent_id));
            if (index < 0) throw new Error("备份中的文件夹层级无效");
            const [row] = pending.splice(index, 1);
            insert.run(Object.fromEntries(names.map(name => [name, row[name]])));
          }
        } else for (const row of rows) insert.run(Object.fromEntries(names.map(name => [name, row[name]])));
      }
    })();
    return Response.json({ ok: true, counts: counts(backup) });
  } catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
}
