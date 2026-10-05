// On-device PDF: markdown -> pdfmake document definition, with signature fields resolved and a certificate page.
import { marked, type Token, type Tokens } from "marked";
import { FIELD_RE, initialsOf, sameName, type FieldKind } from "./fields";
import type { AuditEvent, DocumentPayload, VerifiedSignature } from "./types";

type Content = any;

export const ROBOTO = { Roboto: { normal: "Roboto-Regular.ttf", bold: "Roboto-Medium.ttf", italics: "Roboto-Italic.ttf", bolditalics: "Roboto-MediumItalic.ttf" } };

const INK = "#111111", MUTED = "#6b6b6b", LINE = "#d9d9d9", ACCENT = "#b98700";
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

function inline(tokens: Token[] | undefined, style: { bold?: boolean; italics?: boolean; decoration?: string; code?: boolean } = {}): Content[] {
  if (!tokens) return [];
  const out: Content[] = [];
  for (const t of tokens as any[]) {
    switch (t.type) {
      case "text": case "escape": out.push({ text: t.text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'"), ...style, ...(style.code ? { fontSize: 9.5 } : {}) }); break;
      case "strong": out.push(...inline(t.tokens, { ...style, bold: true })); break;
      case "em": out.push(...inline(t.tokens, { ...style, italics: true })); break;
      case "del": out.push(...inline(t.tokens, { ...style, decoration: "lineThrough" })); break;
      case "codespan": out.push({ text: t.text, ...style }); break;
      case "link": out.push({ text: inline(t.tokens, style), link: t.href, color: ACCENT, decoration: "underline" }); break;
      case "br": out.push({ text: "\n" }); break;
      default: if (t.tokens) out.push(...inline(t.tokens, style)); else if (t.text) out.push({ text: t.text, ...style });
    }
  }
  return out;
}

function fieldBlock(kind: FieldKind, name: string, signatures: VerifiedSignature[]): Content {
  const sig = signatures.find((s) => sameName(s.signerName, name) || (name === "" && s.slot > 0));
  const who = name || "Signer";
  if (kind === "sign") {
    const body: Content[] = sig
      ? [{ image: sig.signatureImage, fit: [150, 48], margin: [0, 2, 0, 2] }, { text: `${sig.signerName}  ·  ${fmtDate(sig.signedAt)}`, fontSize: 8.5, color: MUTED }]
      : [{ text: " ", margin: [0, 18, 0, 0] }, { text: `Signature  ·  ${who}`, fontSize: 8.5, color: MUTED }];
    return { table: { widths: [220], body: [[{ stack: body, margin: [8, 6, 8, 6] }]] }, layout: { hLineColor: () => LINE, vLineColor: () => LINE, hLineWidth: (i: number, n: any) => (i === n.table.body.length ? 1 : 0), vLineWidth: () => 0 }, margin: [0, 8, 0, 10], unbreakable: true };
  }
  const value = sig ? (kind === "date" ? fmtDate(sig.signedAt) : initialsOf(sig.signerName)) : "";
  const label = kind === "date" ? "Date" : "Initials";
  return { columns: [{ width: 120, stack: [{ text: value || " ", fontSize: 11, margin: [0, 2, 0, 1] }, { canvas: [{ type: "line", x1: 0, y1: 0, x2: 120, y2: 0, lineWidth: 0.8, lineColor: LINE }] }, { text: `${label}  ·  ${who}`, fontSize: 8, color: MUTED, margin: [0, 2, 0, 0] }] }], margin: [0, 6, 0, 8], unbreakable: true };
}

function paragraphWithFields(p: Tokens.Paragraph, signatures: VerifiedSignature[]): Content[] {
  const raw = p.raw;
  if (!FIELD_RE.test(raw)) { FIELD_RE.lastIndex = 0; return [{ text: inline(p.tokens), margin: [0, 0, 0, 8], lineHeight: 1.35 }]; }
  FIELD_RE.lastIndex = 0;
  const out: Content[] = [];
  let last = 0;
  for (const m of raw.matchAll(FIELD_RE)) {
    const before = raw.slice(last, m.index).trim();
    if (before) out.push({ text: inline(marked.lexer(before).flatMap((t: any) => t.tokens ?? [])), margin: [0, 0, 0, 6] });
    out.push(fieldBlock(m[1].toLowerCase() as FieldKind, m[2].trim(), signatures));
    last = m.index! + m[0].length;
  }
  const tail = raw.slice(last).trim();
  if (tail) out.push({ text: inline(marked.lexer(tail).flatMap((t: any) => t.tokens ?? [])), margin: [0, 0, 0, 8] });
  return out;
}

function blocks(tokens: Token[], signatures: VerifiedSignature[]): Content[] {
  const out: Content[] = [];
  for (const t of tokens as any[]) {
    switch (t.type) {
      case "heading": out.push({ text: inline(t.tokens), fontSize: [22, 15, 12.5, 11, 11, 11][t.depth - 1], bold: true, margin: [0, t.depth === 1 ? 0 : 14, 0, 6], color: INK }); break;
      case "paragraph": out.push(...paragraphWithFields(t, signatures)); break;
      case "list": out.push({ [t.ordered ? "ol" : "ul"]: t.items.map((it: any) => ({ stack: blocks(it.tokens, signatures), margin: [0, 0, 0, 2] })), margin: [8, 0, 0, 8] }); break;
      case "blockquote": out.push({ table: { widths: [2, "*"], body: [[{ text: "", fillColor: ACCENT }, { stack: blocks(t.tokens, signatures), italics: true, color: "#333", margin: [8, 2, 0, 2] }]] }, layout: "noBorders", margin: [0, 4, 0, 10] }); break;
      case "code": out.push({ text: t.text, fontSize: 9, color: "#333", margin: [0, 4, 0, 10], preserveLeadingSpaces: true }); break;
      case "hr": out.push({ canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.6, lineColor: LINE }], margin: [0, 10, 0, 12] }); break;
      case "table": out.push({ table: { headerRows: 1, widths: t.header.map(() => "*"), body: [t.header.map((h: any) => ({ text: inline(h.tokens), bold: true, fillColor: "#f2f2f2" })), ...t.rows.map((r: any[]) => r.map((c) => ({ text: inline(c.tokens) })))] }, layout: { hLineColor: () => LINE, vLineColor: () => LINE }, fontSize: 9.5, margin: [0, 4, 0, 10] }); break;
      case "text": out.push({ text: inline(t.tokens ?? [{ type: "text", text: t.text }]), margin: [0, 0, 0, 4] }); break;
      case "space": case "html": break;
      default: if (t.tokens) out.push(...blocks(t.tokens, signatures));
    }
  }
  return out;
}

