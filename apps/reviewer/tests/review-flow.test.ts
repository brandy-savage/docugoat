// The whole review loop without a browser: scan → apply approved language →
// rescan → export, checking the export invariants at the end.

import { describe, expect, it } from 'vitest';
import { exportDocx, openDocx } from '@docugoat/docx/document';
import { partTexts } from '@docugoat/docx/paragraphs';
import { applyPlannedChange, currentBlocks, defaultInsertionAnchor } from '@docugoat/review/bridge';
import { scan } from '@docugoat/rules/engine';
import { fillTemplate, planChange } from '@docugoat/rules/playbook';
import samplePack from '@docugoat/rules/sample-pack.json' with { type: 'json' };
import type { Finding, Rulepack } from '@docugoat/rules/types';
import { sampleMsa } from './fixtures/docx-builder.ts';
import { expectWellFormed, TRACKED } from './helpers.ts';

const pack = samplePack as Rulepack;
const ctx = { documentType: 'msa' as const, perspective: 'service_provider' as const };
const vars = { COMPANY_NAME: 'Provider', COUNTERPARTY: 'Customer', GOVERNING_LAW: 'Delaware', NOTICE_DAYS: '30', EXHIBIT: 'C' };

describe('review loop', () => {
  it('resolves findings by applying playbook language, then exports a valid redline', () => {
    const original = sampleMsa();
    const docx = openDocx(original);
    let edits = [] as ReturnType<typeof applyPlannedChange>['edits'];

    const apply = (ruleId: string, templateId: string) => {
      const blocks = currentBlocks(docx, edits);
      const finding = scan(blocks, pack.rules, ctx).findings.find((f: Finding) => f.ruleId === ruleId);
      expect(finding, ruleId).toBeDefined();
      const template = pack.templates.find((t) => t.id === templateId)!;
      const filled = fillTemplate(template.text, vars);
      expect(filled.missing).toEqual([]);
      const result = applyPlannedChange(docx, edits, planChange(template, finding!, blocks, filled.text), TRACKED);
      expect(result.error).toBeNull();
      edits = result.edits;
    };

    const before = new Set(scan(currentBlocks(docx, edits), pack.rules, ctx).findings.map((f) => f.ruleId));
    apply('RESTRICT-NONCOMPETE-001', 'NONCOMPETE-FALLBACK');
    apply('IP-PREEXISTING-001', 'IP-OWNERSHIP-PREFERRED');
    apply('PAYMENT-TERMS-001', 'PAYMENT-NET30'); // rewrites the counterparty's own tracked change
    apply('CHANGE-UNILATERAL-001', 'CHANGE-ORDER');
    apply('SECURITY-INCORPORATED-001', 'POLICY-FIXED-VERSION');
    apply('LIABILITY-MISSING-001', 'LIABILITY-CAP-INSERT');
    apply('GOVLAW-MISSING-001', 'GOVLAW-INSERT');

    const after = new Set(scan(currentBlocks(docx, edits), pack.rules, ctx).findings.map((f) => f.ruleId));
    for (const id of ['RESTRICT-NONCOMPETE-001', 'IP-PREEXISTING-001', 'PAYMENT-TERMS-001', 'PAYMENT-PAYIFPAID-001', 'CHANGE-UNILATERAL-001', 'SECURITY-INCORPORATED-001', 'LIABILITY-MISSING-001', 'GOVLAW-MISSING-001']) {
      expect(before, id).toContain(id);
      expect(after, id).not.toContain(id);
    }

    const out = exportDocx(docx, edits, TRACKED);
    const main = openDocx(out).main;
    expectWellFormed(main.doc.source);
    expect(partTexts(main, 'rejected')).toEqual(partTexts(docx.main, 'rejected'));
    const accepted = partTexts(main, 'accepted');
    expect(accepted).toEqual(currentBlocks(docx, edits).map((b) => b.text));
    expect(accepted.join('\n')).toContain('governed by the laws of the State of Delaware');
  });

  it('inserts missing clauses before the signature block', () => {
    const docx = openDocx(sampleMsa());
    const anchor = docx.main.paragraphs[defaultInsertionAnchor(docx, [])]!;
    expect(anchor.text).toContain('Signed and sealed');
  });
});

describe('review profile guess', () => {
  it('detects the agreement type and the parties’ defined terms', async () => {
    const { guessProfile } = await import('@docugoat/reviewer/ui/app');
    const docx = openDocx(sampleMsa());
    const record = { id: 'x', name: 'Customer MSA.docx', size: 0, sha256: '', importedAt: '' };
    expect(guessProfile(record, docx)).toEqual({
      documentType: 'msa',
      perspective: 'service_provider',
      variables: { COMPANY_NAME: 'Provider', COUNTERPARTY: 'Customer' },
    });
  });
});

describe('agreement type from the title', () => {
  it('treats an SOW that names its governing MSA as an SOW', async () => {
    const { guessProfile } = await import('@docugoat/reviewer/ui/app');
    const { readFileSync } = await import('node:fs');
    const docx = openDocx(new Uint8Array(readFileSync('tests/fixtures/corpus/pydocx-sow.docx')));
    const record = { id: 'x', name: 'Vendor paper.docx', size: 0, sha256: '', importedAt: '' };
    expect(guessProfile(record, docx)).toMatchObject({ documentType: 'sow', variables: { COMPANY_NAME: 'Vendor', COUNTERPARTY: 'Customer' } });
  });
});
