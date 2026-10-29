// docugoat relay on Cloudflare Workers. Same wire protocol as apps/relay: it stores only ciphertext,
// hands out Ed25519-signed receipts (time, IP, user agent, document hash) and keeps no plaintext log.
// Metadata lives in D1; ciphertext in R2 (envelope bodies can approach a megabyte).

export interface Env {
  DB: D1Database;
  BLOBS: R2Bucket;
  ALLOWED_ORIGINS: string;
  MAX_TTL_DAYS?: string;
}

const ID_RE = /^[a-z0-9]{20,32}$/;
const MAX_CIPHERTEXT = 8 * 1024 * 1024;
const te = new TextEncoder();

// ---------- helpers ----------
const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } });
const err = (status: number, error: string) => json({ error }, status);
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", te.encode(s)));
const rand = (n: number) => hex(crypto.getRandomValues(new Uint8Array(n)).buffer);
const isB64 = (s: unknown, max = MAX_CIPHERTEXT) => typeof s === "string" && s.length <= Math.ceil(max / 3) * 4 && /^[A-Za-z0-9+/]+=*$/.test(s);
const validKdf = (k: any) => k?.name === "PBKDF2" && k.hash === "SHA-256" && Number.isInteger(k.iterations) && k.iterations >= 100_000 && k.iterations <= 5_000_000 && isB64(k.salt, 64);
const validCipher = (c: any) => c?.name === "AES-GCM" && isB64(c.iv, 32);
const validWraps = (w: any) => Array.isArray(w) && w.length >= 1 && w.length <= 32 && w.every((x) => Number.isInteger(x?.slot) && x.slot >= 0 && isB64(x.iv, 32) && isB64(x.ciphertext, 128)) && new Set(w.map((x) => x.slot)).size === w.length;

function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
  if (!origin || !(allowed.includes(origin) || allowed.includes("*"))) return {};
  return { "access-control-allow-origin": origin, vary: "origin", "access-control-allow-methods": "GET,POST,DELETE,OPTIONS", "access-control-allow-headers": "content-type,x-owner-token", "access-control-max-age": "600" };
}

// ---------- attestation key (generated once, kept in D1) ----------
let keyCache: { priv: CryptoKey; pub: string; keyId: string } | null = null;
async function attestKey(env: Env) {
  if (keyCache) return keyCache;
  let row = await env.DB.prepare("SELECT pkcs8, pub FROM keys WHERE id = 'attest'").first<{ pkcs8: string; pub: string }>();
  if (!row) {
    const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const pkcs8 = b64((await crypto.subtle.exportKey("pkcs8", kp.privateKey)) as ArrayBuffer);
    const spki = new Uint8Array((await crypto.subtle.exportKey("spki", kp.publicKey)) as ArrayBuffer);
    const pub = b64(spki.subarray(spki.length - 32));
    await env.DB.prepare("INSERT OR IGNORE INTO keys (id, pkcs8, pub, created_at) VALUES ('attest', ?, ?, ?)").bind(pkcs8, pub, new Date().toISOString()).run();
    row = (await env.DB.prepare("SELECT pkcs8, pub FROM keys WHERE id = 'attest'").first<{ pkcs8: string; pub: string }>())!;
  }
  const priv = await crypto.subtle.importKey("pkcs8", unb64(row.pkcs8), { name: "Ed25519" }, false, ["sign"]);
  keyCache = { priv, pub: row.pub, keyId: hex(await crypto.subtle.digest("SHA-256", unb64(row.pub))).slice(0, 16) };
  return keyCache;
}

async function attest(req: Request, env: Env, envelopeId: string, action: "seal" | "view" | "sign", documentSha256: string | null, nonce: string) {
  const k = await attestKey(env);
  const receipt = JSON.stringify({
    v: 1, keyId: k.keyId, envelopeId, action, documentSha256, nonce,
    receivedAt: new Date().toISOString(),
    ip: req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
    userAgent: (req.headers.get("user-agent") ?? "").slice(0, 300),
  });
  const sig = b64(await crypto.subtle.sign({ name: "Ed25519" }, k.priv, te.encode(receipt)));
  return { receipt, sig, publicKey: k.pub, keyId: k.keyId };
}

