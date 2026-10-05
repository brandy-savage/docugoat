// The relay attests the moment an action reached it (time, IP, user agent, document hash) with an Ed25519
// signature and hands the receipt back to the browser. The browser encrypts it into the signature bundle.
// The relay itself keeps no record of it: the evidence lives only inside ciphertext the owner can open.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Request } from "express";
import { DATA_DIR } from "./git.js";

const KEY_FILE = path.join(DATA_DIR, "..", "relay-ed25519.json");

let priv: crypto.KeyObject;
let pubRawB64: string;
let keyId: string;

export function initAttestKey() {
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  if (!fs.existsSync(KEY_FILE)) {
    const { privateKey } = crypto.generateKeyPairSync("ed25519");
    fs.writeFileSync(KEY_FILE, JSON.stringify({ privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) }), { mode: 0o600 });
  }
  priv = crypto.createPrivateKey(JSON.parse(fs.readFileSync(KEY_FILE, "utf8")).privateKeyPem);
  const spki = crypto.createPublicKey(priv).export({ type: "spki", format: "der" }) as Buffer;
  const raw = spki.subarray(spki.length - 32);
  pubRawB64 = raw.toString("base64");
  keyId = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

export function relayPublicKey() {
  return { alg: "Ed25519", keyId, publicKey: pubRawB64 };
}

export interface Receipt {
  v: 1;
  keyId: string;
  envelopeId: string;
  action: "seal" | "view" | "sign";
  documentSha256: string | null;
  nonce: string;
  receivedAt: string;
  ip: string;
  userAgent: string;
}

export function clientIp(req: Request): string {
  const xf = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  return (xf || req.socket.remoteAddress || "unknown").replace(/^::ffff:/, "");
}

/** Returns the canonical JSON string and its signature. Verifiers check the exact string bytes. */
export function attest(req: Request, envelopeId: string, action: Receipt["action"], documentSha256: string | null, nonce: string) {
  const receipt: Receipt = {
    v: 1, keyId, envelopeId, action, documentSha256, nonce,
    receivedAt: new Date().toISOString(),
    ip: clientIp(req),
    userAgent: String(req.headers["user-agent"] ?? "").slice(0, 300),
  };
  const canonical = JSON.stringify(receipt);
  const sig = crypto.sign(null, Buffer.from(canonical, "utf8"), priv).toString("base64");
  return { receipt: canonical, sig, publicKey: pubRawB64, keyId };
}
