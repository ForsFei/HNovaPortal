"use client";

import { decrypt, encrypt, type SecretFolder, type SecretItem, type SecretNode } from "@/lib/vault";
import type { ProtectedRow } from "@/lib/db";

export type EncryptedWrite = { id: string; kind: "imported" | "private"; payload: string; nonce: string };

export async function decodeNodes(rows: ProtectedRow[], key: CryptoKey) {
  const values = await Promise.all(rows.map(async row => {
    try { return await decrypt<SecretNode>(key, row); } catch { return null; }
  }));
  const nodes = values.filter((value): value is SecretNode => value !== null);
  return {
    items: nodes.filter((node): node is SecretItem => !("nodeType" in node && node.nodeType === "folder")),
    folders: nodes.filter((node): node is SecretFolder => "nodeType" in node && node.nodeType === "folder")
  };
}

export async function migrateLegacyFolders(rows: ProtectedRow[], key: CryptoKey, extraPaths: { kind: "imported" | "private"; parts: string[] }[] = []): Promise<EncryptedWrite[]> {
  const { items, folders } = await decodeNodes(rows, key);
  const known = new Map(folders.map(folder => [`${folder.kind}\u0000${folder.parentId || ""}\u0000${folder.name}`, folder.id]));
  const writes: EncryptedWrite[] = [];
  const save = async (node: SecretNode) => {
    const cipher = await encrypt(key, node);
    writes.push({ id: node.id, kind: node.kind, ...cipher });
  };
  const ensurePath = async (kind: "imported" | "private", parts: string[]) => {
    let parentId: string | null = null;
    for (const rawName of parts) {
      const name = rawName.trim().slice(0, 160);
      if (!name) continue;
      const keyName = `${kind}\u0000${parentId || ""}\u0000${name}`;
      let folderId = known.get(keyName);
      if (!folderId) {
        folderId = crypto.randomUUID();
        known.set(keyName, folderId);
        await save({ id: folderId, kind, nodeType: "folder", name, parentId, createdAt: new Date().toISOString() });
      }
      parentId = folderId;
    }
    return parentId;
  };
  for (const path of extraPaths) await ensurePath(path.kind, path.parts);
  for (const item of items) {
    if (item.folderId !== undefined) continue;
    const parts = item.kind === "imported"
      ? [item.browser || "导入", item.profile || "默认", ...(item.folder || "").split(" / ").filter(Boolean)]
      : item.collection ? [item.collection] : [];
    const parentId = await ensurePath(item.kind, parts);
    await save({ ...item, folderId: parentId });
  }
  return writes;
}
