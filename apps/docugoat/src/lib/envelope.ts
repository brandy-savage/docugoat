import { relay } from "./api";
import { BACKEND, currentWriteToken, transport } from "./config";
import { BASE_URL } from "./env";
import {
  KDF_ITERATIONS, decryptJson, deriveKey, ecdsaSign, ecdsaVerify, encryptJson, fieldsHash, fromB64, generateCode, generateContentKey,
  generateFragmentSecret, generateOwnerToken, randomBytes, sha256Hex, signingMessage, toB64, toHex, unwrapContentKey, verifyReceipt, wrapContentKey,
} from "./crypto";
import { sameName } from "./fields";
import { canonicalMarkdown } from "./markdown";
import type { AttestedReceipt, AuditEvent, DocumentPayload, Recipient, ReceiptBody, RelayEnvelope, SignaturePayload, VerifiedSignature, ViewEventPayload } from "./types";
import { findRecord, saveRecord, type IssuedCode } from "./vault";

/** Signer link. On the GitHub backend it also carries the data-repo write token (in the fragment, never sent to any server but GitHub's API). */
export function envelopeUrl(id: string, fragmentSecret: string, token = currentWriteToken()): string {
  const base = BASE_URL.replace(/\/$/, "");
  const t = BACKEND === "github" && token ? `&t=${encodeURIComponent(token)}` : "";
  return `${location.origin}${base}/d/${id}#k=${fragmentSecret}${t}`;
}

export interface SealInput { title: string; markdown: string; author: string; authorSigns: boolean; signerNames: string[]; ttlDays: number }
export interface SealResult { id: string; fragmentSecret: string; ownerToken: string; expiresAt: string; url: string; issued: IssuedCode[] }

export async function sealDocument(input: SealInput): Promise<SealResult> {
  const recipients: Recipient[] = [
    { slot: 0, name: input.author, role: "owner", signs: input.authorSigns },
    ...(input.signerNames.length ? input.signerNames : [""]).map((name, i) => ({ slot: i + 1, name, role: "signer" as const })),
  ];
  const doc: DocumentPayload = {
    v: 2, title: input.title, markdown: canonicalMarkdown(input.markdown), createdAt: new Date().toISOString(), author: input.author, recipients,
  };
  const fragmentSecret = generateFragmentSecret();
  const ownerToken = generateOwnerToken();
  const salt = randomBytes(16);
  const contentKey = await generateContentKey();

  const issued: IssuedCode[] = [];
  const wraps = [];
  for (const r of recipients) {
    const code = generateCode();
    const rk = await deriveKey(code, fragmentSecret, salt);
    wraps.push({ slot: r.slot, ...(await wrapContentKey(contentKey, rk)) });
    issued.push({ slot: r.slot, name: r.name, role: r.role, code });
  }
  const sealed = await encryptJson(contentKey, doc);
  const documentSha256 = await sha256Hex(doc.markdown);
  const res = await transport().seal({
    documentSha256,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: KDF_ITERATIONS, salt: toB64(salt) },
    wraps,
    cipher: { name: "AES-GCM", iv: sealed.iv },
    ciphertext: sealed.ciphertext,
    ownerToken,
    ttlDays: input.ttlDays,
  });
  saveRecord({
    id: res.id, title: doc.title, fragmentSecret, createdAt: res.createdAt, expiresAt: res.expiresAt,
    role: "owner", code: issued[0].code, slot: 0, issued, ownerToken, sealReceipt: res.receipt,
  });
  return { id: res.id, fragmentSecret, ownerToken, expiresAt: res.expiresAt, url: envelopeUrl(res.id, fragmentSecret), issued };
}

export interface OpenedEnvelope {
  envelope: RelayEnvelope;
  key: CryptoKey;
  doc: DocumentPayload;
  documentSha256: string;
  slot: number;
  me: Recipient;
}

/** One PBKDF2 per attempt; the derived key is tried against every wrap so the code itself reveals the slot. */
export async function openEnvelope(envelope: RelayEnvelope, code: string, fragmentSecret: string): Promise<OpenedEnvelope> {
  const rk = await deriveKey(code, fragmentSecret, fromB64(envelope.kdf.salt), envelope.kdf.iterations);
  for (const w of envelope.wraps) {
    const key = await unwrapContentKey(w, rk);
    if (!key) continue;
    const doc = await decryptJson<DocumentPayload>(key, { iv: envelope.cipher.iv, ciphertext: envelope.ciphertext });
    const me = doc.recipients.find((r) => r.slot === w.slot) ?? { slot: w.slot, name: "", role: "signer" };
    return { envelope, key, doc, documentSha256: await sha256Hex(canonicalMarkdown(doc.markdown)), slot: w.slot, me };
  }
  throw new Error("wrong code");
}

let relayKeyCache: Promise<string | undefined> | null = null;
function relayKey(): Promise<string | undefined> {
  if (BACKEND !== "relay") return Promise.resolve(undefined);
  if (!relayKeyCache) relayKeyCache = relay.relayKey().then((k) => k.publicKey).catch(() => undefined);
  return relayKeyCache;
}

async function attestOrNull(id: string, action: "view" | "sign", sha: string): Promise<AttestedReceipt | undefined> {
  const t = transport();
  if (!t.attest) return undefined;
  try { return await t.attest(id, action, sha, toHex(randomBytes(8))); } catch { return undefined; }
}