// ---------- storage ----------
interface EnvRow { id: string; created_at: string; expires_at: string; kdf: string; wraps: string; cipher: string; owner_token_hash: string; burned_at: string | null }
const status = (e: EnvRow) => (e.burned_at ? "burned" : Date.now() > Date.parse(e.expires_at) ? "expired" : "active");
const getEnv = (env: Env, id: string) => (ID_RE.test(id) ? env.DB.prepare("SELECT * FROM envelopes WHERE id = ?").bind(id).first<EnvRow>() : Promise.resolve(null));
async function listBlobs(env: Env, id: string, kind: "signature" | "event") {
  const rows = (await env.DB.prepare("SELECT id, created_at, cipher FROM blobs WHERE envelope_id = ? AND kind = ? ORDER BY created_at, id").bind(id, kind).all<{ id: string; created_at: string; cipher: string }>()).results;
  const out = [];
  for (const r of rows) {
    const obj = await env.BLOBS.get(`${id}/${kind}/${r.id}`);
    if (obj) out.push({ id: r.id, createdAt: r.created_at, cipher: JSON.parse(r.cipher), ciphertext: await obj.text() });
  }
  return out;
}
const countBlobs = async (env: Env, id: string, kind: "signature" | "event") =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM blobs WHERE envelope_id = ? AND kind = ?").bind(id, kind).first<{ n: number }>())?.n ?? 0;

