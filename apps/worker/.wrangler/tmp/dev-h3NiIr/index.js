var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-lFNxBo/strip-cf-connecting-ip-header.js
function stripCfConnectingIPHeader(input, init) {
  const request = new Request(input, init);
  request.headers.delete("CF-Connecting-IP");
  return request;
}
__name(stripCfConnectingIPHeader, "stripCfConnectingIPHeader");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    return Reflect.apply(target, thisArg, [
      stripCfConnectingIPHeader.apply(null, argArray)
    ]);
  }
});

// src/index.ts
var ID_RE = /^[a-z0-9]{20,32}$/;
var MAX_CIPHERTEXT = 8 * 1024 * 1024;
var te = new TextEncoder();
var json = /* @__PURE__ */ __name((data, status2 = 200, extra = {}) => new Response(JSON.stringify(data), { status: status2, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } }), "json");
var err = /* @__PURE__ */ __name((status2, error) => json({ error }, status2), "err");
var hex = /* @__PURE__ */ __name((b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""), "hex");
var b64 = /* @__PURE__ */ __name((b) => btoa(String.fromCharCode(...new Uint8Array(b))), "b64");
var unb64 = /* @__PURE__ */ __name((s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)), "unb64");
var sha256 = /* @__PURE__ */ __name(async (s) => hex(await crypto.subtle.digest("SHA-256", te.encode(s))), "sha256");
var rand = /* @__PURE__ */ __name((n) => hex(crypto.getRandomValues(new Uint8Array(n)).buffer), "rand");
var isB64 = /* @__PURE__ */ __name((s, max = MAX_CIPHERTEXT) => typeof s === "string" && s.length <= Math.ceil(max / 3) * 4 && /^[A-Za-z0-9+/]+=*$/.test(s), "isB64");
var validKdf = /* @__PURE__ */ __name((k) => k?.name === "PBKDF2" && k.hash === "SHA-256" && Number.isInteger(k.iterations) && k.iterations >= 1e5 && k.iterations <= 5e6 && isB64(k.salt, 64), "validKdf");
var validCipher = /* @__PURE__ */ __name((c) => c?.name === "AES-GCM" && isB64(c.iv, 32), "validCipher");
var validWraps = /* @__PURE__ */ __name((w) => Array.isArray(w) && w.length >= 1 && w.length <= 32 && w.every((x) => Number.isInteger(x?.slot) && x.slot >= 0 && isB64(x.iv, 32) && isB64(x.ciphertext, 128)) && new Set(w.map((x) => x.slot)).size === w.length, "validWraps");
function cors(req, env) {
  const origin = req.headers.get("origin") ?? "";
  const allowed = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
  if (!origin || !(allowed.includes(origin) || allowed.includes("*")))
    return {};
  return { "access-control-allow-origin": origin, vary: "origin", "access-control-allow-methods": "GET,POST,DELETE,OPTIONS", "access-control-allow-headers": "content-type,x-owner-token", "access-control-max-age": "600" };
}
__name(cors, "cors");
var keyCache = null;
async function attestKey(env) {
  if (keyCache)
    return keyCache;
  let row = await env.DB.prepare("SELECT pkcs8, pub FROM keys WHERE id = 'attest'").first();
  if (!row) {
    const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const pkcs8 = b64(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
    const spki = new Uint8Array(await crypto.subtle.exportKey("spki", kp.publicKey));
    const pub = b64(spki.subarray(spki.length - 32));
    await env.DB.prepare("INSERT OR IGNORE INTO keys (id, pkcs8, pub, created_at) VALUES ('attest', ?, ?, ?)").bind(pkcs8, pub, (/* @__PURE__ */ new Date()).toISOString()).run();
    row = await env.DB.prepare("SELECT pkcs8, pub FROM keys WHERE id = 'attest'").first();
  }
  const priv = await crypto.subtle.importKey("pkcs8", unb64(row.pkcs8), { name: "Ed25519" }, false, ["sign"]);
  keyCache = { priv, pub: row.pub, keyId: hex(await crypto.subtle.digest("SHA-256", unb64(row.pub))).slice(0, 16) };
  return keyCache;
}
__name(attestKey, "attestKey");
async function attest(req, env, envelopeId, action, documentSha256, nonce) {
  const k = await attestKey(env);
  const receipt = JSON.stringify({
    v: 1,
    keyId: k.keyId,
    envelopeId,
    action,
    documentSha256,
    nonce,
    receivedAt: (/* @__PURE__ */ new Date()).toISOString(),
    ip: req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
    userAgent: (req.headers.get("user-agent") ?? "").slice(0, 300)
  });
  const sig = b64(await crypto.subtle.sign({ name: "Ed25519" }, k.priv, te.encode(receipt)));
  return { receipt, sig, publicKey: k.pub, keyId: k.keyId };
}
__name(attest, "attest");
var status = /* @__PURE__ */ __name((e) => e.burned_at ? "burned" : Date.now() > Date.parse(e.expires_at) ? "expired" : "active", "status");
var getEnv = /* @__PURE__ */ __name((env, id) => ID_RE.test(id) ? env.DB.prepare("SELECT * FROM envelopes WHERE id = ?").bind(id).first() : Promise.resolve(null), "getEnv");
async function listBlobs(env, id, kind) {
  const rows = (await env.DB.prepare("SELECT id, created_at, cipher FROM blobs WHERE envelope_id = ? AND kind = ? ORDER BY created_at, id").bind(id, kind).all()).results;
  const out = [];
  for (const r of rows) {
    const obj = await env.BLOBS.get(`${id}/${kind}/${r.id}`);
    if (obj)
      out.push({ id: r.id, createdAt: r.created_at, cipher: JSON.parse(r.cipher), ciphertext: await obj.text() });
  }
  return out;
}
__name(listBlobs, "listBlobs");
var countBlobs = /* @__PURE__ */ __name(async (env, id, kind) => (await env.DB.prepare("SELECT COUNT(*) AS n FROM blobs WHERE envelope_id = ? AND kind = ?").bind(id, kind).first())?.n ?? 0, "countBlobs");
async function handle(req, env) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204 });
  if (path === "/api/health")
    return json({ ok: true, relay: "docugoat", zeroKnowledge: true, worker: true });
  if (path === "/api/relay/key") {
    const k = await attestKey(env);
    return json({ alg: "Ed25519", keyId: k.keyId, publicKey: k.pub });
  }
  const m = /^\/api\/envelopes(?:\/([a-z0-9]+))?(?:\/(attest|signatures|events|status))?$/.exec(path);
  if (!m)
    return err(404, "not found");
  const [, id, sub] = m;
  if (!id && req.method === "POST") {
    const b = await req.json().catch(() => null);
    if (!b || !validKdf(b.kdf) || !validWraps(b.wraps) || !validCipher(b.cipher) || !isB64(b.ciphertext))
      return err(400, "malformed envelope");
    if (typeof b.ownerToken !== "string" || b.ownerToken.length < 32)
      return err(400, "ownerToken required");
    const maxTtl = Number(env.MAX_TTL_DAYS ?? 90);
    const days = Math.min(maxTtl, Math.max(1, Number(b.ttlDays) || 30));
    const newId = rand(16).slice(0, 26);
    const now = /* @__PURE__ */ new Date();
    const expiresAt = new Date(now.getTime() + days * 864e5).toISOString();
    await env.BLOBS.put(`${newId}/envelope`, b.ciphertext);
    await env.DB.prepare("INSERT INTO envelopes (id, created_at, expires_at, kdf, wraps, cipher, owner_token_hash) VALUES (?,?,?,?,?,?,?)").bind(newId, now.toISOString(), expiresAt, JSON.stringify(b.kdf), JSON.stringify(b.wraps), JSON.stringify(b.cipher), await sha256(b.ownerToken)).run();
    const sha = typeof b.documentSha256 === "string" && /^[a-f0-9]{64}$/.test(b.documentSha256) ? b.documentSha256 : null;
    return json({ id: newId, createdAt: now.toISOString(), expiresAt, commit: null, receipt: await attest(req, env, newId, "seal", sha, rand(8)) }, 201);
  }
  if (!id)
    return err(404, "not found");
  const e = await getEnv(env, id);
  if (!e)
    return err(404, "not found");
  const st = status(e);
  if (!sub && req.method === "GET") {
    if (st !== "active")
      return err(410, st);
    const obj = await env.BLOBS.get(`${id}/envelope`);
    if (!obj)
      return err(410, "burned");
    return json({ v: 2, id, createdAt: e.created_at, expiresAt: e.expires_at, kdf: JSON.parse(e.kdf), wraps: JSON.parse(e.wraps), cipher: JSON.parse(e.cipher), ciphertext: await obj.text(), signatureCount: await countBlobs(env, id, "signature") });
  }
  if (sub === "status" && req.method === "GET")
    return json({ id, status: st, expiresAt: e.expires_at, signatureCount: await countBlobs(env, id, "signature") });
  if (sub === "attest" && req.method === "POST") {
    if (st !== "active")
      return err(410, st);
    const b = await req.json().catch(() => null);
    if (!b || b.action !== "view" && b.action !== "sign")
      return err(400, "action must be view or sign");
    if (typeof b.nonce !== "string" || b.nonce.length < 8 || b.nonce.length > 64)
      return err(400, "nonce required");
    const sha = typeof b.documentSha256 === "string" && /^[a-f0-9]{64}$/.test(b.documentSha256) ? b.documentSha256 : null;
    return json(await attest(req, env, id, b.action, sha, b.nonce));
  }
  if ((sub === "signatures" || sub === "events") && req.method === "POST") {
    if (st !== "active")
      return err(410, st);
    const kind = sub === "signatures" ? "signature" : "event";
    const b = await req.json().catch(() => null);
    if (!b || !validCipher(b.cipher) || !isB64(b.ciphertext, kind === "signature" ? 2 * 1024 * 1024 : 64 * 1024))
      return err(400, `malformed ${kind}`);
    if (await countBlobs(env, id, kind) >= (kind === "signature" ? 64 : 500))
      return err(429, `${kind} log full`);
    const bid = rand(8), createdAt = (/* @__PURE__ */ new Date()).toISOString();
    await env.BLOBS.put(`${id}/${kind}/${bid}`, b.ciphertext);
    await env.DB.prepare("INSERT INTO blobs (id, envelope_id, kind, created_at, cipher) VALUES (?,?,?,?,?)").bind(bid, id, kind, createdAt, JSON.stringify(b.cipher)).run();
    return json({ id: bid, createdAt, commit: null }, 201);
  }
  if (sub === "signatures" && req.method === "GET")
    return json({ signatures: await listBlobs(env, id, "signature") });
  if (sub === "events" && req.method === "GET")
    return json({ events: await listBlobs(env, id, "event") });
  if (!sub && req.method === "DELETE") {
    const given = await sha256(req.headers.get("x-owner-token") ?? "");
    if (given.length !== e.owner_token_hash.length || !timingSafeEqual(given, e.owner_token_hash))
      return err(403, "forbidden");
    await burn(env, id);
    return json({ id, status: "burned" });
  }
  return err(405, "method not allowed");
}
__name(handle, "handle");
function timingSafeEqual(a, b) {
  let r = 0;
  for (let i = 0; i < a.length; i++)
    r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
__name(timingSafeEqual, "timingSafeEqual");
async function burn(env, id) {
  const keys = (await env.BLOBS.list({ prefix: `${id}/` })).objects.map((o) => o.key);
  if (keys.length)
    await env.BLOBS.delete(keys);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM blobs WHERE envelope_id = ?").bind(id),
    env.DB.prepare("UPDATE envelopes SET burned_at = ? WHERE id = ?").bind((/* @__PURE__ */ new Date()).toISOString(), id)
  ]);
}
__name(burn, "burn");
async function sweep(env) {
  const rows = (await env.DB.prepare("SELECT id FROM envelopes WHERE burned_at IS NULL AND expires_at < ?").bind((/* @__PURE__ */ new Date()).toISOString()).all()).results;
  for (const r of rows)
    await burn(env, r.id);
  return rows.length;
}
__name(sweep, "sweep");
var src_default = {
  async fetch(req, env) {
    const headers = cors(req, env);
    try {
      const res = await handle(req, env);
      for (const [k, v] of Object.entries(headers))
        res.headers.set(k, v);
      res.headers.set("referrer-policy", "no-referrer");
      res.headers.set("x-content-type-options", "nosniff");
      return res;
    } catch (e) {
      const res = err(500, e.message);
      for (const [k, v] of Object.entries(headers))
        res.headers.set(k, v);
      return res;
    }
  },
  async scheduled(_c, env) {
    await sweep(env);
  }
};

// ../../node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-lFNxBo/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-lFNxBo/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof __Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
__name(__Facade_ScheduledController__, "__Facade_ScheduledController__");
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = (request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    };
    #dispatcher = (type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    };
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
