import db, { snapshot } from "@/lib/db";
import { localRequest, required, safeUrl, string, tags } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const error = (message: string, status = 400) => Response.json({ error: message }, { status });
const ids = (value: unknown) => {
  if (!Array.isArray(value) || value.length > 10000) throw new Error("项目数量无效");
  return [...new Set(value.map(id => required(id, 80)))];
};
function websiteFolder(id: string | null) {
  if (id && !db.prepare("SELECT id FROM website_folders WHERE id = ?").get(id)) throw new Error("文件夹不存在");
}
function folderDescendants(id: string) {
  return db.prepare(`WITH RECURSIVE tree(id,depth) AS (
    SELECT id,0 FROM website_folders WHERE id = ?
    UNION ALL SELECT child.id,tree.depth+1 FROM website_folders child JOIN tree ON child.parent_id = tree.id
  ) SELECT id,depth FROM tree ORDER BY depth DESC`).all(id) as { id: string; depth: number }[];
}
function trash(area: "website" | "imported" | "private", label: string, rows: { websites?: unknown[]; folders?: unknown[]; protectedRows?: unknown[] }) {
  const count = (rows.websites?.length || 0) + (rows.folders?.length || 0) + (rows.protectedRows?.length || 0);
  if (!count) return;
  db.prepare("INSERT INTO trash_entries (id,area,label,count,payload,deleted_at) VALUES (?,?,?,?,?,?)")
    .run(crypto.randomUUID(), area, label, count, JSON.stringify(rows), new Date().toISOString());
}
function nextOrder(parentId: string | null) {
  const website = (db.prepare("SELECT COALESCE(MAX(sort_order),-1) AS max FROM websites WHERE folder_id IS ?").get(parentId) as { max: number }).max;
  const folder = (db.prepare("SELECT COALESCE(MAX(sort_order),-1) AS max FROM website_folders WHERE parent_id IS ?").get(parentId) as { max: number }).max;
  return Math.max(website, folder) + 1;
}

export async function GET(request: Request) {
  try { localRequest(request); return Response.json(snapshot()); }
  catch (e) { return error((e as Error).message, 403); }
}

