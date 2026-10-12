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
      db.prepare(`INSERT INTO websites (id,name,url,description,icon,tags,collection,folder_id,favorite,alias,created_at)
      VALUES (@id,@name,@url,@description,@icon,@tags,@collection,@folderId,@favorite,@alias,@createdAt)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,description=excluded.description,icon=excluded.icon,tags=excluded.tags,collection=excluded.collection,folder_id=excluded.folder_id,favorite=excluded.favorite,alias=excluded.alias`).run({
        id, name, url, description: string(item.description, 1000), icon: string(item.icon, 2048) ? safeUrl(item.icon) : "",
        tags: JSON.stringify(tags(item.tags)), collection: string(item.collection, 80), folderId, favorite: item.favorite ? 1 : 0,
        alias: string(item.alias, 80), createdAt: now
      });
    } else if (action === "website.delete") {
      db.prepare("DELETE FROM websites WHERE id = ?").run(required(item.id, 80));
    } else if (action === "website.bulkMove") {
      const folderId = string(item.folderId, 80) || null;
      websiteFolder(folderId);
      const move = db.prepare("UPDATE websites SET folder_id = ? WHERE id = ?");
      db.transaction(() => { for (const websiteId of ids(item.ids)) move.run(folderId, websiteId); })();
    } else if (action === "website.bulkSave") {
      if (!Array.isArray(item.rows) || item.rows.length > 10000) throw new Error("网站数量无效");
      const rows = item.rows.map((row: Record<string, unknown>) => ({
        id: required(row.id, 80), name: required(row.name, 160), url: safeUrl(row.url),
        description: string(row.description, 1000), icon: string(row.icon, 2048) ? safeUrl(row.icon) : "",
        folderId: string(row.folderId, 80) || null
      }));
      for (const row of rows) websiteFolder(row.folderId);
      const save = db.prepare(`INSERT INTO websites (id,name,url,description,icon,tags,collection,folder_id,favorite,alias,created_at)
        VALUES (@id,@name,@url,@description,@icon,'[]','',@folderId,0,'',@createdAt)`);
      db.transaction(() => { for (const row of rows) save.run({ ...row, createdAt: now }); })();
    } else if (action === "website.bulkDelete") {
      const remove = db.prepare("DELETE FROM websites WHERE id = ?");
      db.transaction(() => { for (const websiteId of ids(item.ids)) remove.run(websiteId); })();
    } else if (action === "folder.save") {
      const name = required(item.name, 160);
      const parentId = string(item.parentId, 80) || null;
      websiteFolder(parentId);
      const existing = db.prepare("SELECT id FROM website_folders WHERE id = ?").get(id);
      if (existing) {
        if (parentId && folderDescendants(id).some(folder => folder.id === parentId)) throw new Error("不能将文件夹移入自身或子文件夹");
        db.prepare("UPDATE website_folders SET name = ?, parent_id = ? WHERE id = ?").run(name, parentId, id);
      } else {
        db.prepare("INSERT INTO website_folders (id,name,parent_id,created_at) VALUES (?,?,?,?)").run(id, name, parentId, now);
      }
    } else if (action === "folder.delete") {
      const descendants = folderDescendants(required(item.id, 80));
      const removeWebsite = db.prepare("DELETE FROM websites WHERE folder_id = ?");
      const removeFolder = db.prepare("DELETE FROM website_folders WHERE id = ?");
      db.transaction(() => {
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
      db.prepare("DELETE FROM protected_items WHERE id = ?").run(required(item.id, 80));
    } else if (action === "protected.deleteMany") {
      const remove = db.prepare("DELETE FROM protected_items WHERE id = ?");
      db.transaction(() => { for (const protectedId of ids(item.ids)) remove.run(protectedId); })();
    } else if (action === "batch.save") {
      db.prepare("INSERT INTO import_batches (id,source,scanned,added,skipped,imported_at) VALUES (?,?,?,?,?,?)").run(
        id, required(item.source, 60), Number(item.scanned) || 0, Number(item.added) || 0, Number(item.skipped) || 0, now
      );
    } else return error("未知操作");
    return Response.json(snapshot());
  } catch (e) { return error((e as Error).message); }
}
