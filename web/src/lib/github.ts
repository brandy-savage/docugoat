// Minimal GitHub Contents API client. Reads of a public repo need no token; writes need a
// fine-grained token with "Contents: read & write" on the data repo only.
const API = "https://api.github.com";

export interface GhConfig { owner: string; repo: string; token?: string; branch?: string }

export class GhError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const te = new TextEncoder(), td = new TextDecoder();
export function utf8ToB64(s: string): string {
  const bytes = te.encode(s); let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
export function b64ToUtf8(b64: string): string {
  return td.decode(Uint8Array.from(atob(b64.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
}

function headers(cfg: GhConfig, write = false): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (cfg.token && (write || cfg.token)) h.Authorization = `Bearer ${cfg.token}`;
  return h;
}

async function gh<T>(cfg: GhConfig, path: string, init: RequestInit = {}, write = false): Promise<T> {
  const res = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}${path}`, { ...init, headers: { ...headers(cfg, write), ...(init.headers ?? {}) } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new GhError(res.status, (body as any).message ?? `GitHub ${res.status}`);
  }
  return res.json();
}

export interface GhFile { path: string; sha: string; content: string }

export async function readFile(cfg: GhConfig, path: string): Promise<GhFile | null> {
  try {
    const r = await gh<{ sha: string; content: string }>(cfg, `/contents/${encodePath(path)}${cfg.branch ? `?ref=${cfg.branch}` : ""}`, { cache: "no-store" });
    return { path, sha: r.sha, content: b64ToUtf8(r.content) };
  } catch (e) {
    if (e instanceof GhError && e.status === 404) return null;
    throw e;
  }
}

export async function listDir(cfg: GhConfig, path: string): Promise<{ name: string; path: string; sha: string }[]> {
  try {
    const r = await gh<any[]>(cfg, `/contents/${encodePath(path)}${cfg.branch ? `?ref=${cfg.branch}` : ""}`, { cache: "no-store" });
    return Array.isArray(r) ? r.filter((x) => x.type === "file").map((x) => ({ name: x.name, path: x.path, sha: x.sha })) : [];
  } catch (e) {
    if (e instanceof GhError && e.status === 404) return [];
    throw e;
  }
}

export interface GhCommitInfo { sha: string; date: string; verified: boolean }

/** Create (or, with sha, update) a file. Returns the commit GitHub recorded for it. */
export async function writeFile(cfg: GhConfig, path: string, content: string, message: string, sha?: string): Promise<GhCommitInfo> {
  if (!cfg.token) throw new GhError(401, "A write token is required");
  const r = await gh<{ commit: { sha: string; committer: { date: string }; verification?: { verified: boolean } } }>(
    cfg, `/contents/${encodePath(path)}`,
    { method: "PUT", body: JSON.stringify({ message, content: utf8ToB64(content), ...(sha ? { sha } : {}), ...(cfg.branch ? { branch: cfg.branch } : {}) }) },
    true,
  );
  return { sha: r.commit.sha, date: r.commit.committer.date, verified: !!r.commit.verification?.verified };
}

/** Commits that touched a path, oldest first. GitHub records committer dates server-side for API writes. */
export async function commitsFor(cfg: GhConfig, path: string): Promise<GhCommitInfo[]> {
  const r = await gh<any[]>(cfg, `/commits?path=${encodeURIComponent(path)}&per_page=100${cfg.branch ? `&sha=${cfg.branch}` : ""}`, { cache: "no-store" });
  return r.map((c) => ({ sha: c.sha, date: c.commit.committer.date, verified: !!c.commit.verification?.verified })).reverse();
}

export async function tokenCanWrite(cfg: GhConfig): Promise<boolean> {
  if (!cfg.token) return false;
  try {
    const r = await gh<{ permissions?: { push?: boolean } }>(cfg, "", {}, true);
    return !!r.permissions?.push;
  } catch { return false; }
}

function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}
