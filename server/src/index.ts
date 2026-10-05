import express from "express";
import path from "node:path";
import fs from "node:fs";
import { getRepo } from "./git.js";
import { envelopes, sweepExpired } from "./envelopes.js";
import { initAttestKey, relayPublicKey } from "./attest.js";

const PORT = Number(process.env.PORT ?? 4173);
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.json({ limit: "12mb" }));

// Static hosting (e.g. GitHub Pages) calls the relay cross-origin. Allow only the origins the operator lists.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (allowedOrigins.includes(origin) || allowedOrigins.includes("*"))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Owner-Token");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Minimal per-IP write throttle so the relay can't be trivially filled.
const buckets = new Map<string, { n: number; t: number }>();
app.use("/api", (req, res, next) => {
  if (req.method === "GET") return next();
  const key = req.ip ?? "?";
  const now = Date.now();
  const b = buckets.get(key) ?? { n: 0, t: now };
  if (now - b.t > 60_000) { b.n = 0; b.t = now; }
  if (++b.n > 60) return res.status(429).json({ error: "slow down" });
  buckets.set(key, b);
  next();
});

app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

app.use("/api/envelopes", envelopes);
app.get("/api/relay/key", (_req, res) => res.json(relayPublicKey()));
app.get("/api/health", (_req, res) => res.json({ ok: true, relay: "docugoat", zeroKnowledge: true }));

const webDist = path.resolve(process.cwd(), "..", "web", "dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get("*", (_req, res) => res.sendFile(path.join(webDist, "index.html")));
}

await getRepo();
initAttestKey();
await sweepExpired();
setInterval(() => sweepExpired().catch(console.error), 60 * 60 * 1000).unref();

app.listen(PORT, () => console.log(`docugoat relay on http://localhost:${PORT}`));
