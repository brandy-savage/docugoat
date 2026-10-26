// Runs the contract rules engine over a markdown draft before sealing.
import { scan } from "@docugoat/rules/engine";
import { parseRulepack } from "@docugoat/rules/validate";
import samplePack from "@docugoat/rules/sample-pack.json";
import type { DocumentType, Perspective, Rulepack, ScanBlock, ScanResult } from "@docugoat/rules/types";
import { FIELD_RE } from "./fields";

export type { DocumentType, Perspective, Rulepack, ScanResult };
export const SAMPLE_PACK = samplePack as unknown as Rulepack;

/** Markdown → plain-text blocks the engine understands. Headings start sections; fields and inline markup are stripped. */
export function markdownToBlocks(markdown: string): ScanBlock[] {
  const blocks: ScanBlock[] = [];
  const chunks = markdown.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  let i = 0;
  for (const raw of chunks) {
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
    if (text) blocks.push({ id: `p${i++}`, text, heading });
  }
  return blocks;
}

export function reviewMarkdown(markdown: string, pack: Rulepack, documentType?: DocumentType, perspective?: Perspective): ScanResult {
  return scan(markdownToBlocks(markdown), pack.rules, { documentType, perspective });
}

export function loadPack(json: string): { pack: Rulepack | null; errors: string[] } {
  return parseRulepack(json);
}

export const STORED_PACK = "docugoat.rulepack.v1";
