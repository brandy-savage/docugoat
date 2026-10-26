// End-to-end check of the v2 zero-knowledge flow (per-recipient key wraps) using the production crypto module against a live relay.
import assert from "node:assert/strict";
import {
  KDF_ITERATIONS, decryptJson, deriveKey, ecdsaSign, ecdsaVerify, encryptJson, fromB64, generateCode, generateContentKey,
  generateFragmentSecret, generateOwnerToken, normalizeCode, randomBytes, sha256Hex, signingMessage, toB64, toHex, unwrapContentKey, verifyReceipt, wrapContentKey,
} from "../src/lib/crypto";

const RELAY = process.env.RELAY ?? "http://localhost:4173";
const j = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => ({})) });
const post = (u: string, b: unknown, h: Record<string, string> = {}) =>
  fetch(RELAY + u, { method: "POST", headers: { "Content-Type": "application/json", ...h }, body: JSON.stringify(b) }).then(j);
const get = (u: string) => fetch(RELAY + u).then(j);
const step = (s: string) => console.log("✓", s);

const recipients = [{ slot: 0, name: "Ada", role: "owner" }, { slot: 1, name: "Bob", role: "signer" }, { slot: 2, name: "Cy", role: "signer" }];
const doc = { v: 2, title: "E2E NDA", markdown: "# E2E NDA\n\nSecret **terms**.\n\n[[sign: Bob]]\n", createdAt: new Date().toISOString(), author: "Ada", recipients };
const fragment = generateFragmentSecret(), ownerToken = generateOwnerToken(), salt = randomBytes(16);
const codes = recipients.map(() => generateCode());
assert.equal(normalizeCode(codes[0].toLowerCase().replace(/-/g, " ")), normalizeCode(codes[0])); step("codes normalize leniently");

const contentKey = await generateContentKey();
const wraps = [];
for (const [i, r] of recipients.entries()) wraps.push({ slot: r.slot, ...(await wrapContentKey(contentKey, await deriveKey(codes[i], fragment, salt))) });
const sealed = await encryptJson(contentKey, doc);
const docSha = await sha256Hex(doc.markdown);
const seal = await post("/api/envelopes", { kdf: { name: "PBKDF2", hash: "SHA-256", iterations: KDF_ITERATIONS, salt: toB64(salt) }, wraps, cipher: { name: "AES-GCM", iv: sealed.iv }, ciphertext: sealed.ciphertext, ownerToken, ttlDays: 7, documentSha256: docSha });
assert.equal(seal.status, 201, JSON.stringify(seal.body)); const id = seal.body.id as string;
step(`sealed ${id} with ${wraps.length} per-recipient wraps`);

const relayKey = (await get("/api/relay/key")).body;
assert.equal(relayKey.alg, "Ed25519");
const sealRc = seal.body.receipt;
assert.equal(await verifyReceipt(sealRc.receipt, sealRc.sig, sealRc.publicKey, relayKey.publicKey), true);
const sealBody = JSON.parse(sealRc.receipt);
assert.equal(sealBody.action, "seal"); assert.equal(sealBody.documentSha256, docSha); assert.ok(sealBody.ip); step(`seal receipt attested by relay key ${relayKey.keyId} (ip ${sealBody.ip})`);
assert.equal(await verifyReceipt(sealRc.receipt.replace(sealBody.ip, "1.2.3.4"), sealRc.sig, sealRc.publicKey), false); step("edited receipt -> attestation fails");
assert.equal((await post(`/api/envelopes/${id}/attest`, { action: "burn", nonce: "0123456789ab" })).status, 400); step("attest rejects unknown action");

assert.equal((await post("/api/envelopes", { kdf: { name: "PBKDF2", hash: "SHA-256", iterations: KDF_ITERATIONS, salt: toB64(salt) }, wraps: [], cipher: { name: "AES-GCM", iv: sealed.iv }, ciphertext: sealed.ciphertext, ownerToken })).status, 400); step("relay rejects envelope without wraps");
assert.equal((await post("/api/envelopes", { kdf: { name: "PBKDF2", hash: "SHA-256", iterations: KDF_ITERATIONS, salt: toB64(salt) }, wraps: [wraps[0], wraps[0]], cipher: { name: "AES-GCM", iv: sealed.iv }, ciphertext: sealed.ciphertext, ownerToken })).status, 400); step("relay rejects duplicate slots");

const env = (await get(`/api/envelopes/${id}`)).body;
assert.equal(env.ownerTokenHash, undefined); assert.equal(env.wraps.length, 3);
assert.ok(!JSON.stringify(env).match(/Secret|Ada|Bob|Cy/)); step("stored blob has no plaintext, no names");

