// Turns a playbook template and a finding into a concrete text change.
// Independent of DOCX: the caller maps the result onto document edits.

import type { ClauseTemplate, Finding, ScanBlock } from './types.ts';

export type PlannedChange =
  | { kind: 'replaceText'; blockId: string; text: string }
  | { kind: 'deleteBlock'; blockId: string }
  /** blockId null: no location (e.g. a missing clause); the caller chooses where. */
  | { kind: 'insertAfter'; blockId: string | null; text: string };

const VARIABLE_RE = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g;

export function templateVariables(text: string): string[] {
  return [...new Set([...text.matchAll(VARIABLE_RE)].map((m) => m[1]!))];
}

export function fillTemplate(text: string, vars: Record<string, string>): { text: string; missing: string[] } {
  const missing: string[] = [];
  const filled = text.replace(VARIABLE_RE, (whole, name: string) => {
    const value = vars[name]?.trim();
    if (!value) {
      missing.push(name);
      return whole;
    }
    return value;
  });
  return { text: filled, missing: [...new Set(missing)] };
}

export function planChange(
  template: ClauseTemplate,
  finding: Finding,
  blocks: readonly ScanBlock[],
  filledText: string,
): PlannedChange {
  const unit = finding.unit[0];
  const block = unit && blocks.find((b) => b.id === unit.blockId);
  const anchorId = finding.hits[0]?.blockId ?? unit?.blockId ?? null;

  if (template.action === 'insertAfter' || !unit || !block) {
    return { kind: 'insertAfter', blockId: anchorId, text: filledText };
  }

  switch (template.action) {
    case 'replaceParagraph':
      return { kind: 'replaceText', blockId: block.id, text: filledText };
    case 'deleteParagraph':
      return { kind: 'deleteBlock', blockId: block.id };
    case 'appendToParagraph':
      return { kind: 'replaceText', blockId: block.id, text: `${block.text.trimEnd()} ${filledText}` };
    case 'replaceSentence':
      return { kind: 'replaceText', blockId: block.id, text: block.text.slice(0, unit.start) + filledText + block.text.slice(unit.end) };
    case 'deleteSentence': {
      const before = block.text.slice(0, unit.start);
      const after = block.text.slice(unit.end);
      // Remove the sentence along with the space that separated it from its neighbour.
      const text = /\s$/.test(before) && /^\s/.test(after) ? before + after.replace(/^\s+/, '') : before.replace(/\s+$/, '') + after;
      return text.trim() ? { kind: 'replaceText', blockId: block.id, text } : { kind: 'deleteBlock', blockId: block.id };
    }
  }
}
