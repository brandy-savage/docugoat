// The rules engine over every bundled template, as the composer runs it.
import { TEMPLATES } from "../src/lib/templates";
import { SAMPLE_PACK, markdownToBlocks, reviewMarkdown } from "../src/lib/review";
for (const t of TEMPLATES) {
  const type = t.id === "nda" ? "nda" : t.id === "services" ? "msa" : "other";
  const r = reviewMarkdown(t.markdown, SAMPLE_PACK, type as any, "service_provider");
  const blocks = markdownToBlocks(t.markdown);
  console.log(`${t.name.padEnd(20)} blocks=${blocks.length} findings=${r.findings.length} missing=${r.coverage.filter((c) => c.state !== "located").length} errors=${r.errors.length}`);
  for (const f of r.findings.slice(0, 3)) console.log(`   [${f.severity}] ${f.title} — "${f.excerpt.slice(0, 70)}"`);
  for (const c of r.coverage.filter((c) => c.state !== "located").slice(0, 3)) console.log(`   [${c.state}] ${c.title}`);
}
const nda = markdownToBlocks(TEMPLATES.find((t) => t.id === "nda")!.markdown);
if (nda.some((b) => /\[\[|\*\*|^#/.test(b.text))) throw new Error("markup leaked into blocks");
console.log("\nblocks are clean text; headings:", nda.filter((b) => b.heading).length);

// ---- approved language: fix "no governing law" on the NDA and rescan ----
{
  const { applyChange, fillTemplate, planFor } = await import("../src/lib/review");
  const md = TEMPLATES.find((t) => t.id === "nda")!.markdown;
  const r = reviewMarkdown(md, SAMPLE_PACK, "nda", "service_provider");
  const f = r.findings.find((x) => x.ruleId === "GOVLAW-MISSING-001");
  if (!f) throw new Error("expected a governing-law finding on the NDA");
  const t = SAMPLE_PACK.templates.find((x) => f.templateIds.includes(x.id));
  if (!t) throw new Error("no template for " + f.ruleId + " (" + f.templateIds.join(",") + ")");
  const { text, missing } = fillTemplate(t.text, { GOVERNING_LAW: "the State of New Mexico", VENUE: "Albuquerque, New Mexico", COMPANY: "Goat Security LLC", COUNTERPARTY: "Acme" });
  if (missing.length) throw new Error("unfilled vars: " + missing.join(","));
  const out = applyChange(md, planFor(t, f, md, text));
  const sigIdx = out.markdown.indexOf("## 6. Signatures"), clauseIdx = out.markdown.indexOf(text.slice(0, 40));
  if (clauseIdx < 0 || clauseIdx > sigIdx) throw new Error("clause not inserted before signatures: " + out.note);
  const again = reviewMarkdown(out.markdown, SAMPLE_PACK, "nda", "service_provider");
  if (again.findings.some((x) => x.ruleId === "GOVLAW-MISSING-001")) throw new Error("governing-law finding still present after applying template");
  if (!again.findings.length && !again.coverage.length) throw new Error("rescan produced nothing");
  console.log(`\napplied "${t.title}" → ${out.note}; governing-law finding cleared on rescan (${r.findings.length} → ${again.findings.length} findings)`);
}

// ---- Word document → derived markdown → fields ----
{
  const fs = await import("node:fs");
  const { docxToMarkdown, docxSource } = await import("../src/lib/docxDoc");
  const { parseFields } = await import("../src/lib/fields");
  const bytes = new Uint8Array(fs.readFileSync(new URL("../../reviewer/public/samples/sample-msa.docx", import.meta.url)));
  const { markdown, title } = await docxToMarkdown(bytes);
  const src = await docxSource("sample-msa.docx", bytes);
  const r = reviewMarkdown(markdown, SAMPLE_PACK, "msa", "service_provider");
  console.log(`docx "${title}": ${src.bytes} bytes, ${markdownToBlocks(markdown).length} blocks, ${markdown.split(/\n{2,}/).filter((c) => /^#/.test(c)).length} headings, ${parseFields(markdown).length} anchors, ${r.findings.length} findings, sha ${src.sha256.slice(0, 12)}`);
  if (!markdown.includes("#")) throw new Error("no headings derived from docx");
  if (r.findings.length === 0) throw new Error("expected findings on the sample MSA");
}
console.log("\nALL REVIEW CHECKS PASSED");