async function open(code: string) {
  const rk = await deriveKey(code, fragment, fromB64(env.kdf.salt), env.kdf.iterations);
  for (const w of env.wraps) { const k = await unwrapContentKey(w, rk); if (k) return { key: k, slot: w.slot }; }
  return null;
}
assert.equal(await open(generateCode()), null); step("random code opens nothing");
const bob = await open(codes[1]); assert.ok(bob && bob.slot === 1); step("Bob's code unwraps slot 1 only");
const cy = await open(codes[2]); assert.ok(cy && cy.slot === 2); step("Cy's code unwraps slot 2 only");
const ada = await open(codes[0]); assert.ok(ada && ada.slot === 0); step("owner code unwraps slot 0");
const rkNoFrag = await deriveKey(codes[1], "", fromB64(env.kdf.salt), env.kdf.iterations);
assert.equal(await unwrapContentKey(env.wraps[1], rkNoFrag), null); step("right code without link secret -> nothing");

const opened = await decryptJson<typeof doc>(bob!.key, { iv: env.cipher.iv, ciphertext: env.ciphertext });
assert.deepEqual(opened, doc); step("Bob decrypts the identical document");

const hash = await sha256Hex(opened.markdown);
const signedAt = new Date().toISOString();
const ecdsa = await ecdsaSign(signingMessage(hash, "Bob", signedAt));
const viewRc = (await post(`/api/envelopes/${id}/attest`, { action: "view", documentSha256: hash, nonce: toHex(randomBytes(8)) })).body;
const viewEvt = await encryptJson(bob!.key, { v: 1, kind: "viewed", slot: 1, name: "Bob", at: new Date().toISOString(), receipt: viewRc });
assert.equal((await post(`/api/envelopes/${id}/events`, { cipher: { name: "AES-GCM", iv: viewEvt.iv }, ciphertext: viewEvt.ciphertext })).status, 201); step("Bob's encrypted 'viewed' event relayed");
const signRc = (await post(`/api/envelopes/${id}/attest`, { action: "sign", documentSha256: hash, nonce: toHex(randomBytes(8)) })).body;
const sigSealed = await encryptJson(bob!.key, { v: 2, slot: bob!.slot, signerName: "Bob", signedAt, documentSha256: hash, signatureImage: "data:image/png;base64,iVBORw0KGgo=", ecdsa, userAgent: "e2e", receipt: signRc });
const sig = await post(`/api/envelopes/${id}/signatures`, { cipher: { name: "AES-GCM", iv: sigSealed.iv }, ciphertext: sigSealed.ciphertext });
assert.equal(sig.status, 201); step("Bob's signature relayed as ciphertext");

const list = (await get(`/api/envelopes/${id}/signatures`)).body.signatures; assert.equal(list.length, 1);
const got = await decryptJson<any>(ada!.key, { iv: list[0].cipher.iv, ciphertext: list[0].ciphertext });
assert.equal(got.slot, 1); assert.equal(got.signerName, "Bob"); assert.equal(recipients.find((r) => r.slot === got.slot)!.name, got.signerName);
assert.equal(await ecdsaVerify(signingMessage(got.documentSha256, got.signerName, got.signedAt), got.ecdsa), true); step("owner decrypts; slot 1 == Bob; ECDSA verifies");
assert.equal(await ecdsaVerify(signingMessage(got.documentSha256, "Mallory", got.signedAt), got.ecdsa), false); step("renamed signer -> ECDSA fails");
assert.equal(await verifyReceipt(got.receipt.receipt, got.receipt.sig, got.receipt.publicKey, relayKey.publicKey), true);
const rb = JSON.parse(got.receipt.receipt); assert.equal(rb.action, "sign"); assert.equal(rb.documentSha256, hash); assert.equal(rb.envelopeId, id); step(`sign receipt inside ciphertext verifies (ip ${rb.ip}, ${rb.receivedAt})`);
const evts = (await get(`/api/envelopes/${id}/events`)).body.events; assert.equal(evts.length, 1);
assert.ok(!JSON.stringify(evts).match(/Bob|viewed|\d+\.\d+\.\d+\.\d+/)); step("event log on relay holds no name, kind, or IP in the clear");
const ev = await decryptJson<any>(ada!.key, { iv: evts[0].cipher.iv, ciphertext: evts[0].ciphertext });
assert.equal(ev.kind, "viewed"); assert.equal(JSON.parse(ev.receipt.receipt).action, "view"); step("owner decrypts the viewed event with its receipt");
const grep = (await import("node:child_process")).execSync(`grep -rl "${rb.ip}" ../server/data/relay/envelopes/${id} || true`).toString().trim();
assert.equal(grep, ""); step("relay store contains no plaintext IP");

const tampered = fromB64(env.ciphertext); tampered[5] ^= 0xff;
await assert.rejects(decryptJson(ada!.key, { iv: env.cipher.iv, ciphertext: toB64(tampered) })); step("tampered ciphertext -> GCM rejects");

assert.equal((await fetch(`${RELAY}/api/envelopes/${id}`, { method: "DELETE", headers: { "x-owner-token": "nope" } })).status, 403); step("burn with wrong token -> 403");
assert.equal((await fetch(`${RELAY}/api/envelopes/${id}`, { method: "DELETE", headers: { "x-owner-token": ownerToken } })).status, 200);
assert.equal((await get(`/api/envelopes/${id}`)).status, 410); step("burn with owner token -> 410 afterwards");
console.log("\nALL PASSED");
