// Writes the sample contract served by the app's "Try the sample" button.
import { mkdirSync, writeFileSync } from 'node:fs';
import { sampleMsa } from '../tests/fixtures/docx-builder.ts';

mkdirSync('public/samples', { recursive: true });
writeFileSync('public/samples/sample-msa.docx', sampleMsa());
console.log('Wrote public/samples/sample-msa.docx');