function certificate(doc: DocumentPayload, envelopeId: string, sha: string, signatures: VerifiedSignature[], audit: AuditEvent[]): Content[] {
  const rows = signatures.map((s) => {
    const ok = s.hashMatches && s.ecdsaValid && s.nameBound;
    return [
      { stack: [{ text: s.signerName, bold: true }, { text: s.slot === 0 ? "sender's own code" : s.recipientName && !sameName(s.recipientName, s.signerName) ? `code issued to ${s.recipientName}` : `code issued to this signer`, fontSize: 8, color: MUTED }, ...(s.receiptBody ? [{ text: `ip ${s.receiptBody.ip}`, fontSize: 7.5, color: MUTED }] : [])] },
      { stack: [{ text: new Date(s.signedAt).toUTCString(), fontSize: 8.5 }, { text: `relay ${s.receiptValid === true ? "attested" : s.receiptValid === false ? "ATTESTATION INVALID" : "received"} ${new Date(s.receiptBody?.receivedAt ?? s.relayCreatedAt).toISOString()}`, fontSize: 7.5, color: MUTED }] },
      { stack: [{ text: ok ? "VERIFIED" : s.hashMatches ? (s.nameBound ? "BAD SIGNATURE" : "NAME MISMATCH") : "CONTENT MISMATCH", bold: true, color: ok ? "#1f7a4d" : "#b3261e", fontSize: 8.5 }, { text: `key ${s.ecdsa.fingerprint}`, fontSize: 7.5, color: MUTED }] },
      { image: s.signatureImage, fit: [110, 36] },
    ];
  });
  return [
    { text: "Certificate of signatures", fontSize: 16, bold: true, pageBreak: "before", margin: [0, 0, 0, 2] },
    { text: doc.title, fontSize: 11, color: MUTED, margin: [0, 0, 0, 14] },
    {
      table: { widths: [110, "*"], body: [
        [{ text: "Envelope", color: MUTED }, { text: envelopeId }],
        [{ text: "Document SHA-256", color: MUTED }, { text: sha, fontSize: 8 }],
        [{ text: "Sealed by", color: MUTED }, { text: `${doc.author}  ·  ${new Date(doc.createdAt).toUTCString()}` }],
        [{ text: "Encryption", color: MUTED }, { text: "AES-256-GCM. Key derived on-device (PBKDF2-SHA256, 600,000 iterations) from a per-recipient access code and a link secret. The relay held ciphertext only." }],
        [{ text: "Signatures", color: MUTED }, { text: `${signatures.length} recorded, ${signatures.filter((s) => s.hashMatches && s.ecdsaValid && s.nameBound).length} verified` }],
      ] },
      layout: "noBorders", fontSize: 9, margin: [0, 0, 0, 16],
    },
    signatures.length
      ? { table: { headerRows: 1, widths: ["*", 130, 110, 120], body: [[{ text: "Signer", bold: true }, { text: "Signed (UTC)", bold: true }, { text: "Verification", bold: true }, { text: "Mark", bold: true }], ...rows] }, layout: { hLineColor: () => LINE, vLineColor: () => LINE, paddingTop: () => 6, paddingBottom: () => 6 }, fontSize: 9.5 }
      : { text: "No signatures recorded.", color: MUTED },
    { text: "Audit trail", fontSize: 12, bold: true, margin: [0, 22, 0, 6] },
    {
      table: { headerRows: 1, widths: [58, 118, "*", 92, 62], body: [
        [{ text: "Event", bold: true }, { text: "When (UTC)", bold: true }, { text: "Who", bold: true }, { text: "IP", bold: true }, { text: "Attested", bold: true }],
        ...audit.map((e) => [
          { text: { sealed: "Sealed", viewed: "Viewed", signed: "Signed" }[e.kind] },
          { text: new Date(e.at).toISOString().replace("T", " ").slice(0, 19) },
          { stack: [{ text: e.who }, ...(e.userAgent ? [{ text: e.userAgent.slice(0, 90), fontSize: 6.5, color: MUTED }] : [])] },
          { text: e.ip ?? "—" },
          { text: e.attested === true ? "yes" : e.attested === false ? "INVALID" : "no", color: e.attested === false ? "#b3261e" : e.attested ? "#1f7a4d" : MUTED },
        ]),
      ] },
      layout: { hLineColor: () => LINE, vLineColor: () => LINE, paddingTop: () => 4, paddingBottom: () => 4 }, fontSize: 8,
    },
    { text: "Each signature is an ECDSA P-256 signature over docugoat:v1:<sha256>:<signer>:<time>, produced by a key generated on the signer's device and relayed as ciphertext under the envelope key. 'Attested' events carry a receipt (time, IP, user agent, document hash) signed by the relay's Ed25519 key at the moment the action reached it; the receipt was encrypted into the bundle by the signer's browser, so the relay retains no plaintext record of it. Identity is established by possession of the recipient's access code, delivered by the sender out-of-band.", fontSize: 8, color: MUTED, margin: [0, 16, 0, 0], lineHeight: 1.3 },
  ];
}