async function checkReceipt(r: AttestedReceipt | undefined): Promise<{ valid: boolean | null; body: ReceiptBody | null }> {
  if (!r) return { valid: null, body: null };
  let body: ReceiptBody | null = null;
  try { body = JSON.parse(r.receipt); } catch { return { valid: false, body: null }; }
  return { valid: await verifyReceipt(r.receipt, r.sig, r.publicKey, await relayKey()), body };
}

/** Post an encrypted "viewed" event once per tab session per envelope. */
export async function recordView(opened: OpenedEnvelope) {
  const key = `docugoat.viewed.${opened.envelope.id}.${opened.slot}`;
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, "1");
  const receipt = await attestOrNull(opened.envelope.id, "view", opened.documentSha256);
  const payload: ViewEventPayload = { v: 1, kind: "viewed", slot: opened.slot, name: opened.me.name, at: new Date().toISOString(), receipt };
  const sealed = await encryptJson(opened.key, payload);
  await transport().postEvent(opened.envelope.id, { cipher: { name: "AES-GCM", iv: sealed.iv }, ciphertext: sealed.ciphertext }).catch(() => undefined);
}

export async function signEnvelope(opened: OpenedEnvelope, signerName: string, signatureImage: string, fields?: Record<string, string>) {
  const signedAt = new Date().toISOString();
  const fh = await fieldsHash(fields);
  const ecdsa = await ecdsaSign(signingMessage(opened.documentSha256, signerName, signedAt, fh));
  const receipt = await attestOrNull(opened.envelope.id, "sign", opened.documentSha256);
  const payload: SignaturePayload = {
    v: 2, slot: opened.slot, signerName, signedAt, documentSha256: opened.documentSha256, signatureImage, ecdsa, userAgent: navigator.userAgent, receipt,
    ...(fh ? { fields } : {}),
  };
  const sealed = await encryptJson(opened.key, payload);
  return transport().sign(opened.envelope.id, { cipher: { name: "AES-GCM", iv: sealed.iv }, ciphertext: sealed.ciphertext });
}

export async function loadSignatures(opened: OpenedEnvelope): Promise<VerifiedSignature[]> {
  const signatures = await transport().signatures(opened.envelope.id);
  const out: VerifiedSignature[] = [];
  for (const s of signatures) {
    try {
      const p = await decryptJson<SignaturePayload>(opened.key, { iv: s.cipher.iv, ciphertext: s.ciphertext });
      const recipient = opened.doc.recipients.find((r) => r.slot === p.slot);
      const rc = await checkReceipt(p.receipt);
      out.push({
        ...p,
        relayId: s.id,
        relayCreatedAt: s.createdAt,
        hashMatches: p.documentSha256 === opened.documentSha256,
        ecdsaValid: await ecdsaVerify(signingMessage(p.documentSha256, p.signerName, p.signedAt, await fieldsHash(p.fields)), p.ecdsa),
        nameBound: !!recipient && (recipient.name === "" || sameName(recipient.name, p.signerName)),
        recipientName: recipient?.name ?? "",
        receiptValid: rc.valid,
        receiptBody: rc.body,
      });
    } catch {
      // Not decryptable under this envelope key: ignore.
    }
  }
  return out.sort((a, b) => a.signedAt.localeCompare(b.signedAt));
}

export const isVerified = (s: VerifiedSignature) => s.hashMatches && s.ecdsaValid && s.nameBound;

/** Full audit trail: seal (from the owner's vault receipt), views, signatures — verified, sorted. */
export async function loadAudit(opened: OpenedEnvelope, signatures: VerifiedSignature[]): Promise<AuditEvent[]> {
  const events: AuditEvent[] = [];
  const t = transport();
  const times: Record<string, { date: string; sha: string; verified: boolean }> = t.commitTimes ? await t.commitTimes(opened.envelope.id).catch(() => ({})) : {};
  const gh = (key: string) => times[key] ? { attested: true as const, recordedAt: times[key].date, ref: times[key].sha.slice(0, 7) } : {};
  const rec = findRecord(opened.envelope.id);
  const sealRc = await checkReceipt(rec?.sealReceipt);
  events.push({ kind: "sealed", at: opened.doc.createdAt, who: opened.doc.author, slot: 0, ip: sealRc.body?.ip, userAgent: sealRc.body?.userAgent, attested: sealRc.valid, ...gh("envelope") });
  try {
    const raw = await t.events(opened.envelope.id);
    for (const e of raw) {
      try {
        const p = await decryptJson<ViewEventPayload>(opened.key, { iv: e.cipher.iv, ciphertext: e.ciphertext });
        if (p.kind !== "viewed") continue;
        const rc = await checkReceipt(p.receipt);
        const recipient = opened.doc.recipients.find((r) => r.slot === p.slot);
        events.push({ kind: "viewed", at: p.at, who: recipient?.name || p.name || "open signer", slot: p.slot, ip: rc.body?.ip, userAgent: rc.body?.userAgent, attested: rc.valid, relayId: e.id, ...gh(e.id) });
      } catch { /* not ours */ }
    }
  } catch { /* relay unreachable: still show what we have */ }
  for (const s of signatures) {
    events.push({ kind: "signed", at: s.signedAt, who: s.signerName, slot: s.slot, ip: s.receiptBody?.ip, userAgent: s.receiptBody?.userAgent, attested: s.receiptValid, relayId: s.relayId, ...gh(s.relayId) });
  }
  return events.sort((a, b) => a.at.localeCompare(b.at));
}
