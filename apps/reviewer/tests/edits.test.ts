// Recreation with edits. Every export must satisfy:
//   • accept-all text equals the intended text,
//   • reject-all text equals the original document,
//   • only edited paragraphs change; every other part is byte-identical,
//   • the XML is well formed and new revision ids are unique.

import { describe, expect, it } from 'vitest';
import { exportDocx, openDocx, type OpenedDocx } from '@docugoat/docx/document';
import { checkEdit, EditError, type Edit, type RevisionOptions } from '@docugoat/docx/edits';
import { partTexts } from '@docugoat/docx/paragraphs';
import { buildDocx, sampleMsa } from './fixtures/docx-builder.ts';
import {
  CLEAN,
  count,
  expectOtherEntriesIdentical,
  expectWellFormed,
  exportedMain,
  findParagraph,
  replaceText,
  skeleton,
  texts,
  TRACKED,
} from './helpers.ts';

const original = sampleMsa();
const open = () => openDocx(original);
const originalAccepted = partTexts(open().main, 'accepted');
const originalRejected = partTexts(open().main, 'rejected');

/** Export, then check the invariants shared by every tracked text replacement. */
function exportReplacements(docx: OpenedDocx, replacements: Array<[string, string]>, opts: RevisionOptions = TRACKED) {
  const edits = replacements.map(([find, text]) => replaceText(docx, findParagraph(docx, find), text));
  const out = exportDocx(docx, edits, opts);
  const after = exportedMain(out);

  const expected = [...originalAccepted];
  for (const e of edits) if (e.type === 'replaceText') expected[e.paraIndex] = e.text;
  expect(partTexts(after, 'accepted')).toEqual(expected);
  if (opts.mode === 'tracked') expect(partTexts(after, 'rejected')).toEqual(originalRejected);

  const placeholders = new Map(edits.map((e) => [(e as { paraIndex: number }).paraIndex, '<P/>']));
  expect(skeleton(after, placeholders)).toBe(skeleton(docx.main, placeholders));
  expectOtherEntriesIdentical(original, out, ['word/document.xml']);
  expectWellFormed(after.doc.source);
  return { out, after, edits };
}

function newRevisionIds(xml: string): number[] {
  return [...xml.matchAll(/<w:(?:ins|del) w:id="(\d+)" w:author="Provider Legal"/g)].map((m) => Number(m[1]));
}