export function buildDocDefinition(doc: DocumentPayload, envelopeId: string, sha: string, signatures: VerifiedSignature[], audit: AuditEvent[] = []) {
  return {
    info: { title: doc.title, author: doc.author, creator: "docugoat", producer: "docugoat" },
    pageSize: "A4", pageMargins: [56, 60, 56, 64],
    defaultStyle: { font: "Roboto", fontSize: 10.5, color: INK, lineHeight: 1.3 },
    footer: (page: number, pages: number) => ({ columns: [{ text: `${doc.title}  ·  ${envelopeId}`, fontSize: 7.5, color: MUTED }, { text: `${page} / ${pages}`, alignment: "right", fontSize: 7.5, color: MUTED }], margin: [56, 24, 56, 0] }),
    content: [...blocks(marked.lexer(doc.markdown), signatures), ...certificate(doc, envelopeId, sha, signatures, audit)],
  };
}

export async function downloadPdf(doc: DocumentPayload, envelopeId: string, sha: string, signatures: VerifiedSignature[], audit: AuditEvent[] = []) {
  const [{ default: pdfMake }, { default: vfs }] = await Promise.all([import("pdfmake/build/pdfmake"), import("pdfmake/build/vfs_fonts")]);
  const pm = pdfMake as any;
  pm.addVirtualFileSystem(vfs);
  pm.addFonts(ROBOTO);
  const dd = buildDocDefinition(doc, envelopeId, sha, signatures, audit);
  const safe = doc.title.replace(/[^\w\- ]+/g, "").trim() || "document";
  (pdfMake as any).createPdf(dd).download(`${safe}${signatures.length ? " (signed)" : ""}.pdf`);
}
