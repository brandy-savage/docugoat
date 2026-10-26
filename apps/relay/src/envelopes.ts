import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ENVELOPES_DIR, commit } from "./git.js";
import { attest } from "./attest.js";

export const envelopes = Router();

const ID_RE = /^[a-z0-9]{20,32}$/;
const MAX_TTL_DAYS = 90;
const MAX_CIPHERTEXT_BYTES = 8 * 1024 * 1024;

interface Kdf { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string }
interface Cipher { name: "AES-GCM"; iv: string }

interface KeyWrap { slot: number; iv: string; ciphertext: string }

interface StoredEnvelope {
  v: 2;
  id: string;
  createdAt: string;
  expiresAt: string;
  kdf: Kdf;
  wraps: KeyWrap[];
  cipher: Cipher;
  ciphertext: string;
  ownerTokenHash: string;
  burnedAt?: string;
}

interface StoredSignature {
  id: string;
  createdAt: string;
  cipher: Cipher;
  ciphertext: string;
}

const envDir = (id: string) => path.join(ENVELOPES_DIR, id);
const envFile = (id: string) => path.join(envDir(id), "envelope.json");
const sigDir = (id: string) => path.join(envDir(id), "signatures");
const evtDir = (id: string) => path.join(envDir(id), "events");

function readEvents(id: string): StoredSignature[] {
  if (!fs.existsSync(evtDir(id))) return [];
  return fs.readdirSync(evtDir(id)).filter((f) => f.endsWith(".json")).sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(evtDir(id), f), "utf8")));
}

function readEnvelope(id: string): StoredEnvelope | null {
  if (!ID_RE.test(id) || !fs.existsSync(envFile(id))) return null;
  return JSON.parse(fs.readFileSync(envFile(id), "utf8"));
}

function readSignatures(id: string): StoredSignature[] {
  if (!fs.existsSync(sigDir(id))) return [];
  return fs
    .readdirSync(sigDir(id))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(sigDir(id), f), "utf8")));
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const isB64 = (s: unknown, max = MAX_CIPHERTEXT_BYTES) =>
  typeof s === "string" && s.length <= Math.ceil(max / 3) * 4 && /^[A-Za-z0-9+/]+=*$/.test(s);

function validKdf(k: any): k is Kdf {
  return k?.name === "PBKDF2" && k.hash === "SHA-256" && Number.isInteger(k.iterations)
    && k.iterations >= 100_000 && k.iterations <= 5_000_000 && isB64(k.salt, 64);
}
function validCipher(c: any): c is Cipher {
  return c?.name === "AES-GCM" && isB64(c.iv, 32);
}
function validWraps(w: any): w is KeyWrap[] {
  return Array.isArray(w) && w.length >= 1 && w.length <= 32
    && w.every((x) => Number.isInteger(x?.slot) && x.slot >= 0 && isB64(x.iv, 32) && isB64(x.ciphertext, 128))
    && new Set(w.map((x) => x.slot)).size === w.length;
}

function status(env: StoredEnvelope) {
  if (env.burnedAt) return "burned";
  if (Date.now() > Date.parse(env.expiresAt)) return "expired";
  return "active";
}

// Seal: store an opaque ciphertext blob. The relay never sees a key or plaintext.
envelopes.post("/", async (req, res) => {
  const { kdf, wraps, cipher, ciphertext, ownerToken, ttlDays } = req.body ?? {};
  if (!validKdf(kdf) || !validWraps(wraps) || !validCipher(cipher) || !isB64(ciphertext)) {
    return res.status(400).json({ error: "malformed envelope" });
  }
  if (typeof ownerToken !== "string" || ownerToken.length < 32) {
    return res.status(400).json({ error: "ownerToken required" });
  }
  const days = Math.min(MAX_TTL_DAYS, Math.max(1, Number(ttlDays) || 30));
  const id = crypto.randomBytes(16).toString("hex").slice(0, 26);
  const now = new Date();
  const env: StoredEnvelope = {
    v: 2,
    id,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + days * 86_400_000).toISOString(),
    kdf,
    wraps,
    cipher,
    ciphertext,
    ownerTokenHash: sha256(ownerToken),
  };
  fs.mkdirSync(sigDir(id), { recursive: true });
  fs.mkdirSync(evtDir(id), { recursive: true });
  fs.writeFileSync(envFile(id), JSON.stringify(env));
  const commitHash = await commit(`seal ${id}`);
  const receipt = attest(req, id, "seal", typeof req.body.documentSha256 === "string" ? req.body.documentSha256.slice(0, 64) : null, crypto.randomBytes(8).toString("hex"));
  res.status(201).json({ id, createdAt: env.createdAt, expiresAt: env.expiresAt, commit: commitHash, receipt });
});

// Fetch: returns the blob plus what's needed to derive the key client-side.
envelopes.get("/:id", (req, res) => {
  const env = readEnvelope(req.params.id);
  if (!env) return res.status(404).json({ error: "not found" });
  const s = status(env);
  if (s !== "active") return res.status(410).json({ error: s });
  const { ownerTokenHash: _omit, ...pub } = env;
  res.json({ ...pub, signatureCount: readSignatures(env.id).length });
});