// ---------- routes ----------
async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  if (path === "/api/health") return json({ ok: true, relay: "docugoat", zeroKnowledge: true, worker: true });
  if (path === "/api/relay/key") { const k = await attestKey(env); return json({ alg: "Ed25519", keyId: k.keyId, publicKey: k.pub }); }

  const m = /^\/api\/envelopes(?:\/([a-z0-9]+))?(?:\/(attest|signatures|events|status))?$/.exec(path);
  if (!m) return err(404, "not found");
  const [, id, sub] = m;

  // seal
  if (!id && req.method === "POST") {
    const b: any = await req.json().catch(() => null);
    if (!b || !validKdf(b.kdf) || !validWraps(b.wraps) || !validCipher(b.cipher) || !isB64(b.ciphertext)) return err(400, "malformed envelope");
    if (typeof b.ownerToken !== "string" || b.ownerToken.length < 32) return err(400, "ownerToken required");
    const maxTtl = Number(env.MAX_TTL_DAYS ?? 90);
    const days = Math.min(maxTtl, Math.max(1, Number(b.ttlDays) || 30));
    const newId = rand(16).slice(0, 26);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + days * 86_400_000).toISOString();
    await env.BLOBS.put(`${newId}/envelope`, b.ciphertext);
    await env.DB.prepare("INSERT INTO envelopes (id, created_at, expires_at, kdf, wraps, cipher, owner_token_hash) VALUES (?,?,?,?,?,?,?)")
      .bind(newId, now.toISOString(), expiresAt, JSON.stringify(b.kdf), JSON.stringify(b.wraps), JSON.stringify(b.cipher), await sha256(b.ownerToken)).run();
    const sha = typeof b.documentSha256 === "string" && /^[a-f0-9]{64}$/.test(b.documentSha256) ? b.documentSha256 : null;
    return json({ id: newId, createdAt: now.toISOString(), expiresAt, commit: null, receipt: await attest(req, env, newId, "seal", sha, rand(8)) }, 201);
  }
  if (!id) return err(404, "not found");

  const e = await getEnv(env, id);
  if (!e) return err(404, "not found");
  const st = status(e);

  if (!sub && req.method === "GET") {
    if (st !== "active") return err(410, st);
    const obj = await env.BLOBS.get(`${id}/envelope`);
    if (!obj) return err(410, "burned");
    return json({ v: 2, id, createdAt: e.created_at, expiresAt: e.expires_at, kdf: JSON.parse(e.kdf), wraps: JSON.parse(e.wraps), cipher: JSON.parse(e.cipher), ciphertext: await obj.text(), signatureCount: await countBlobs(env, id, "signature") });
  }
  if (sub === "status" && req.method === "GET") return json({ id, status: st, expiresAt: e.expires_at, signatureCount: await countBlobs(env, id, "signature") });

  if (sub === "attest" && req.method === "POST") {
    if (st !== "active") return err(410, st);
    const b: any = await req.json().catch(() => null);
    if (!b || (b.action !== "view" && b.action !== "sign")) return err(400, "action must be view or sign");
    if (typeof b.nonce !== "string" || b.nonce.length < 8 || b.nonce.length > 64) return err(400, "nonce required");
    const sha = typeof b.documentSha256 === "string" && /^[a-f0-9]{64}$/.test(b.documentSha256) ? b.documentSha256 : null;
    return json(await attest(req, env, id, b.action, sha, b.nonce));
  }

  if ((sub === "signatures" || sub === "events") && req.method === "POST") {
    if (st !== "active") return err(410, st);
    const kind = sub === "signatures" ? "signature" : "event";
    const b: any = await req.json().catch(() => null);
    if (!b || !validCipher(b.cipher) || !isB64(b.ciphertext, kind === "signature" ? 2 * 1024 * 1024 : 64 * 1024)) return err(400, `malformed ${kind}`);
    if ((await countBlobs(env, id, kind)) >= (kind === "signature" ? 64 : 500)) return err(429, `${kind} log full`);
    const bid = rand(8), createdAt = new Date().toISOString();
    await env.BLOBS.put(`${id}/${kind}/${bid}`, b.ciphertext);
    await env.DB.prepare("INSERT INTO blobs (id, envelope_id, kind, created_at, cipher) VALUES (?,?,?,?,?)").bind(bid, id, kind, createdAt, JSON.stringify(b.cipher)).run();
    return json({ id: bid, createdAt, commit: null }, 201);
  }
  if (sub === "signatures" && req.method === "GET") return json({ signatures: await listBlobs(env, id, "signature") });
  if (sub === "events" && req.method === "GET") return json({ events: await listBlobs(env, id, "event") });

  if (!sub && req.method === "DELETE") {
    const given = await sha256(req.headers.get("x-owner-token") ?? "");
    if (given.length !== e.owner_token_hash.length || !timingSafeEqual(given, e.owner_token_hash)) return err(403, "forbidden");
    await burn(env, id);
    return json({ id, status: "burned" });
  }
  return err(405, "method not allowed");
}

function timingSafeEqual(a: string, b: string) { let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

async function burn(env: Env, id: string) {
  const keys = (await env.BLOBS.list({ prefix: `${id}/` })).objects.map((o) => o.key);
  if (keys.length) await env.BLOBS.delete(keys);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM blobs WHERE envelope_id = ?").bind(id),
    env.DB.prepare("UPDATE envelopes SET burned_at = ? WHERE id = ?").bind(new Date().toISOString(), id),
  ]);
}

async function sweep(env: Env) {
  const rows = (await env.DB.prepare("SELECT id FROM envelopes WHERE burned_at IS NULL AND expires_at < ?").bind(new Date().toISOString()).all<{ id: string }>()).results;
  for (const r of rows) await burn(env, r.id);
  return rows.length;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const headers = cors(req, env);
    try {
      const res = await handle(req, env);
      for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
      res.headers.set("referrer-policy", "no-referrer");
      res.headers.set("x-content-type-options", "nosniff");
      return res;
    } catch (e) {
      const res = err(500, (e as Error).message);
      for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
      return res;
    }
  },
  async scheduled(_c: ScheduledController, env: Env) { await sweep(env); },
};
