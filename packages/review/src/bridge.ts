// Connects the document model to the rules engine: derives the text blocks
// to scan from the original plus pending edits, and turns planned playbook
// changes into document edits.

import type { OpenedDocx } from '@docugoat/docx/document';
import { checkEdit, type Edit, type RevisionOptions } from '@docugoat/docx/edits';
import type { ParagraphInfo } from '@docugoat/docx/paragraphs';
import { firstChild } from '@docugoat/docx/xml';
import type { PlannedChange } from '@docugoat/rules/playbook';
import type { ScanBlock } from '@docugoat/rules/types';

export interface DocBlock extends ScanBlock {
  /** Original paragraph, or null for a proposed new paragraph. */
  paraIndex: number | null;
  /** Index into the edit list for proposed paragraphs. */
  editIndex: number | null;
}

export const paragraphBlockId = (index: number) => `p${index}`;
export const insertBlockId = (editIndex: number) => `ins${editIndex}`;

/** The document as it reads with pending edits applied, in reading order. */
export function currentBlocks(docx: OpenedDocx, edits: readonly Edit[]): DocBlock[] {
  const out: DocBlock[] = [];
  for (const p of docx.main.paragraphs) {
    const content = contentEditFor(edits, p.index);
    if (content?.type !== 'deleteParagraph') {
      out.push({
        id: paragraphBlockId(p.index),
        text: content?.type === 'replaceText' ? content.text : p.text,
        heading: isHeading(p),
        paraIndex: p.index,
        editIndex: null,
      });
    }
    edits.forEach((e, i) => {
      if (e.type === 'insertParagraph' && e.afterIndex === p.index) {
        out.push({ id: insertBlockId(i), text: e.text, paraIndex: null, editIndex: i });
      }
    });
  }
  return out;
}

export function isHeading(p: ParagraphInfo): boolean {
  if (p.styleId && /^(heading|title)/i.test(p.styleId)) return true;
  const outline = p.pPr && firstChild(p.pPr, 'w:outlineLvl');
  return !!outline;
}

export function contentEditFor(edits: readonly Edit[], paraIndex: number): Edit | undefined {
  return edits.find((e) => e.type !== 'insertParagraph' && e.paraIndex === paraIndex);
}

/** Replace a paragraph's content edit (or clear it with null), validating first. */
export function withContentEdit(
  docx: OpenedDocx,
  edits: readonly Edit[],
  p: ParagraphInfo,
  edit: Edit | null,
  opts: RevisionOptions,
): { edits: Edit[]; error: string | null } {
  if (edit) {
    const problem = checkEdit(docx.main, edit, opts);
    if (problem) return { edits: [...edits], error: problem };
  }
  const next = edits.filter((e) => e.type === 'insertParagraph' || e.paraIndex !== p.index);
  if (edit) next.push(edit);
  return { edits: next, error: null };
}

/**
 * Where to insert a missing clause when nothing tells us: after the last
 * paragraph with text before the signature block.
 */
export function defaultInsertionAnchor(docx: OpenedDocx, edits: readonly Edit[]): number {
  const paragraphs = docx.main.paragraphs.filter((p) => contentEditFor(edits, p.index)?.type !== 'deleteParagraph');
  const signature = paragraphs.findIndex((p) => /in witness whereof|signature page follows/i.test(p.text));
  const candidates = signature > 0 ? paragraphs.slice(0, signature) : paragraphs;
  const withText = candidates.filter((p) => p.text.trim() && p.el.parent?.name !== 'w:tc');
  return (withText[withText.length - 1] ?? paragraphs[paragraphs.length - 1])!.index;
}

/** Apply a planned playbook change to the edit list. */
export function applyPlannedChange(
  docx: OpenedDocx,
  edits: readonly Edit[],
  change: PlannedChange,
  opts: RevisionOptions,
): { edits: Edit[]; error: string | null } {
  const block = change.blockId;
  const ins = block && /^ins(\d+)$/.exec(block);
  const para = block && /^p(\d+)$/.exec(block);

  if (change.kind === 'insertAfter') {
    let afterIndex: number;
    if (para) afterIndex = Number(para[1]);
    else if (ins) afterIndex = (edits[Number(ins[1])] as Extract<Edit, { type: 'insertParagraph' }>).afterIndex;
    else afterIndex = defaultInsertionAnchor(docx, edits);
    const anchor = docx.main.paragraphs[afterIndex]!;
    const edit: Edit = { type: 'insertParagraph', part: docx.mainPath, afterIndex, anchorHash: anchor.hash, text: change.text, format: 'anchor' };
    const problem = checkEdit(docx.main, edit, opts);
    return problem ? { edits: [...edits], error: problem } : { edits: [...edits, edit], error: null };
  }

  if (ins) {
    const i = Number(ins[1]);
    const next = [...edits];
    if (change.kind === 'deleteBlock') next.splice(i, 1);
    else next[i] = { ...(next[i] as Extract<Edit, { type: 'insertParagraph' }>), text: change.text };
    return { edits: next, error: null };
  }

  if (!para) return { edits: [...edits], error: `Unknown block ${String(block)}` };
  const p = docx.main.paragraphs[Number(para[1])]!;
  const edit: Edit =
    change.kind === 'deleteBlock'
      ? { type: 'deleteParagraph', part: docx.mainPath, paraIndex: p.index, paraHash: p.hash }
      : { type: 'replaceText', part: docx.mainPath, paraIndex: p.index, paraHash: p.hash, text: change.text };
  return withContentEdit(docx, edits, p, change.kind === 'replaceText' && change.text === p.text ? null : edit, opts);
}
