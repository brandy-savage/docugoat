// Device-local records. Codes live only here, on the device that generated or used them.
import type { AttestedReceipt, Role } from "./types";

export interface IssuedCode { slot: number; name: string; role: Role; code: string }

export interface VaultRecord {
  id: string;
  title: string;
  fragmentSecret: string;
  createdAt: string;
  expiresAt: string;
  role: Role;
  /** The code this device uses to open the envelope. */
  code: string;
  slot: number;
  /** Owner only: every code that was issued, so the share screen can be reopened. */
  issued?: IssuedCode[];
  ownerToken?: string;
  signerName?: string;
  sealReceipt?: AttestedReceipt;
}

const KEY = "docugoat.vault.v2";

export function loadVault(): VaultRecord[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}
export function saveRecord(rec: VaultRecord) {
  localStorage.setItem(KEY, JSON.stringify([rec, ...loadVault().filter((r) => r.id !== rec.id)]));
}
export function findRecord(id: string): VaultRecord | undefined {
  return loadVault().find((r) => r.id === id);
}
export function removeRecord(id: string) {
  localStorage.setItem(KEY, JSON.stringify(loadVault().filter((r) => r.id !== id)));
}

const DRAFT = "docugoat.draft.v1";
export interface Draft { markdown: string; author: string; recipients: string[]; savedAt: string }
export function loadDraft(): Draft | null {
  try { return JSON.parse(localStorage.getItem(DRAFT) ?? "null"); } catch { return null; }
}
export function saveDraft(d: Omit<Draft, "savedAt">) {
  localStorage.setItem(DRAFT, JSON.stringify({ ...d, savedAt: new Date().toISOString() }));
}
export function clearDraft() { localStorage.removeItem(DRAFT); }
