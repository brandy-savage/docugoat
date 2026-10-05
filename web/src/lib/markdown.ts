import { marked } from "marked";
import DOMPurify from "dompurify";
import { FIELD_RE, initialsOf, normalizeFieldTokens, sameName, type FieldKind } from "./fields";
import type { VerifiedSignature } from "./types";

marked.setOptions({ gfm: true, breaks: false });

export function canonicalMarkdown(md: string): string {
  return normalizeFieldTokens(md.replace(/\r\n?/g, "\n")).split("\n").map((l) => l.replace(/[ \t]+$/, "")).join("\n").trim() + "\n";
}

export function titleFromMarkdown(md: string, fallback = "Untitled"): string {
  const m = md.match(/^\s*#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

export interface RenderContext {
  signatures?: VerifiedSignature[];
  /** Name of the viewer, so their own fields get the "sign here" cue. Empty string = open slot. */
  viewerName?: string | null;
}

function fieldHtml(kind: FieldKind, name: string, ctx: RenderContext): string {
  const sig = ctx.signatures?.find((s) => sameName(s.signerName, name) || (name === "" && s.slot > 0));
  const mine = ctx.viewerName !== undefined && ctx.viewerName !== null && (ctx.viewerName === "" || sameName(ctx.viewerName, name));
  const label = { sign: "Signature", date: "Date", initials: "Initials" }[kind];
  const who = name ? esc(name) : "Signer";
  if (sig) {
    if (kind === "sign") {
      return `<span class="sig-field signed" data-kind="sign"><img src="${sig.signatureImage}" alt="Signature of ${esc(sig.signerName)}" /><span class="sig-meta">${esc(sig.signerName)} · ${fmtDate(sig.signedAt)}</span></span>`;
    }
    if (kind === "date") return `<span class="sig-field signed inline" data-kind="date"><span class="sig-value">${fmtDate(sig.signedAt)}</span><span class="sig-meta">Date</span></span>`;
    return `<span class="sig-field signed inline" data-kind="initials"><span class="sig-value sig-initials">${esc(initialsOf(sig.signerName))}</span><span class="sig-meta">Initials</span></span>`;
  }
  return `<span class="sig-field${mine ? " mine" : ""}${kind !== "sign" ? " inline" : ""}" data-kind="${kind}"><span class="sig-label">${mine ? "Sign here" : label}</span><span class="sig-name">${who}</span></span>`;
}

export function renderMarkdown(md: string, ctx: RenderContext = {}): string {
  const html = marked.parse(md, { async: false }) as string;
  const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ["style", "script", "iframe", "form", "input"] });
  return clean.replace(FIELD_RE, (_m, kind: string, name: string) => fieldHtml(kind.toLowerCase() as FieldKind, name.trim(), ctx));
}