// Status only: no ciphertext, safe to poll.
envelopes.get("/:id/status", (req, res) => {
  const env = readEnvelope(req.params.id);
  if (!env) return res.status(404).json({ error: "not found" });
  res.json({ id: env.id, status: status(env), expiresAt: env.expiresAt, signatureCount: readSignatures(env.id).length });
});

// Append an encrypted signature bundle. Each one is its own commit.
envelopes.post("/:id/signatures", async (req, res) => {
  const env = readEnvelope(req.params.id);
  if (!env) return res.status(404).json({ error: "not found" });
  if (status(env) !== "active") return res.status(410).json({ error: status(env) });
  const { cipher, ciphertext } = req.body ?? {};
  if (!validCipher(cipher) || !isB64(ciphertext, 2 * 1024 * 1024)) {
    return res.status(400).json({ error: "malformed signature" });
  }
  const sig: StoredSignature = {
    id: crypto.randomBytes(8).toString("hex"),
    createdAt: new Date().toISOString(),
    cipher,
    ciphertext,
  };
  fs.writeFileSync(path.join(sigDir(env.id), `${Date.now()}-${sig.id}.json`), JSON.stringify(sig));
  const commitHash = await commit(`sign ${env.id} ${sig.id}`);
  res.status(201).json({ id: sig.id, createdAt: sig.createdAt, commit: commitHash });
});

envelopes.get("/:id/signatures", (req, res) => {
  const env = readEnvelope(req.params.id);
  if (!env) return res.status(404).json({ error: "not found" });
  res.json({ signatures: readSignatures(env.id) });
});

// Attest: sign a receipt for a view/sign action. Nothing is stored; the browser encrypts the receipt into its bundle.
envelopes.post("/:id/attest", (req, res) => {
  const env = readEnvelope(req.params.id);
  if (!env) return res.status(404).json({ error: "not found" });
  if (status(env) !== "active") return res.status(410).json({ error: status(env) });
  const { action, documentSha256, nonce } = req.body ?? {};
  if (action !== "view" && action !== "sign") return res.status(400).json({ error: "action must be view or sign" });
  if (typeof nonce !== "string" || nonce.length < 8 || nonce.length > 64) return res.status(400).json({ error: "nonce required" });
  const sha = typeof documentSha256 === "string" && /^[a-f0-9]{64}$/.test(documentSha256) ? documentSha256 : null;
  res.json(attest(req, env.id, action, sha, nonce));
});

// Events: encrypted audit blobs (e.g. "viewed"). Same shape as signatures, separate log.
envelopes.post("/:id/events", async (req, res) => {
  const env = readEnvelope(req.params.id);
  if (!env) return res.status(404).json({ error: "not found" });
  if (status(env) !== "active") return res.status(410).json({ error: status(env) });
  const { cipher, ciphertext } = req.body ?? {};
  if (!validCipher(cipher) || !isB64(ciphertext, 64 * 1024)) return res.status(400).json({ error: "malformed event" });
  if (readEvents(env.id).length >= 500) return res.status(429).json({ error: "event log full" });
  const evt: StoredSignature = { id: crypto.randomBytes(8).toString("hex"), createdAt: new Date().toISOString(), cipher, ciphertext };
  fs.mkdirSync(evtDir(env.id), { recursive: true });
  fs.writeFileSync(path.join(evtDir(env.id), `${Date.now()}-${evt.id}.json`), JSON.stringify(evt));
  const commitHash = await commit(`event ${env.id} ${evt.id}`);
  res.status(201).json({ id: evt.id, createdAt: evt.createdAt, commit: commitHash });
});

envelopes.get("/:id/events", (req, res) => {
  const env = readEnvelope(req.params.id);
  if (!env) return res.status(404).json({ error: "not found" });
  res.json({ events: readEvents(env.id) });
});

// Burn: owner-only. Ciphertext is removed from the working tree; without the code it was
// already unreadable, and this makes it unavailable to anyone holding the link.
envelopes.delete("/:id", async (req, res) => {
  const env = readEnvelope(req.params.id);
  if (!env) return res.status(404).json({ error: "not found" });
  const token = req.header("x-owner-token") ?? "";
  const given = Buffer.from(sha256(token));
  const want = Buffer.from(env.ownerTokenHash);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
    return res.status(403).json({ error: "forbidden" });
  }
  const tomb: StoredEnvelope = { ...env, ciphertext: "", burnedAt: new Date().toISOString() };
  fs.rmSync(sigDir(env.id), { recursive: true, force: true });
  fs.rmSync(evtDir(env.id), { recursive: true, force: true });
  fs.writeFileSync(envFile(env.id), JSON.stringify(tomb));
  await commit(`burn ${env.id}`);
  res.json({ id: env.id, status: "burned" });
});

// Sweep expired envelopes out of the working tree.
export async function sweepExpired() {
  if (!fs.existsSync(ENVELOPES_DIR)) return;
  let removed = 0;
  for (const id of fs.readdirSync(ENVELOPES_DIR)) {
    const env = readEnvelope(id);
    if (env && !env.burnedAt && status(env) === "expired") {
      fs.rmSync(envDir(id), { recursive: true, force: true });
      removed++;
    }
  }
  if (removed) await commit(`sweep ${removed} expired`);
}
