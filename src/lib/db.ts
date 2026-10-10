import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type Website = { id: string; name: string; url: string; description: string; icon: string; tags: string[]; collection: string; favorite: boolean; alias: string; createdAt: string };
export type Server = { id: string; name: string; host: string; environment: string; description: string; createdAt: string };
export type Service = { id: string; serverId: string | null; name: string; host: string; port: number | null; protocol: "http" | "https"; path: string; description: string; tags: string[]; environment: string; alias: string; createdAt: string };
export type ProtectedRow = { id: string; kind: "imported" | "private"; payload: string; nonce: string; version: number; createdAt: string };

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
CREATE INDEX IF NOT EXISTS idx_protected_kind ON protected_items(kind);
CREATE INDEX IF NOT EXISTS idx_websites_collection ON websites(collection);
`);

export function snapshot() {
  const websites = (db.prepare("SELECT * FROM websites ORDER BY favorite DESC, created_at DESC").all() as Record<string, unknown>[]).map(row => ({
    id: row.id, name: row.name, url: row.url, description: row.description, icon: row.icon,
    tags: JSON.parse(row.tags as string), collection: row.collection, favorite: !!row.favorite,
    alias: row.alias, createdAt: row.created_at
  })) as Website[];
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
  return { websites, servers, services, protectedRows, vault: vault || null, batches };
}

export default db;
