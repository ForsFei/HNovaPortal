"use client";

import { argon2id } from "@noble/hashes/argon2.js";

export type Cipher = { payload: string; nonce: string };
export type SecretItem = {
  id: string; kind: "imported" | "private"; name: string; url: string; description?: string;
  notes?: string; tags?: string[]; collection?: string; browser?: string; profile?: string;
  folder?: string; folderId?: string | null; createdAt?: string
};
export type SecretFolder = {
  id: string; kind: "imported" | "private"; nodeType: "folder"; name: string;
  parentId: string | null; createdAt?: string
};
export type SecretNode = SecretItem | SecretFolder;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));

export function newSalt() { return b64(crypto.getRandomValues(new Uint8Array(16))); }
export async function deriveKey(password: string, salt: string): Promise<CryptoKey> {
  const bytes = argon2id(encoder.encode(password), unb64(salt), { t: 3, m: 65536, p: 1, dkLen: 32 });
  try { return await crypto.subtle.importKey("raw", bytes as BufferSource, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]); }
  finally { bytes.fill(0); }
}
export async function encrypt(key: CryptoKey, value: unknown): Promise<Cipher> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const payload = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, encoder.encode(JSON.stringify(value)));
  return { payload: b64(new Uint8Array(payload)), nonce: b64(nonce) };
}
export async function decrypt<T>(key: CryptoKey, value: Cipher): Promise<T> {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(value.nonce) }, key, unb64(value.payload));
  return JSON.parse(decoder.decode(plain)) as T;
}
export const verifier = "HNOVA_PORTAL_VAULT_V1";
