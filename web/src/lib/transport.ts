// Where envelopes live. "relay" = the Express relay (attested receipts, IPs). "github" = the browser talks to a
// GitHub data repo directly through the Contents API: no server at all, GitHub-recorded commit times as evidence.
import { relay } from "./api";
import { commitsFor, listDir, readFile, writeFile, type GhConfig } from "./github";
import type { AttestedReceipt, RelayEnvelope, RelaySignature } from "./types";

export type Backend = "relay" | "github";

export interface SealBody extends Pick<RelayEnvelope, "kdf" | "wraps" | "cipher" | "ciphertext"> { ownerToken: string; ttlDays: number; documentSha256: string }
export interface Blob { cipher: RelayEnvelope["cipher"]; ciphertext: string }
export interface Stored { id: string; createdAt: string; commit?: string; receipt?: AttestedReceipt }
export interface StatusInfo { status: "active" | "expired" | "burned"; expiresAt: string; signatureCount: number }

export interface Transport {
  backend: Backend;
  seal(body: SealBody): Promise<Stored & { expiresAt: string }>;
  fetch(id: string): Promise<RelayEnvelope>;
  status(id: string): Promise<StatusInfo>;
  sign(id: string, blob: Blob): Promise<Stored>;
  signatures(id: string): Promise<RelaySignature[]>;
  postEvent(id: string, blob: Blob): Promise<Stored>;
  events(id: string): Promise<RelaySignature[]>;
  attest?(id: string, action: "view" | "sign", sha: string, nonce: string): Promise<AttestedReceipt>;
  burn(id: string, ownerToken: string): Promise<void>;
  /** Timestamps GitHub recorded for each stored object, keyed by relay/object id. */
  commitTimes?(id: string): Promise<Record<string, { date: string; sha: string; verified: boolean }>>;
}

export const relayTransport: Transport = {
  backend: "relay",
  seal: (b) => relay.seal(b),
  fetch: (id) => relay.fetch(id),
  status: (id) => relay.status(id),
  sign: (id, blob) => relay.sign(id, blob),
  signatures: (id) => relay.signatures(id).then((r) => r.signatures),
  postEvent: (id, blob) => relay.postEvent(id, blob),
  events: (id) => relay.events(id).then((r) => r.events),
  attest: (id, action, sha, nonce) => relay.attest(id, action, sha, nonce),
  burn: async (id, token) => { await relay.burn(id, token); },
};

const rand = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
const envPath = (id: string) => `envelopes/${id}/envelope.json`;

export function githubTransport(cfg: GhConfig): Transport {
  async function readAll(dir: string): Promise<RelaySignature[]> {
    const files = (await listDir(cfg, dir)).filter((f) => f.name.endsWith(".json")).sort((a, b) => a.name.localeCompare(b.name));
    const out: RelaySignature[] = [];
    for (const f of files) {
      const file = await readFile(cfg, f.path);
      if (file) { try { out.push(JSON.parse(file.content)); } catch { /* skip */ } }
    }
    return out;
  }
  async function readEnvelope(id: string) {
    if (!/^[a-z0-9]{20,32}$/.test(id)) throw new Error("not found");
    const f = await readFile(cfg, envPath(id));
    if (!f) throw new Error("not found");
    return JSON.parse(f.content) as RelayEnvelope & { burnedAt?: string; ownerTokenHash?: string };
  }
  const statusOf = (e: { burnedAt?: string; expiresAt: string }) => e.burnedAt ? "burned" : Date.now() > Date.parse(e.expiresAt) ? "expired" : "active";

  return {
    backend: "github",
    async seal(b) {
      const id = rand(13);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + Math.min(90, Math.max(1, b.ttlDays)) * 86_400_000).toISOString();
      const ownerTokenHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(b.ownerToken)))].map((x) => x.toString(16).padStart(2, "0")).join("");
      const env = { v: 2, id, createdAt: now.toISOString(), expiresAt, kdf: b.kdf, wraps: b.wraps, cipher: b.cipher, ciphertext: b.ciphertext, ownerTokenHash };
      const c = await writeFile(cfg, envPath(id), JSON.stringify(env), `seal ${id}`);
      return { id, createdAt: env.createdAt, expiresAt, commit: c.sha };
    },
    async fetch(id) {
      const e = await readEnvelope(id);
      const s = statusOf(e);
      if (s !== "active") throw Object.assign(new Error(s), { status: 410 });
      const { ownerTokenHash: _o, burnedAt: _b, ...pub } = e;
      const sigs = await listDir(cfg, `envelopes/${id}/signatures`);
      return { ...pub, signatureCount: sigs.length } as RelayEnvelope;
    },
    async status(id) {
      const e = await readEnvelope(id);
      return { status: statusOf(e), expiresAt: e.expiresAt, signatureCount: (await listDir(cfg, `envelopes/${id}/signatures`)).length };
    },
    async sign(id, blob) {
      const sid = rand(8), createdAt = new Date().toISOString();
      const c = await writeFile(cfg, `envelopes/${id}/signatures/${Date.now()}-${sid}.json`, JSON.stringify({ id: sid, createdAt, ...blob }), `sign ${id} ${sid}`);
      return { id: sid, createdAt: c.date, commit: c.sha };
    },
    signatures: (id) => readAll(`envelopes/${id}/signatures`),
    async postEvent(id, blob) {
      const eid = rand(8), createdAt = new Date().toISOString();
      const c = await writeFile(cfg, `envelopes/${id}/events/${Date.now()}-${eid}.json`, JSON.stringify({ id: eid, createdAt, ...blob }), `event ${id} ${eid}`);
      return { id: eid, createdAt: c.date, commit: c.sha };
    },
    events: (id) => readAll(`envelopes/${id}/events`),
    async burn(id) {
      const f = await readFile(cfg, envPath(id));
      if (!f) return;
      const e = JSON.parse(f.content);
      await writeFile(cfg, envPath(id), JSON.stringify({ ...e, ciphertext: "", wraps: [], burnedAt: new Date().toISOString() }), `burn ${id}`, f.sha);
    },
    async commitTimes(id) {
      const out: Record<string, { date: string; sha: string; verified: boolean }> = {};
      const [env] = await commitsFor(cfg, envPath(id));
      if (env) out.envelope = env;
      for (const dir of ["signatures", "events"]) {
        for (const f of await listDir(cfg, `envelopes/${id}/${dir}`)) {
          const m = /-([a-f0-9]{16})\.json$/.exec(f.name);
          const [c] = await commitsFor(cfg, f.path);
          if (m && c) out[m[1]] = c;
        }
      }
      return out;
    },
  };
}
