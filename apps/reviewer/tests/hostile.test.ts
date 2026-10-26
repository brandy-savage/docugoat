// Malformed and hostile input must fail cleanly, quickly, and with a message
// a user can act on.

import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { openDocx } from '@docugoat/docx/document';
import { readPackage } from '@docugoat/docx/package';
import { scan } from '@docugoat/rules/engine';
import samplePack from '@docugoat/rules/sample-pack.json' with { type: 'json' };
import type { Rulepack } from '@docugoat/rules/types';
import { validateRulepack } from '@docugoat/rules/validate';
import { buildDocx } from './fixtures/docx-builder.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const docWith = (xml: string) => buildDocx({ body: '', rawDocumentXml: xml });

describe('hostile documents', () => {
  it('does not expand DTD entities (billion laughs)', () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]>` +
      `<w:document ${W}><w:body><w:p><w:r><w:t>&lol2;</w:t></w:r></w:p></w:body></w:document>`;
    const start = performance.now();
    const docx = openDocx(docWith(xml));
    expect(performance.now() - start).toBeLessThan(500);
    expect(docx.main.paragraphs[0]!.text).toBe('&lol2;');
  });

  it('handles very deeply nested markup without overflowing the stack', () => {
    const depth = 50_000;
    const xml = `<w:document ${W}><w:body>${'<w:customXml>'.repeat(depth)}<w:p><w:r><w:t>deep</w:t></w:r></w:p>${'</w:customXml>'.repeat(depth)}</w:body></w:document>`;
    const docx = openDocx(docWith(xml));
    expect(docx.main.paragraphs[0]!.text).toBe('deep');
  });

  it('keeps ">" inside attribute values', () => {
    const xml = `<w:document ${W}><w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="a>b"/></w:rPr><w:t>ok</w:t></w:r></w:p></w:body></w:document>`;
    expect(openDocx(docWith(xml)).main.paragraphs[0]!.text).toBe('ok');
  });

  it('rejects archives that claim to expand beyond the limit', () => {
    expect(() => readPackage(sampleZip(), { maxEntries: 100, maxTotalUncompressedBytes: 10 })).toThrow(/size limit/);
  });

  it('rejects truncated archives', () => {
    const bytes = buildDocx({ body: '<w:p/>' });
    expect(() => openDocx(bytes.slice(0, bytes.length / 2))).toThrow(/Could not read archive|Not a zip/);
  });

  it('rejects zips that are not Word documents', () => {
    const xlsx = zipSync({ '_rels/.rels': enc('<Relationships><Relationship Id="r" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'), 'xl/workbook.xml': enc('<workbook/>') });
    expect(() => openDocx(xlsx)).toThrow(/not a Word document/i);
    expect(() => openDocx(zipSync({ 'a.txt': enc('hi') }))).toThrow(/not an Office document/);
  });

  it('rejects documents that use an unexpected namespace prefix instead of showing them blank', () => {
    const xml = `<ns0:document xmlns:ns0="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><ns0:body><ns0:p><ns0:r><ns0:t>x</ns0:t></ns0:r></ns0:p></ns0:body></ns0:document>`;
    expect(() => openDocx(docWith(xml))).toThrow(/namespace prefix/);
  });

  it('rejects invalid UTF-8', () => {
    const bytes = zipSync({
      '_rels/.rels': enc('<Relationships><Relationship Id="r" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
      'word/document.xml': new Uint8Array([0x3c, 0x61, 0xff, 0xfe, 0x3e]),
    });
    expect(() => openDocx(bytes)).toThrow(/not valid UTF-8/);
  });
});

describe('hostile rules', () => {
  it('rejects regexes with nested quantifiers that can hang the browser', () => {
    const pack = structuredClone(samplePack) as Rulepack;
    pack.rules[0]!.match = { regex: '(a+)+$' };
    expect(validateRulepack(pack).join()).toMatch(/nested quantifier/);
    pack.rules[0]!.match = { regex: '(?:\\w+\\s?)*end' };
    expect(validateRulepack(pack).join()).toMatch(/nested quantifier/);
  });

  it('warns about uppercase in regexes, which never match normalized text', () => {
    const pack = structuredClone(samplePack) as Rulepack;
    pack.rules[0]!.match = { regex: 'Customer shall' };
    expect(validateRulepack(pack).join()).toMatch(/lower-case/);
    pack.rules[0]!.match = { regex: '\\bcustomer\\s\\S+\\p{L}' };
    expect(validateRulepack(pack)).toEqual([]);
  });

  it('scans a long contract quickly', () => {
    const blocks = Array.from({ length: 3000 }, (_, i) => ({
      id: `p${i}`,
      text: `${i}. Provider shall not provide services to any competitor of Customer, and Customer shall pay all invoices within ninety (90) days. Customer may audit all books and records at any time.`,
      heading: i % 20 === 0,
    }));
    const start = performance.now();
    const r = scan(blocks, (samplePack as Rulepack).rules, { documentType: 'msa', perspective: 'service_provider' });
    const ms = performance.now() - start;
    expect(r.errors).toEqual([]);
    expect(r.findings.length).toBeGreaterThan(3000);
    expect(ms).toBeLessThan(5000);
  });
});

function sampleZip(): Uint8Array {
  return buildDocx({ body: '<w:p/>' });
}