describe('tracked text replacement', () => {
  it('rewrites a phrase split across differently formatted runs', () => {
    const docx = open();
    const p = findParagraph(docx, 'shall not provide services');
    const { after } = exportReplacements(docx, [
      ['shall not provide services', p.text.replace('shall not provide services to any competitor of Customer', 'may provide services to any person')],
    ]);
    const xml = after.paragraphs[p.index]!;
    const src = after.doc.source.slice(xml.el.start, xml.el.end);

    expect(src).toContain('<w:delText xml:space="preserve">shall not</w:delText>');
    // The word-level diff leaves runs it does not need to touch alone.
    expect(src).toContain('<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">vide services</w:t></w:r>');
    expect(src).toContain('<w:delText xml:space="preserve">competitor of Customer</w:delText>');
    // Inserted text takes the formatting of the first replaced run (bold + underline).
    expect(src).toMatch(/<w:ins [^>]*><w:r><w:rPr><w:b\/><w:u w:val="single"\/><\/w:rPr><w:t xml:space="preserve">may/);
    // Bookmark, comment anchors and proofing marks are untouched.
    for (const marker of ['<w:bookmarkStart w:id="10" w:name="_Ref_NonCompete"/>', '<w:commentRangeStart w:id="40"/>', '<w:commentReference w:id="40"/>', '<w:bookmarkEnd w:id="10"/>']) {
      expect(src).toContain(marker);
    }
  });

  it('applies several edits across paragraphs in one export', () => {
    const docx = open();
    const { after } = exportReplacements(docx, [
      ['including any services reasonably implied thereby', 'Provider shall perform the services described in each Statement of Work (“SOW”).'],
      ['without additional charge', 'Customer may request changes to any SOW, subject to a mutually agreed change order.'],
      ['All work product', 'Customer shall own deliverables created specifically for Customer, excluding Provider’s pre-existing tools and methodologies.'],
    ]);
    const ids = newRevisionIds(after.doc.source);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Math.min(...ids)).toBeGreaterThan(40); // above existing comment/bookmark/revision ids
  });

  it('edits text inside a hyperlink without breaking the link', () => {
    const docx = open();
    const p = findParagraph(docx, 'Security Policy');
    const { after } = exportReplacements(docx, [['Security Policy', p.text.replace('Security Policy', 'Information Security Policy')]]);
    const src = after.doc.source.slice(after.paragraphs[p.index]!.el.start, after.paragraphs[p.index]!.el.end);
    // Like typing in Word, text added at the start of a link goes just before it; the link itself is untouched.
    expect(src).toContain('<w:hyperlink r:id="rIdLink1" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>Security Policy</w:t></w:r></w:hyperlink>');
  });

  it('edits table cells and content controls', () => {
    const docx = open();
    exportReplacements(docx, [
      ['$25,000', '$20,000'],
      ['Notices shall be sent', 'Notices shall be sent to: 1 Commerce Plaza, Springfield.'],
    ]);
  });

  it('inserts at the very start and end of a paragraph', () => {
    const docx = open();
    const p = findParagraph(docx, 'All work product');
    exportReplacements(docx, [['All work product', `Except as set forth in an SOW, ${p.text} Provider retains its pre-existing IP.`]]);
  });

  it('preserves tabs and line breaks', () => {
    const docx = open();
    const tabbed = findParagraph(docx, 'without additional charge');
    const broken = findParagraph(docx, 'IN WITNESS WHEREOF');
    const { after } = exportReplacements(docx, [
      ['without additional charge', tabbed.text.replace('without additional charge', 'subject to a change order')],
      ['IN WITNESS WHEREOF', broken.text.replace('executed', 'duly executed')],
    ]);
    expect(after.paragraphs[tabbed.index]!.text).toContain('\t');
    expect(after.paragraphs[broken.index]!.text).toContain('\n');
  });

  it('can add new tabs and line breaks', () => {
    const docx = open();
    const p = findParagraph(docx, 'All work product');
    const { after } = exportReplacements(docx, [['All work product', 'Line one\tTabbed\nLine two']]);
    const src = after.doc.source.slice(after.paragraphs[p.index]!.el.start, after.paragraphs[p.index]!.el.end);
    expect(src).toContain('<w:t xml:space="preserve">Line one</w:t><w:tab/><w:t xml:space="preserve">Tabbed</w:t><w:br/>');
  });

  it('fills an empty self-closing paragraph', () => {
    const docx = open();
    const empty = docx.main.paragraphs[docx.main.paragraphs.length - 1]!;
    expect(empty.el.selfClosing).toBe(true);
    const out = exportDocx(docx, [replaceText(docx, empty, 'Schedule A follows.')], TRACKED);
    const after = exportedMain(out);
    expect(partTexts(after, 'accepted').at(-1)).toBe('Schedule A follows.');
    expect(partTexts(after, 'rejected')).toEqual(originalRejected);
    expectWellFormed(after.doc.source);
  });

  it('edits text around an image and keeps the image', () => {
    const docx = open();
    const { out } = exportReplacements(docx, [['Signed and sealed', ' Signed, sealed and delivered.']]);
    expectOtherEntriesIdentical(original, out, ['word/document.xml']);
    expect(exportedMain(out).doc.source).toContain('<a:blip r:embed="rIdImage1"/>');
  });

  it('edits text next to an existing counterparty revision without touching it', () => {
    const docx = open();
    const p = findParagraph(docx, 'ninety (90)');
    const { after } = exportReplacements(docx, [
      ['ninety (90)', p.text.replace(', and payment shall be contingent on Customer’s receipt of payment from its end client', '')],
    ]);
    const src = after.doc.source;
    expect(src).toContain('<w:del w:id="31" w:author="Counterparty Counsel" w:date="2026-09-02T10:00:00Z"><w:r><w:delText>thirty (30)</w:delText></w:r></w:del>');
    expect(src).toContain('<w:ins w:id="32" w:author="Counterparty Counsel" w:date="2026-09-02T10:00:00Z"><w:r><w:t>ninety (90)</w:t></w:r></w:ins>');
  });
});

