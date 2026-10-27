// Which store an action targets. Precedence: the store named in the link being viewed, then the owner's
// session (their GitHub repo + token), then the user's chosen default, then the build default.
import type { Session } from "./account";
import { RELAY_URL } from "./api";
import type { GhConfig } from "./github";
import { storeFromParams, type Store } from "./store";
import { githubTransport, relayTransport, relayTransportFor, type Backend, type Transport } from "./transport";
import { env } from "./env";

export const BACKEND: Backend = env("VITE_BACKEND") === "github" ? "github" : "relay";
export const GH_BASE: GhConfig = { owner: env("VITE_GH_OWNER"), repo: env("VITE_GH_DATA_REPO"), branch: env("VITE_GH_DATA_BRANCH") || undefined };
export const PUBLIC_RELAY = env("VITE_PUBLIC_RELAY_URL").replace(/\/$/, "");

export const BUILD_STORE: Store = BACKEND === "github"
  ? { kind: "github", owner: GH_BASE.owner, repo: GH_BASE.repo }
  : { kind: "relay", url: PUBLIC_RELAY || RELAY_URL };

const DEFAULT_KEY = "docugoat.store.v1";
export function loadDefaultStore(): Store {
  try { const s = localStorage.getItem(DEFAULT_KEY); if (s) return JSON.parse(s); } catch { /* ignore */ }
  return BUILD_STORE;
}
export function saveDefaultStore(s: Store | null) {
  if (s) localStorage.setItem(DEFAULT_KEY, JSON.stringify(s)); else localStorage.removeItem(DEFAULT_KEY);
  listeners.forEach((l) => l());
}

let session: Session | null = null;
let linkStore: Store | null = null;
const listeners = new Set<() => void>();

export function getSession() { return session; }
export function setSession(s: Session | null) { session = s; listeners.forEach((l) => l()); }
export function setLinkStore(s: Store | null) { linkStore = s; }
export function onSessionChange(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

/** The store a sealed envelope will go to, or the one a link points at. */
export function currentStore(): Store {
  if (linkStore) {
    if (linkStore.kind === "github" && !linkStore.owner) return { ...linkStore, owner: GH_BASE.owner, repo: GH_BASE.repo };
    return linkStore;
  }
  if (session) return { kind: "github", owner: session.cfg.owner, repo: session.cfg.repo, token: session.cfg.token };
  return loadDefaultStore();
}

/** Whether sealing/signing can write to the given store right now. */
export function canWrite(s: Store = currentStore()): boolean {
  return s.kind === "relay" ? !!s.url || RELAY_URL === "" : !!s.token;
}

export function transportFor(s: Store): Transport {
  if (s.kind === "relay") return s.url ? relayTransportFor(s.url) : relayTransport();
  return githubTransport({ owner: s.owner, repo: s.repo, token: s.token, branch: GH_BASE.branch });
}
export function transport(): Transport { return transportFor(currentStore()); }

export function storeFromHash(hash: string): Store | null {
  return storeFromParams(new URLSearchParams(hash.replace(/^#/, "")));
}
