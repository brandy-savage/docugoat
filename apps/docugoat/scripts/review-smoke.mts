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