export async function POST(request: Request) {
  try {
    localRequest(request);
    const body = await request.json();
    const action = string(body.action, 40);
    const item = body.item || {};
    const id = string(item.id, 80) || crypto.randomUUID();
    const now = new Date().toISOString();
    if (action === "website.save") {
      const url = safeUrl(item.url);
      const name = required(item.name, 160);
      const folderId = string(item.folderId, 80) || null;
      websiteFolder(folderId);
      const previous = db.prepare("SELECT url FROM websites WHERE id = ?").get(id) as { url: string } | undefined;
      db.prepare(`INSERT INTO websites (id,name,url,description,icon,tags,collection,folder_id,sort_order,favorite,alias,created_at)
      VALUES (@id,@name,@url,@description,@icon,@tags,@collection,@folderId,@sortOrder,@favorite,@alias,@createdAt)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,description=excluded.description,icon=excluded.icon,tags=excluded.tags,collection=excluded.collection,sort_order=CASE WHEN websites.folder_id IS excluded.folder_id THEN websites.sort_order ELSE excluded.sort_order END,folder_id=excluded.folder_id,favorite=excluded.favorite,alias=excluded.alias`).run({
        id, name, url, description: string(item.description, 1000), icon: string(item.icon, 2048) ? safeUrl(item.icon) : "",
        tags: JSON.stringify(tags(item.tags)), collection: string(item.collection, 80), folderId, sortOrder: nextOrder(folderId), favorite: item.favorite ? 1 : 0,
        alias: string(item.alias, 80), createdAt: now
      });
      if (previous && previous.url !== url) db.prepare("DELETE FROM website_checks WHERE website_id = ?").run(id);
    } else if (action === "website.delete") {
      const websiteId = required(item.id, 80);
      db.transaction(() => { const row = db.prepare("SELECT * FROM websites WHERE id = ?").get(websiteId); if (row) { trash("website", "1 个网站", { websites: [row] }); db.prepare("DELETE FROM websites WHERE id = ?").run(websiteId); } })();
    } else if (action === "website.bulkMove") {
      const folderId = string(item.folderId, 80) || null;
      websiteFolder(folderId);
      const move = db.prepare("UPDATE websites SET folder_id = ?, sort_order = ? WHERE id = ?");
      db.transaction(() => { let order = nextOrder(folderId); for (const websiteId of ids(item.ids)) move.run(folderId, order++, websiteId); })();
    } else if (action === "website.bulkSave") {
      if (!Array.isArray(item.rows) || item.rows.length > 10000) throw new Error("网站数量无效");
      const rows = item.rows.map((row: Record<string, unknown>) => ({
        id: required(row.id, 80), name: required(row.name, 160), url: safeUrl(row.url),
        description: string(row.description, 1000), icon: string(row.icon, 2048) ? safeUrl(row.icon) : "",
        folderId: string(row.folderId, 80) || null
      }));
      for (const row of rows) websiteFolder(row.folderId);
      const save = db.prepare(`INSERT INTO websites (id,name,url,description,icon,tags,collection,folder_id,sort_order,favorite,alias,created_at)
        VALUES (@id,@name,@url,@description,@icon,'[]','',@folderId,@sortOrder,0,'',@createdAt)`);
      db.transaction(() => { for (const row of rows) save.run({ ...row, sortOrder: nextOrder(row.folderId), createdAt: now }); })();
    } else if (action === "website.bulkDelete") {
      const remove = db.prepare("DELETE FROM websites WHERE id = ?");
      db.transaction(() => { const selected = ids(item.ids); const rows = selected.map(websiteId => db.prepare("SELECT * FROM websites WHERE id = ?").get(websiteId)).filter(Boolean); trash("website", `${rows.length} 个网站`, { websites: rows }); for (const websiteId of selected) remove.run(websiteId); })();
    } else if (action === "bookmark.reorder") {
      const folderId = string(item.folderId, 80) || null;
      websiteFolder(folderId);
      if (!Array.isArray(item.entries) || item.entries.length > 10000) throw new Error("排序项目无效");
      const entries = item.entries.map((entry: { id?: unknown; type?: unknown }) => ({ id: required(entry.id, 80), type: entry.type === "folder" ? "folder" : entry.type === "items" ? "items" : null }));
      if (entries.some((entry: { type: string | null }) => !entry.type)) throw new Error("排序类型无效");
      const actual = [
        ...(db.prepare("SELECT id FROM website_folders WHERE parent_id IS ?").all(folderId) as { id: string }[]).map(row => `folder:${row.id}`),
        ...(db.prepare("SELECT id FROM websites WHERE folder_id IS ?").all(folderId) as { id: string }[]).map(row => `items:${row.id}`)
      ];
      const wanted = entries.map((entry: { type: string; id: string }) => `${entry.type}:${entry.id}`);
      if (actual.length !== wanted.length || new Set(wanted).size !== actual.length || actual.some(value => !wanted.includes(value))) throw new Error("排序项目必须属于同一文件夹");
      const updateFolder = db.prepare("UPDATE website_folders SET sort_order = ? WHERE id = ?");
      const updateWebsite = db.prepare("UPDATE websites SET sort_order = ? WHERE id = ?");
      db.transaction(() => { entries.forEach((entry: { type: string; id: string }, index: number) => (entry.type === "folder" ? updateFolder : updateWebsite).run(index, entry.id)); })();
    } else if (action === "folder.save") {
      const name = required(item.name, 160);
      const parentId = string(item.parentId, 80) || null;
      websiteFolder(parentId);
      const existing = db.prepare("SELECT id FROM website_folders WHERE id = ?").get(id);
      if (existing) {
        if (parentId && folderDescendants(id).some(folder => folder.id === parentId)) throw new Error("不能将文件夹移入自身或子文件夹");
        db.prepare("UPDATE website_folders SET name = ?, parent_id = ?, sort_order = CASE WHEN parent_id IS ? THEN sort_order ELSE ? END WHERE id = ?")
          .run(name, parentId, parentId, nextOrder(parentId), id);
      } else {
        db.prepare("INSERT INTO website_folders (id,name,parent_id,sort_order,created_at) VALUES (?,?,?,?,?)").run(id, name, parentId, nextOrder(parentId), now);
      }
    } else if (action === "folder.delete") {
      const descendants = folderDescendants(required(item.id, 80));
      const removeWebsite = db.prepare("DELETE FROM websites WHERE folder_id = ?");
      const removeFolder = db.prepare("DELETE FROM website_folders WHERE id = ?");
      db.transaction(() => {
        const folderRows = descendants.map(folder => db.prepare("SELECT * FROM website_folders WHERE id = ?").get(folder.id));
        const websiteRows = descendants.flatMap(folder => db.prepare("SELECT * FROM websites WHERE folder_id = ?").all(folder.id));
        trash("website", `${descendants.length} 个文件夹及内容`, { folders: folderRows, websites: websiteRows });
        for (const folder of descendants) removeWebsite.run(folder.id);
        for (const folder of descendants) removeFolder.run(folder.id);
      })();
    } else if (action === "server.save") {
      db.prepare(`INSERT INTO servers (id,name,host,environment,description,created_at) VALUES (@id,@name,@host,@environment,@description,@createdAt)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,host=excluded.host,environment=excluded.environment,description=excluded.description`).run({
        id, name: required(item.name, 160), host: required(item.host, 255), environment: string(item.environment, 80) || "Home",
        description: string(item.description, 1000), createdAt: now
      });
    } else if (action === "server.delete") {
      db.prepare("DELETE FROM servers WHERE id = ?").run(required(item.id, 80));
    } else if (action === "service.save") {
      const serverId = string(item.serverId, 80) || null;
      const server = serverId ? db.prepare("SELECT host FROM servers WHERE id = ?").get(serverId) as { host: string } | undefined : undefined;
      if (serverId && !server) throw new Error("设备不存在");
      const port = item.port === "" || item.port === null || item.port === undefined ? null : Number(item.port);
      if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error("端口需为 1–65535");
      const protocol = item.protocol === "https" ? "https" : "http";
      const host = string(item.host, 255) || server?.host || "";
      if (!host) throw new Error("请填写 Host 或选择设备");
      if (/[/\s@?#]/.test(host)) throw new Error("Host 格式无效");
      db.prepare(`INSERT INTO services (id,server_id,name,host,port,protocol,path,description,tags,environment,alias,created_at)
      VALUES (@id,@serverId,@name,@host,@port,@protocol,@path,@description,@tags,@environment,@alias,@createdAt)
      ON CONFLICT(id) DO UPDATE SET server_id=excluded.server_id,name=excluded.name,host=excluded.host,port=excluded.port,protocol=excluded.protocol,path=excluded.path,description=excluded.description,tags=excluded.tags,environment=excluded.environment,alias=excluded.alias`).run({
        id, serverId, name: required(item.name, 160), host, port, protocol, path: string(item.path, 255),
        description: string(item.description, 1000), tags: JSON.stringify(tags(item.tags)),
        environment: string(item.environment, 80) || "Home", alias: string(item.alias, 80), createdAt: now
      });
    } else if (action === "service.delete") {
      db.prepare("DELETE FROM services WHERE id = ?").run(required(item.id, 80));
    } else if (action === "vault.create") {
      if (db.prepare("SELECT id FROM vault WHERE id = 1").get()) throw new Error("保险库已初始化");
      const salt = required(item.salt, 200), payload = required(item.verifierPayload, 1000), nonce = required(item.verifierNonce, 200);
      db.prepare("INSERT INTO vault (id,salt,verifier_payload,verifier_nonce,created_at) VALUES (1,?,?,?,?)").run(salt, payload, nonce, now);
    } else if (action === "protected.save") {
      if (!db.prepare("SELECT id FROM vault WHERE id = 1").get()) throw new Error("请先初始化保险库");
      const kind = item.kind === "imported" ? "imported" : item.kind === "private" ? "private" : null;
      if (!kind) throw new Error("无效的保护类型");
      db.prepare(`INSERT INTO protected_items (id,kind,payload,nonce,created_at) VALUES (?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,payload=excluded.payload,nonce=excluded.nonce`).run(
        id, kind, required(item.payload, 50000), required(item.nonce, 200), now
      );
    } else if (action === "protected.bulk") {
      if (!db.prepare("SELECT id FROM vault WHERE id = 1").get()) throw new Error("请先初始化保险库");
      if (!Array.isArray(item.rows) || item.rows.length > 10000) throw new Error("导入项目过多");
      const rows = item.rows.map((row: Record<string, unknown>) => ({
        id: required(row.id, 80), kind: row.kind === "imported" ? "imported" : row.kind === "private" ? "private" : null,
        payload: required(row.payload, 50000), nonce: required(row.nonce, 200)
      }));
      if (rows.some((row: { kind: string | null }) => !row.kind)) throw new Error("无效的保护类型");
      const write = db.prepare(`INSERT INTO protected_items (id,kind,payload,nonce,created_at) VALUES (?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,payload=excluded.payload,nonce=excluded.nonce`);
      db.transaction(() => { for (const row of rows) write.run(row.id, row.kind, row.payload, row.nonce, now); })();
    } else if (action === "protected.delete") {
      const protectedId = required(item.id, 80);
      db.transaction(() => { const row = db.prepare("SELECT * FROM protected_items WHERE id = ?").get(protectedId) as { kind: "imported" | "private" } | undefined; if (row) { trash(row.kind, "1 个加密项目", { protectedRows: [row] }); db.prepare("DELETE FROM protected_items WHERE id = ?").run(protectedId); } })();
    } else if (action === "protected.deleteMany") {
      const remove = db.prepare("DELETE FROM protected_items WHERE id = ?");
      db.transaction(() => { const selected = ids(item.ids); const rows = selected.map(protectedId => db.prepare("SELECT * FROM protected_items WHERE id = ?").get(protectedId)).filter(Boolean) as { kind: "imported" | "private" }[]; trash(rows[0]?.kind || "private", `${rows.length} 个加密项目`, { protectedRows: rows }); for (const protectedId of selected) remove.run(protectedId); })();
    } else if (action === "protected.removeMany") {
      const remove = db.prepare("DELETE FROM protected_items WHERE id = ?");
      db.transaction(() => { for (const protectedId of ids(item.ids)) remove.run(protectedId); })();
    } else if (action === "trash.restore") {
      const trashId = required(item.id, 80);
      db.transaction(() => {
        const entry = db.prepare("SELECT payload FROM trash_entries WHERE id = ?").get(trashId) as { payload: string } | undefined;
        if (!entry) throw new Error("回收站项目不存在");
        const payload = JSON.parse(entry.payload) as { folders?: Record<string, unknown>[]; websites?: Record<string, unknown>[]; protectedRows?: Record<string, unknown>[] };
        const folders = payload.folders || [], websites = payload.websites || [], protectedRows = payload.protectedRows || [];
        for (const row of [...folders, ...websites, ...protectedRows]) if (db.prepare(`SELECT 1 FROM ${folders.includes(row) ? "website_folders" : websites.includes(row) ? "websites" : "protected_items"} WHERE id = ?`).get(row.id)) throw new Error("原位置已有同 ID 项目，无法恢复");
        for (const row of folders.reverse()) {
          if (row.parent_id && !db.prepare("SELECT 1 FROM website_folders WHERE id = ?").get(row.parent_id)) row.parent_id = null;
          db.prepare("INSERT INTO website_folders (id,parent_id,name,sort_order,created_at) VALUES (@id,@parent_id,@name,@sort_order,@created_at)").run(row);
        }
        for (const row of websites) {
          if (row.folder_id && !db.prepare("SELECT 1 FROM website_folders WHERE id = ?").get(row.folder_id)) row.folder_id = null;
          db.prepare("INSERT INTO websites (id,name,url,description,icon,tags,collection,folder_id,sort_order,favorite,alias,created_at) VALUES (@id,@name,@url,@description,@icon,@tags,@collection,@folder_id,@sort_order,@favorite,@alias,@created_at)").run(row);
        }
        for (const row of protectedRows) db.prepare("INSERT INTO protected_items (id,kind,payload,nonce,crypto_version,created_at) VALUES (@id,@kind,@payload,@nonce,@crypto_version,@created_at)").run(row);
        db.prepare("DELETE FROM trash_entries WHERE id = ?").run(trashId);
      })();
    } else if (action === "trash.purge") {
      db.prepare("DELETE FROM trash_entries WHERE id = ?").run(required(item.id, 80));
    } else if (action === "trash.empty") {
      db.prepare("DELETE FROM trash_entries").run();
    } else if (action === "batch.save") {
      db.prepare("INSERT INTO import_batches (id,source,scanned,added,skipped,imported_at) VALUES (?,?,?,?,?,?)").run(
        id, required(item.source, 60), Number(item.scanned) || 0, Number(item.added) || 0, Number(item.skipped) || 0, now
      );
    } else return error("未知操作");
    return Response.json(snapshot());
  } catch (e) { return error((e as Error).message); }
}
