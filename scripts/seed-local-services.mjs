import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const projectDir = path.resolve(import.meta.dirname, "..");
const dbPath = process.env.HNOVA_DB_PATH || path.join(projectDir, "data", "portal.db");
const definitions = [
  { port: 43100, name: "HNova Portal", description: "个人导航与服务入口" },
  { port: 43110, name: "HNova Atlas", description: "本地知识与内容站点" },
  { port: 43120, name: "HNova Muse", description: "本地音乐服务" },
  { port: 43130, name: "HNova Play", description: "Windows 桌面应用" },
  { port: 43140, name: "HNova Reader", description: "Windows 桌面应用" },
  { port: 43150, name: "HNova Archive", description: "Windows 桌面应用" },
  { port: 43160, name: "HNova TrainEcho", description: "本地列车服务" },
  { port: 43170, name: "HGame 游戏库", description: "十个网页小游戏的统一入口，单个本地服务" }
];

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, host TEXT NOT NULL, environment TEXT NOT NULL DEFAULT 'Home',
      description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY, server_id TEXT REFERENCES servers(id) ON DELETE SET NULL,
      name TEXT NOT NULL, host TEXT NOT NULL DEFAULT '', port INTEGER, protocol TEXT NOT NULL DEFAULT 'http',
      path TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]',
      environment TEXT NOT NULL DEFAULT 'Home', alias TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
  `);

  const host = "127.0.0.1";
  const serverName = "本机 HNova 服务";
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT id, name, host, port FROM services").all();
  const selectedDefinitions = process.argv.includes("--game-library-only") ? definitions.filter(entry => entry.port === 43170) : definitions;
  const missing = selectedDefinitions.filter(entry => !existing.some(item =>
    item.name.toLowerCase() === entry.name.toLowerCase() || (item.host === host && item.port === entry.port)
  ));

  if (!missing.length) {
    console.log("HNova 本机服务入口已存在，无需新增。");
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
