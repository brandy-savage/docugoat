// Owner account on the GitHub backend: create a vault (username + passphrase + repo token), sign in from a
// fresh device, confirm records merge both ways, reject a wrong passphrase, then delete the vault file.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k), clear: () => store.clear(), key: (i: number) => [...store.keys()][i] ?? null, get length() { return store.size; } };
(globalThis as any).sessionStorage = { ...(globalThis as any).localStorage };
const token = process.env.GH_TOKEN ?? execSync("gh auth token").toString().trim();
const cfg = { owner: process.env.GH_OWNER ?? "brandy-savage", repo: process.env.GH_DATA_REPO ?? "docugoat-data" };
const { accountPath, createAccount, saveAccount, signIn } = await import("../src/lib/account");
const { readFile, readFileEventually } = await import("../src/lib/github");
const { saveRecord, loadVault } = await import("../src/lib/vault");
const step = (s: string) => console.log("✓", s);
const username = `e2e-${Date.now().toString(36)}`, passphrase = "correct horse battery goat";

// device A: a sealed envelope already in the local vault, then create the account
saveRecord({ id: "a".repeat(26), title: "Device A envelope", fragmentSecret: "frag", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString(), role: "owner", code: "AAAA-AAAA-AAAA", slot: 0, issued: [], ownerToken: "tok" });
const a = await createAccount(cfg, username, passphrase, token);
assert.equal(a.vault.records.length, 1); assert.equal(a.cfg.token, token);
const stored = await readFileEventually({ ...cfg, token }, await accountPath(username));
assert.ok(stored && !stored.content.includes(token) && !stored.content.includes("Device A"), "vault file on GitHub is ciphertext only");
step(`created vault for ${username} at ${await accountPath(username)}; GitHub holds ciphertext only`);

await assert.rejects(createAccount(cfg, username, passphrase, token), /already has a vault/); step("creating the same username twice is refused");
await assert.rejects(signIn(cfg, username, "wrong passphrase"), /Wrong passphrase/); step("wrong passphrase is rejected (AES-GCM auth failure, nothing leaks)");
await assert.rejects(signIn(cfg, "nobody-" + username, passphrase), /No account/); step("unknown username is reported");

// device B: fresh storage, sign in, merge a device-B record back
store.clear();
const b = await signIn(cfg, username, passphrase);
assert.equal(b.vault.records[0]?.title, "Device A envelope"); assert.equal(b.cfg.token, token, "token recovered from the vault");
step("sign-in from a fresh device recovers the envelope record and the repo token");
for (const r of b.vault.records) saveRecord(r);
saveRecord({ id: "b".repeat(26), title: "Device B envelope", fragmentSecret: "frag2", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString(), role: "signer", code: "BBBB-BBBB-BBBB", slot: 1, signerName: "Me" });
const b2 = await saveAccount(b, loadVault());
assert.equal(b2.vault.records.length, 2); step("device B pushes the merged vault (2 records)");

// device A again: sees both
store.clear();
const a2 = await signIn(cfg, username, passphrase);
assert.deepEqual(a2.vault.records.map((r) => r.title).sort(), ["Device A envelope", "Device B envelope"]); step("device A signs in and sees both devices' records");

// explicit removal survives a merge; an unrelated concurrent record does not get clobbered
for (const r of a2.vault.records) saveRecord(r);
const a3 = await saveAccount(a2, loadVault().filter((r) => r.id !== "a".repeat(26)), ["a".repeat(26)]);
assert.deepEqual(a3.vault.records.map((r) => r.title), ["Device B envelope"]); step("forgetting a record on device A removes it (explicit removal, not an overwrite)");

// cleanup: delete the vault file
const f = await readFileEventually({ ...cfg, token }, a2.path);
const res = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${a2.path}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }, body: JSON.stringify({ message: "e2e cleanup", sha: f!.sha }) });
assert.equal(res.status, 200); step("test vault deleted from the data repo");
console.log("\nACCOUNT E2E PASSED");
