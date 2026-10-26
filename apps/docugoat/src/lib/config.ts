// Backend selection. Build-time: VITE_BACKEND=github with VITE_GH_OWNER / VITE_GH_DATA_REPO (GitHub Pages),
// otherwise the Express relay. Runtime: the owner's signed-in session or a signer link supplies the write token.
import type { Session } from "./account";
import type { GhConfig } from "./github";
import { githubTransport, relayTransport, type Backend, type Transport } from "./transport";
import { env } from "./env";

export const BACKEND: Backend = env("VITE_BACKEND") === "github" ? "github" : "relay";
export const GH_BASE: GhConfig = { owner: env("VITE_GH_OWNER"), repo: env("VITE_GH_DATA_REPO"), branch: env("VITE_GH_DATA_BRANCH") || undefined };

let session: Session | null = null;
let linkToken: string | undefined;
const listeners = new Set<() => void>();

export function getSession() { return session; }
export function setSession(s: Session | null) { session = s; listeners.forEach((l) => l()); }
export function setLinkToken(t: string | undefined) { linkToken = t || undefined; }
export function onSessionChange(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

/** The token a signer's browser may use to write (from the link), or the owner's (from their vault). */
export function currentWriteToken(): string | undefined {
  return session?.cfg.token ?? linkToken;
}

export function transport(): Transport {
  if (BACKEND !== "github") return relayTransport;
  return githubTransport({ ...GH_BASE, token: currentWriteToken() });
}