describe('responding to the counterparty\'s tracked changes', () => {
  it('replaces part of their insertion by nesting our deletion inside it', () => {
    const docx = open();
    const p = findParagraph(docx, 'ninety (90)');
    const { after } = exportReplacements(docx, [['ninety (90)', p.text.replace('ninety (90)', 'sixty (60)')]]);
    const src = after.doc.source.slice(after.paragraphs[p.index]!.el.start, after.paragraphs[p.index]!.el.end);
    expect(src).toMatch(
      /<w:ins w:id="32" w:author="Counterparty Counsel" w:date="2026-09-02T10:00:00Z"><w:del w:id="\d+" w:author="Provider Legal" [^>]*><w:r><w:delText xml:space="preserve">ninety \(90\)<\/w:delText><\/w:r><\/w:del><\/w:ins><w:ins w:id="\d+" w:author="Provider Legal" [^>]*><w:r><w:t xml:space="preserve">sixty \(60\)<\/w:t><\/w:r><\/w:ins>/,
    );
  });

  it('rejects their insertion entirely when the text around it is rewritten', () => {
    exportReplacements(open(), [['ninety (90)', 'Customer shall pay all undisputed invoices within thirty (30) days of receipt.']]);
  });

  it('deletes a paragraph containing their insertion', () => {
    const docx = open();
    const p = findParagraph(docx, 'ninety (90)');
    const after = exportedMain(exportDocx(docx, [{ type: 'deleteParagraph', part: docx.mainPath, paraIndex: p.index, paraHash: p.hash }], TRACKED));
    expect(partTexts(after, 'accepted')).toEqual(originalAccepted.filter((_, i) => i !== p.index));
    expect(partTexts(after, 'rejected')).toEqual(originalRejected);
  });
});

describe('clean (untracked) replacement', () => {
  it('applies edits without adding revisions', () => {
    const docx = open();
    const p = findParagraph(docx, 'shall not provide services');
    const { after } = exportReplacements(
      docx,
      [['shall not provide services', p.text.replace('shall not', 'may')]],
      CLEAN,
    );
    expect(newRevisionIds(after.doc.source)).toEqual([]);
  });
});

describe('refused edits', () => {
  it('refuses to rewrite a field result', () => {
    const docx = open();
    const p = findParagraph(docx, 'survive termination');
    const edit = replaceText(docx, p, p.text.replace('3.1', '4.1'));
    expect(checkEdit(docx.main, edit, TRACKED)).toMatch(/part of a field/);
  });

  it('allows editing around a field', () => {
    const docx = open();
    const p = findParagraph(docx, 'survive termination');
    exportReplacements(docx, [['survive termination', p.text.replace('survive termination of this Agreement', 'expire upon termination')]]);
  });

  it('refuses a stale edit whose paragraph has changed', () => {
    const docx = open();
    const p = findParagraph(docx, 'All work product');
    const edit: Edit = { ...replaceText(docx, p, 'x'), paraHash: 'deadbeef' };
    expect(() => exportDocx(docx, [edit], TRACKED)).toThrow(/no longer matches/);
  });

  it('refuses two content edits to one paragraph', () => {
    const docx = open();
    const p = findParagraph(docx, 'All work product');
    expect(() => exportDocx(docx, [replaceText(docx, p, 'a'), replaceText(docx, p, 'b')], TRACKED)).toThrow(/more than one/);
  });
});

describe('paragraph insertion', () => {
  it('inserts a numbered clause after an anchor as a tracked insertion', () => {
    const docx = open();
    const anchor = findParagraph(docx, 'All work product');
    const text = 'Provider retains all right, title and interest in its pre-existing intellectual property.';
    const edit: Edit = { type: 'insertParagraph', part: docx.mainPath, afterIndex: anchor.index, anchorHash: anchor.hash, text, format: 'anchor' };
    const out = exportDocx(docx, [edit], TRACKED);
    const after = exportedMain(out);

    const expected = [...originalAccepted];
    expected.splice(anchor.index + 1, 0, text);
    expect(partTexts(after, 'accepted')).toEqual(expected);
    expect(partTexts(after, 'rejected')).toEqual(originalRejected);

    const inserted = after.paragraphs[anchor.index + 1]!;
    expect(inserted.markInserted).toBe(true);
    expect(inserted.styleId).toBe('ListParagraph');
    expect(after.doc.source.slice(inserted.el.start, inserted.el.end)).toContain('<w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr>');

    expect(skeleton(after, new Map([[anchor.index, '<P/>'], [anchor.index + 1, '']]))).toBe(skeleton(docx.main, new Map([[anchor.index, '<P/>']])));
    expectWellFormed(after.doc.source);
  });

  it('inserts plain paragraphs in clean mode', () => {
    const docx = open();
    const anchor = findParagraph(docx, 'All work product');
    const edits: Edit[] = ['First new.', 'Second new.'].map((text) => ({
      type: 'insertParagraph', part: docx.mainPath, afterIndex: anchor.index, anchorHash: anchor.hash, text, format: 'plain',
    }));
    const after = exportedMain(exportDocx(docx, edits, CLEAN));
    const expected = [...originalAccepted];
    expected.splice(anchor.index + 1, 0, 'First new.', 'Second new.');
    expect(partTexts(after, 'accepted')).toEqual(expected);
    expect(after.paragraphs[anchor.index + 1]!.styleId).toBeNull();
  });

  it('does not copy a section break into the new paragraph', () => {
    const body = '<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr><w:r><w:t>End of part one.</w:t></w:r></w:p><w:p><w:r><w:t>Part two.</w:t></w:r></w:p>';
    const docx = openDocx(buildDocx({ body }));
    const anchor = docx.main.paragraphs[0]!;
    const after = exportedMain(exportDocx(docx, [{ type: 'insertParagraph', part: docx.mainPath, afterIndex: 0, anchorHash: anchor.hash, text: 'New.', format: 'anchor' }], TRACKED));
    const src = after.doc.source.slice(after.paragraphs[1]!.el.start, after.paragraphs[1]!.el.end);
    expect(src).not.toContain('w:sectPr');
  });
});

