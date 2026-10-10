import db, { snapshot } from "@/lib/db";
import { localRequest, required, safeUrl, string, tags } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const error = (message: string, status = 400) => Response.json({ error: message }, { status });

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
      db.prepare(`INSERT INTO websites (id,name,url,description,icon,tags,collection,favorite,alias,created_at)
      VALUES (@id,@name,@url,@description,@icon,@tags,@collection,@favorite,@alias,@createdAt)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,description=excluded.description,icon=excluded.icon,tags=excluded.tags,collection=excluded.collection,favorite=excluded.favorite,alias=excluded.alias`).run({
        id, name, url, description: string(item.description, 1000), icon: string(item.icon, 2048),
        tags: JSON.stringify(tags(item.tags)), collection: string(item.collection, 80), favorite: item.favorite ? 1 : 0,
        alias: string(item.alias, 80), createdAt: now
      });
    } else if (action === "website.delete") {
      db.prepare("DELETE FROM websites WHERE id = ?").run(required(item.id, 80));
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
    } else if (action === "batch.save") {
      db.prepare("INSERT INTO import_batches (id,source,scanned,added,skipped,imported_at) VALUES (?,?,?,?,?,?)").run(
        id, required(item.source, 60), Number(item.scanned) || 0, Number(item.added) || 0, Number(item.skipped) || 0, now
      );
    } else return error("未知操作");
    return Response.json(snapshot());
  } catch (e) { return error((e as Error).message); }
}
