import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type Website = { id: string; name: string; url: string; description: string; icon: string; tags: string[]; collection: string; folderId: string | null; sortOrder: number; favorite: boolean; alias: string; createdAt: string };
export type WebsiteFolder = { id: string; name: string; parentId: string | null; sortOrder: number; createdAt: string };
export type Server = { id: string; name: string; host: string; environment: string; description: string; createdAt: string };
export type Service = { id: string; serverId: string | null; name: string; host: string; port: number | null; protocol: "http" | "https"; path: string; description: string; tags: string[]; environment: string; alias: string; createdAt: string };
export type ProtectedRow = { id: string; kind: "imported" | "private"; payload: string; nonce: string; version: number; createdAt: string };
export type TrashEntry = { id: string; area: "website" | "imported" | "private"; label: string; count: number; deletedAt: string };
export type WebsiteCheck = { websiteId: string; state: "ok" | "broken" | "unknown"; code: number | null; checkedAt: string };

const databasePath = process.env.HNOVA_DB_PATH || path.join(process.cwd(), "data", "portal.db");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS websites (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', collection TEXT NOT NULL DEFAULT '',
  favorite INTEGER NOT NULL DEFAULT 0, alias TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS website_folders (
  id TEXT PRIMARY KEY, parent_id TEXT REFERENCES website_folders(id), name TEXT NOT NULL, created_at TEXT NOT NULL
);
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
CREATE TABLE IF NOT EXISTS vault (
  id INTEGER PRIMARY KEY CHECK (id = 1), salt TEXT NOT NULL, verifier_payload TEXT NOT NULL,
  verifier_nonce TEXT NOT NULL, crypto_version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS protected_items (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('imported','private')),
  payload TEXT NOT NULL, nonce TEXT NOT NULL, crypto_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, scanned INTEGER NOT NULL, added INTEGER NOT NULL,
  skipped INTEGER NOT NULL, imported_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS trash_entries (
  id TEXT PRIMARY KEY, area TEXT NOT NULL, label TEXT NOT NULL, count INTEGER NOT NULL,
  payload TEXT NOT NULL, deleted_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS website_checks (
  website_id TEXT PRIMARY KEY REFERENCES websites(id) ON DELETE CASCADE,
  state TEXT NOT NULL, code INTEGER, checked_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_protected_kind ON protected_items(kind);
CREATE INDEX IF NOT EXISTS idx_websites_collection ON websites(collection);
CREATE INDEX IF NOT EXISTS idx_website_folders_parent ON website_folders(parent_id);
`);

if (!(db.pragma("table_info(websites)") as { name: string }[]).some(column => column.name === "folder_id")) {
  db.exec("ALTER TABLE websites ADD COLUMN folder_id TEXT");
}
if (!(db.pragma("table_info(websites)") as { name: string }[]).some(column => column.name === "sort_order")) db.exec("ALTER TABLE websites ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
if (!(db.pragma("table_info(website_folders)") as { name: string }[]).some(column => column.name === "sort_order")) db.exec("ALTER TABLE website_folders ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
db.exec("CREATE INDEX IF NOT EXISTS idx_websites_folder ON websites(folder_id)");
const migrateCollections = db.transaction(() => {
  if (db.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get("website_collections_to_folders")) return;
  const collections = db.prepare("SELECT DISTINCT collection FROM websites WHERE collection <> '' AND folder_id IS NULL").all() as { collection: string }[];
  const find = db.prepare("SELECT id FROM website_folders WHERE name = ? AND parent_id IS NULL");
  const insert = db.prepare("INSERT INTO website_folders (id,name,parent_id,created_at) VALUES (?,?,NULL,?)");
  const assign = db.prepare("UPDATE websites SET folder_id = ? WHERE collection = ? AND folder_id IS NULL");
  for (const { collection } of collections) {
    let folder = find.get(collection) as { id: string } | undefined;
    if (!folder) { folder = { id: randomUUID() }; insert.run(folder.id, collection, new Date().toISOString()); }
    assign.run(folder.id, collection);
  }
  db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run("website_collections_to_folders");
});
migrateCollections();

export function snapshot() {
  const websites = (db.prepare("SELECT * FROM websites ORDER BY sort_order, created_at, id").all() as Record<string, unknown>[]).map(row => ({
    id: row.id, name: row.name, url: row.url, description: row.description, icon: row.icon,
    tags: JSON.parse(row.tags as string), collection: row.collection, folderId: row.folder_id, sortOrder: row.sort_order, favorite: !!row.favorite,
    alias: row.alias, createdAt: row.created_at
  })) as Website[];
  const websiteFolders = db.prepare("SELECT id,name,parent_id AS parentId,sort_order AS sortOrder,created_at AS createdAt FROM website_folders ORDER BY sort_order,created_at,id").all() as WebsiteFolder[];
  const servers = (db.prepare("SELECT * FROM servers ORDER BY name").all() as Record<string, unknown>[]).map(row => ({
    id: row.id, name: row.name, host: row.host, environment: row.environment, description: row.description, createdAt: row.created_at
  })) as Server[];
  const services = (db.prepare("SELECT * FROM services ORDER BY name").all() as Record<string, unknown>[]).map(row => ({
    id: row.id, serverId: row.server_id, name: row.name, host: row.host, port: row.port,
    protocol: row.protocol, path: row.path, description: row.description,
    tags: JSON.parse(row.tags as string), environment: row.environment, alias: row.alias, createdAt: row.created_at
  })) as Service[];
  const protectedRows = (db.prepare("SELECT * FROM protected_items ORDER BY created_at DESC").all() as Record<string, unknown>[]).map(row => ({
    id: row.id, kind: row.kind, payload: row.payload, nonce: row.nonce, version: row.crypto_version, createdAt: row.created_at
  })) as ProtectedRow[];
  const vault = db.prepare("SELECT salt, verifier_payload AS verifierPayload, verifier_nonce AS verifierNonce, crypto_version AS version FROM vault WHERE id = 1").get();
  const batches = db.prepare("SELECT id, source, scanned, added, skipped, imported_at AS importedAt FROM import_batches ORDER BY imported_at DESC LIMIT 30").all();
  const trash = db.prepare("SELECT id,area,label,count,deleted_at AS deletedAt FROM trash_entries ORDER BY deleted_at DESC,rowid DESC").all() as TrashEntry[];
  const websiteChecks = db.prepare("SELECT website_id AS websiteId,state,code,checked_at AS checkedAt FROM website_checks").all() as WebsiteCheck[];
  return { websites, websiteFolders, servers, services, protectedRows, vault: vault || null, batches, trash, websiteChecks };
}

export default db;
