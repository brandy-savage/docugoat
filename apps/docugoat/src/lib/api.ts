import type { AttestedReceipt, RelayEnvelope, RelaySignature } from "./types";

/** Relay origin. Empty = same origin (dev proxy / relay serving the built app). Set VITE_RELAY_URL for static hosting such as GitHub Pages. */
import { env } from "./env";
export const RELAY_URL = env("VITE_RELAY_URL").replace(/\/$/, "");

export class RelayError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(RELAY_URL + url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new RelayError(res.status, body.error ?? `relay error ${res.status}`);
  }
  return res.json();
}

export const relay = {
  seal: (body: Pick<RelayEnvelope, "kdf" | "wraps" | "cipher" | "ciphertext"> & { ownerToken: string; ttlDays: number; documentSha256: string }) =>
    call<{ id: string; createdAt: string; expiresAt: string; commit: string; receipt: AttestedReceipt }>("/api/envelopes", { method: "POST", body: JSON.stringify(body) }),
  attest: (id: string, action: "view" | "sign", documentSha256: string, nonce: string) =>
    call<AttestedReceipt>(`/api/envelopes/${id}/attest`, { method: "POST", body: JSON.stringify({ action, documentSha256, nonce }) }),
  postEvent: (id: string, body: { cipher: RelayEnvelope["cipher"]; ciphertext: string }) =>
    call<{ id: string; createdAt: string }>(`/api/envelopes/${id}/events`, { method: "POST", body: JSON.stringify(body) }),
  events: (id: string) => call<{ events: RelaySignature[] }>(`/api/envelopes/${id}/events`),
  relayKey: () => call<{ alg: string; keyId: string; publicKey: string }>("/api/relay/key"),
  health: () => call<{ ok: boolean; relay: string }>("/api/health"),
  fetch: (id: string) => call<RelayEnvelope>(`/api/envelopes/${id}`),
  status: (id: string) => call<{ id: string; status: "active" | "expired" | "burned"; expiresAt: string; signatureCount: number }>(`/api/envelopes/${id}/status`),
  sign: (id: string, body: { cipher: RelayEnvelope["cipher"]; ciphertext: string }) =>
    call<{ id: string; createdAt: string; commit: string }>(`/api/envelopes/${id}/signatures`, { method: "POST", body: JSON.stringify(body) }),
  signatures: (id: string) => call<{ signatures: RelaySignature[] }>(`/api/envelopes/${id}/signatures`),
  burn: (id: string, ownerToken: string) =>
    call<{ id: string; status: "burned" }>(`/api/envelopes/${id}`, { method: "DELETE", headers: { "x-owner-token": ownerToken } }),
};
