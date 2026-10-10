import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { argon2id } from "@noble/hashes/argon2.js";

const base = process.env.HNOVA_TEST_URL || "http://127.0.0.1:43100";
const password = "temporary-test-passphrase";
const encoder = new TextEncoder();
const b64 = bytes => Buffer.from(bytes).toString("base64");
async function post(action, item) {
  const response = await fetch(`${base}/api/data`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ action, item }) });
  const data = await response.json();
  assert.equal(response.status, 200, data.error);
  return data;
}

const initial = await (await fetch(`${base}/api/data`)).json();
assert.ok(Array.isArray(initial.websites));
assert.ok(Array.isArray(initial.protectedRows));

if (!initial.vault) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const raw = argon2id(encoder.encode(password), salt, { t: 3, m: 65536, p: 1, dkLen: 32 });
  const key = await webcrypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  raw.fill(0);
  const seal = async value => {
    const nonce = webcrypto.getRandomValues(new Uint8Array(12));
    const payload = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, encoder.encode(JSON.stringify(value)));
    return { payload: b64(new Uint8Array(payload)), nonce: b64(nonce) };
  };
  const proof = await seal("HNOVA_PORTAL_VAULT_V1");
  await post("vault.create", { salt: b64(salt), verifierPayload: proof.payload, verifierNonce: proof.nonce });
  const id = crypto.randomUUID();
  const secret = await seal({ id, kind: "private", name: "QA secret name", url: "https://qa.example.test/private" });
  const state = await post("protected.bulk", { rows: [{ id, kind: "private", ...secret }] });
  assert.equal(state.protectedRows.length, 1);
  assert.ok(!JSON.stringify(state).includes("QA secret name"));
  assert.ok(!JSON.stringify(state).includes("qa.example.test"));
}

const rejected = await fetch(`${base}/api/data`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://other.example" }, body: JSON.stringify({ action: "website.delete", item: { id: "none" } }) });
assert.equal(rejected.status, 400);
console.log("Smoke checks passed: SQLite API, encrypted payload, origin rejection.");
