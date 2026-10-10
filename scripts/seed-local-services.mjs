import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const projectDir = path.resolve(import.meta.dirname, "..");
const planPath = path.resolve(projectDir, "..", "HNova端口规划.md");
const dbPath = process.env.HNOVA_DB_PATH || path.join(projectDir, "data", "portal.db");
const plan = fs.readFileSync(planPath, "utf8");
const definitions = [...plan.matchAll(/^\s*(431(?:00|10|20|30|40|50|60))\s+(HNova\s+\S+)\s+(.+)$/gm)]
  .map(([, port, name, description]) => ({ port: Number(port), name: name.trim(), description: description.trim() }));

if (definitions.length !== 7) throw new Error("端口规划中应包含 43100–43160 的七个 HNova 服务；本次没有修改数据库。");
if (!fs.existsSync(dbPath)) throw new Error("Portal 数据库尚未创建。请先启动 HNova Portal，再运行此脚本。");

const db = new Database(dbPath);
try {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('servers', 'services')").all();
  if (tables.length !== 2) throw new Error("Portal 数据表尚未初始化。请先启动 HNova Portal。");

  const host = "127.0.0.1";
  const serverName = "本机 HNova 服务";
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT id, name, host, port FROM services").all();
  const missing = definitions.filter(entry => !existing.some(item =>
    item.name.toLowerCase() === entry.name.toLowerCase() || (item.host === host && item.port === entry.port)
  ));

  if (!missing.length) {
    console.log("七个 HNova 服务已存在，无需新增。");
  } else {
    const save = db.transaction(() => {
      let server = db.prepare("SELECT id FROM servers WHERE name = ?").get(serverName);
      if (!server) {
        const id = randomUUID();
        db.prepare("INSERT INTO servers (id,name,host,environment,description,created_at) VALUES (?,?,?,?,?,?)")
          .run(id, serverName, host, "本机", "HNova 系列本地服务入口", now);
        server = { id };
      }
      const insert = db.prepare(`INSERT INTO services
        (id,server_id,name,host,port,protocol,path,description,tags,environment,alias,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const entry of missing) {
        insert.run(randomUUID(), server.id, entry.name, host, entry.port, "http", "", entry.description,
          JSON.stringify(["HNova"]), "本机", entry.name.replace(/^HNova\s+/, "").toLowerCase(), now);
      }
    });
    save();
    for (const entry of missing) console.log(`已添加 ${entry.name}: http://${host}:${entry.port}`);
  }
} finally {
  db.close();
}
