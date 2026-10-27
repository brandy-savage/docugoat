// Runs the contract rules engine over a markdown draft before sealing.
import { scan } from "@docugoat/rules/engine";
import { fillTemplate, planChange, templateVariables, type PlannedChange } from "@docugoat/rules/playbook";
import { parseRulepack } from "@docugoat/rules/validate";
import samplePack from "@docugoat/rules/sample-pack.json";
import type { ClauseTemplate, DocumentType, Finding, Perspective, Rulepack, ScanBlock, ScanResult } from "@docugoat/rules/types";
import { FIELD_RE } from "./fields";

export type { ClauseTemplate, DocumentType, Finding, Perspective, PlannedChange, Rulepack, ScanResult };
export { fillTemplate, templateVariables };
export const SAMPLE_PACK = samplePack as unknown as Rulepack;

/** The draft as blank-line-separated chunks; block ids are `p<chunkIndex>` so changes map straight back. */
export function splitChunks(markdown: string): string[] {
  return markdown.replace(/\r\n?/g, "\n").split(/\n{2,}/);
}

/** Markdown → plain-text blocks the engine understands. Headings start sections; fields and inline markup are stripped. */
export function markdownToBlocks(markdown: string): ScanBlock[] {
  const blocks: ScanBlock[] = [];
  const chunks = splitChunks(markdown);
  for (const [i, raw] of chunks.entries()) {
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const heading = /^#{1,6}\s/.test(lines[0]!);
    const text = lines
      .map((l) => l.replace(/^#{1,6}\s+/, "").replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, "").replace(/^>\s?/, "").replace(/^\|?\s*-{3,}.*$/, ""))
      .join(" ")
      .replace(FIELD_RE, " ")
      .replace(/\*\*|__|`|~~/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\|/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) blocks.push({ id: `p${i}`, text, heading });
  }
  return blocks;
}

/** Apply a planned change from the playbook to the markdown draft. Returns the new draft and a note for the user. */
export function applyChange(markdown: string, change: PlannedChange): { markdown: string; note: string } {
  const chunks = splitChunks(markdown);
  const idx = change.blockId ? Number(change.blockId.slice(1)) : -1;
  const join = (c: string[]) => c.join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  if (change.kind === "deleteBlock") {
    if (idx < 0) return { markdown, note: "Nothing to remove." };
    chunks.splice(idx, 1);
    return { markdown: join(chunks), note: "Paragraph removed." };
  }
  if (change.kind === "replaceText" && idx >= 0) {
    const heading = /^#{1,6}\s/.exec(chunks[idx] ?? "")?.[0] ?? "";
    chunks[idx] = heading + change.text;
    return { markdown: join(chunks), note: "Paragraph rewritten with the approved language (inline formatting in that paragraph was simplified)." };
  }
  // insertAfter: after the anchor block, or — for a missing clause — before the signature section, else at the end.
  if (idx >= 0) {
    chunks.splice(idx + 1, 0, change.text);
    return { markdown: join(chunks), note: "Approved language inserted after the flagged paragraph." };
  }
  const sig = chunks.findIndex((c) => /^#{1,6}\s.*(signature|execution|signed)/i.test(c));
  if (sig >= 0) { chunks.splice(sig, 0, change.text); return { markdown: join(chunks), note: "Missing clause inserted before the signature section." }; }
  chunks.push(change.text);
  return { markdown: join(chunks), note: "Missing clause appended at the end." };
}

export function planFor(template: ClauseTemplate, finding: Finding, markdown: string, filledText: string): PlannedChange {
  return planChange(template, finding, markdownToBlocks(markdown), filledText);
}

export const VARS_KEY = "docugoat.review.vars";
export function loadVars(): Record<string, string> { try { return JSON.parse(localStorage.getItem(VARS_KEY) ?? "{}"); } catch { return {}; } }
export function saveVars(v: Record<string, string>) { localStorage.setItem(VARS_KEY, JSON.stringify(v)); }

export function reviewMarkdown(markdown: string, pack: Rulepack, documentType?: DocumentType, perspective?: Perspective): ScanResult {
  return scan(markdownToBlocks(markdown), pack.rules, { documentType, perspective });
}

export function loadPack(json: string): { pack: Rulepack | null; errors: string[] } {
  return parseRulepack(json);
}

export const STORED_PACK = "docugoat.rulepack.v1";
