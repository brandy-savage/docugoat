// End-to-end check of the serverless GitHub backend against the real data repo, using the production transport + crypto.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { githubTransport } from "../src/lib/transport";
import { KDF_ITERATIONS, decryptJson, deriveKey, ecdsaSign, encryptJson, fromB64, generateCode, generateContentKey, generateFragmentSecret, generateOwnerToken, randomBytes, sha256Hex, signingMessage, toB64, unwrapContentKey, wrapContentKey } from "../src/lib/crypto";

const token = process.env.GH_TOKEN ?? execSync("gh auth token").toString().trim();
const owner = process.env.GH_OWNER ?? "brandy-savage", repo = process.env.GH_DATA_REPO ?? "docugoat-data";
const t = githubTransport({ owner, repo, token });
const anon = githubTransport({ owner, repo });  // no token at all: may only be used to prove writes are refused
const pub = t;                                   // signers read with the link token (authenticated: 5000 req/h, not 60)
const step = (s: string) => console.log("✓", s);

const recipients = [{ slot: 0, name: "Ada", role: "owner" as const, signs: true }, { slot: 1, name: "Bob", role: "signer" as const }];
const doc = { v: 2 as const, title: "GH E2E", markdown: "# GH E2E\n\nSecret **terms**.\n\n[[sign: Bob]]\n", createdAt: new Date().toISOString(), author: "Ada", recipients };
const fragment = generateFragmentSecret(), ownerToken = generateOwnerToken(), salt = randomBytes(16), codes = recipients.map(() => generateCode());
const contentKey = await generateContentKey();
const wraps = [];
for (const [i, r] of recipients.entries()) wraps.push({ slot: r.slot, ...(await wrapContentKey(contentKey, await deriveKey(codes[i], fragment, salt))) });
const sealed = await encryptJson(contentKey, doc);
const docSha = await sha256Hex(doc.markdown);

const res = await t.seal({ kdf: { name: "PBKDF2", hash: "SHA-256", iterations: KDF_ITERATIONS, salt: toB64(salt) }, wraps, cipher: { name: "AES-GCM", iv: sealed.iv }, ciphertext: sealed.ciphertext, ownerToken, ttlDays: 7, documentSha256: docSha });
assert.ok(res.id && res.commit); step(`sealed ${res.id} as commit ${res.commit!.slice(0, 7)} in ${owner}/${repo}`);

const env = await pub.fetch(res.id);
assert.equal(env.wraps.length, 2); assert.equal((env as any).ownerTokenHash, undefined);
assert.ok(!JSON.stringify(env).match(/Secret|Ada|Bob/)); step("public read returns ciphertext only, no names, no owner hash");

const rk = await deriveKey(codes[1], fragment, fromB64(env.kdf.salt), env.kdf.iterations);
let key: CryptoKey | null = null; for (const w of env.wraps) { key = await unwrapContentKey(w, rk); if (key) { assert.equal(w.slot, 1); break; } }
assert.ok(key); const opened = await decryptJson<typeof doc>(key!, { iv: env.cipher.iv, ciphertext: env.ciphertext }); assert.deepEqual(opened, doc); step("Bob's code opens slot 1 and decrypts the document");

const viewEvt = await encryptJson(key!, { v: 1, kind: "viewed", slot: 1, name: "Bob", at: new Date().toISOString() });
const ev = await t.postEvent(res.id, { cipher: { name: "AES-GCM", iv: viewEvt.iv }, ciphertext: viewEvt.ciphertext }); step(`viewed event committed ${ev.commit!.slice(0, 7)}`);

const signedAt = new Date().toISOString();
const ecdsa = await ecdsaSign(signingMessage(docSha, "Bob", signedAt));
const sigSealed = await encryptJson(key!, { v: 2, slot: 1, signerName: "Bob", signedAt, documentSha256: docSha, signatureImage: "data:image/png;base64,iVBORw0KGgo=", ecdsa, userAgent: "e2e" });
const sg = await t.sign(res.id, { cipher: { name: "AES-GCM", iv: sigSealed.iv }, ciphertext: sigSealed.ciphertext }); step(`signature committed ${sg.commit!.slice(0, 7)}`);

await assert.rejects(anon.sign(res.id, { cipher: { name: "AES-GCM", iv: sigSealed.iv }, ciphertext: sigSealed.ciphertext }), /token is required/); step("write without a token is refused client-side");

const sigs = await pub.signatures(res.id); assert.equal(sigs.length, 1);
const got = await decryptJson<any>(key!, { iv: sigs[0].cipher.iv, ciphertext: sigs[0].ciphertext }); assert.equal(got.signerName, "Bob"); step("owner reads back and decrypts the signature");
const st = await pub.status(res.id); assert.equal(st.status, "active"); assert.equal(st.signatureCount, 1);

const times = await pub.commitTimes!(res.id);
assert.ok(times.envelope?.date && times[sg.id]?.date && times[ev.id]?.date); step(`GitHub-recorded times: sealed ${times.envelope.date}, signed ${times[sg.id].date}`);

await t.burn(res.id, ownerToken);
await assert.rejects(pub.fetch(res.id), /burned/); step("burned → fetch refuses");
console.log("\nALL PASSED");