describe('paragraph deletion', () => {
  it('deletes a paragraph and its mark as a tracked deletion', () => {
    const docx = open();
    const p = findParagraph(docx, 'All work product');
    const out = exportDocx(docx, [{ type: 'deleteParagraph', part: docx.mainPath, paraIndex: p.index, paraHash: p.hash }], TRACKED);
    const after = exportedMain(out);
    const expected = originalAccepted.filter((_, i) => i !== p.index);
    expect(partTexts(after, 'accepted')).toEqual(expected);
    expect(partTexts(after, 'rejected')).toEqual(originalRejected);
    expect(after.paragraphs[p.index]!.markDeleted).toBe(true);
    expectWellFormed(after.doc.source);
  });

  it('deletes a paragraph containing a field, keeping the field code as deleted instructions', () => {
    const docx = open();
    const p = findParagraph(docx, 'survive termination');
    const after = exportedMain(exportDocx(docx, [{ type: 'deleteParagraph', part: docx.mainPath, paraIndex: p.index, paraHash: p.hash }], TRACKED));
    const src = after.doc.source.slice(after.paragraphs[p.index]!.el.start, after.paragraphs[p.index]!.el.end);
    expect(src).toContain('<w:delInstrText xml:space="preserve"> REF _Ref_NonCompete \\r \\h </w:delInstrText>');
    expect(count(src, /<w:t[\s>]/g)).toBe(0);
    expect(partTexts(after, 'rejected')).toEqual(originalRejected);
  });

  it('keeps the mark of the last paragraph in a table cell', () => {
    const docx = open();
    const p = findParagraph(docx, '$25,000');
    expect(p.markRequired).toBe(true);
    const after = exportedMain(exportDocx(docx, [{ type: 'deleteParagraph', part: docx.mainPath, paraIndex: p.index, paraHash: p.hash }], TRACKED));
    expect(after.paragraphs[p.index]!.markDeleted).toBe(false);
    expect(partTexts(after, 'accepted')[p.index]).toBe('');
    expect(partTexts(after, 'rejected')).toEqual(originalRejected);
  });

  it('removes the paragraph entirely in clean mode', () => {
    const docx = open();
    const p = findParagraph(docx, 'All work product');
    const after = exportedMain(exportDocx(docx, [{ type: 'deleteParagraph', part: docx.mainPath, paraIndex: p.index, paraHash: p.hash }], CLEAN));
    expect(partTexts(after, 'accepted')).toEqual(originalAccepted.filter((_, i) => i !== p.index));
    expect(after.paragraphs.length).toBe(docx.main.paragraphs.length - 1);
  });
});

describe('end-to-end', () => {
  it('a tracked export reopens and re-exports unchanged', () => {
    const docx = open();
    const p = findParagraph(docx, 'shall not provide services');
    const once = exportDocx(docx, [replaceText(docx, p, p.text.replace('shall not', 'may'))], TRACKED);
    const twice = exportDocx(openDocx(once), [], TRACKED);
    expect(Buffer.from(twice).equals(Buffer.from(once))).toBe(true);
    expect(texts(twice, 'accepted')[p.index]).toContain('Provider may provide services');
  });
});
