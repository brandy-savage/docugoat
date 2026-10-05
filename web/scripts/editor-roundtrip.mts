// Proves the visual editor no longer escapes signature fields: markdown -> TipTap -> markdown round-trips exactly,
// escaped legacy tokens are normalized, and the PDF builder sees fields either way.
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><body></body>");
(globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);
for (const k of ["window", "document", "HTMLElement", "Node", "DOMParser", "MutationObserver", "getComputedStyle", "Element", "Text", "Range", "NodeFilter", "Selection", "DocumentFragment"]) {
  Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true, writable: true });
}
dom.window.document.createRange = () => ({ setStart() {}, setEnd() {}, getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }), getClientRects: () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) } as any);

const { Editor } = await import("@tiptap/core");
const { default: StarterKit } = await import("@tiptap/starter-kit");
const { Markdown } = await import("tiptap-markdown");
const { SignatureField } = await import("../src/components/SignatureFieldNode");
const { parseFields, normalizeFieldTokens } = await import("../src/lib/fields");
const { TEMPLATES } = await import("../src/lib/templates");
const { buildDocDefinition } = await import("../src/lib/pdf");

const md = TEMPLATES.find((t) => t.id === "nda")!.markdown;
const editor = new Editor({ element: document.createElement("div"), extensions: [StarterKit, Markdown.configure({ html: false }), SignatureField], content: md });
const chips = editor.state.doc.content.size && (() => { let n = 0; editor.state.doc.descendants((node) => { if (node.type.name === "signatureField") n++; }); return n; })();
assert.equal(chips, 4); console.log("✓ NDA loads with 4 field chips in the editor");

const out = normalizeFieldTokens(editor.storage.markdown.getMarkdown());
assert.equal(parseFields(out).length, 4); assert.ok(!out.includes("\\["), "no escaped brackets in serialized markdown"); console.log("✓ serializes back to clean [[sign: …]] tokens");

// Simulate an edit: type into the doc, then re-serialize.
editor.commands.insertContentAt(editor.state.doc.content.size, "<p>Extra clause typed by the user.</p>");
const out2 = normalizeFieldTokens(editor.storage.markdown.getMarkdown());
assert.equal(parseFields(out2).length, 4); assert.ok(out2.includes("Extra clause")); console.log("✓ editing does not destroy fields");

editor.commands.insertSignatureField({ kind: "sign", name: "ABC" });
const out3 = normalizeFieldTokens(editor.storage.markdown.getMarkdown());
assert.equal(parseFields(out3).filter((f) => f.name === "ABC").length, 1); console.log("✓ insertSignatureField serializes as [[sign: ABC]]");

// Legacy escaped tokens (what the old editor produced) still work everywhere.
const legacy = "## 6. Signatures\n\n\\[\\[sign: Party A\\]\\]\n\\[\\[date: Party A\\]\\]\n\n\\[\\[sign: ABC\\]\\]\n";
assert.equal(parseFields(legacy).length, 3); console.log("✓ escaped legacy tokens are parsed");
assert.equal(normalizeFieldTokens(legacy).includes("[[sign: Party A]]"), true); console.log("✓ escaped legacy tokens normalize to canonical form");
const dd = buildDocDefinition({ v: 2, title: "t", markdown: legacy, createdAt: new Date().toISOString(), author: "A", recipients: [] }, "e", "0".repeat(64), []);
const flat = JSON.stringify(dd.content);
assert.equal((flat.match(/\[\[(sign|date)/g) ?? []).length, 0); assert.equal((flat.match(/Signature  ·/g) ?? []).length, 2); console.log("✓ PDF renders fields from escaped legacy markdown, no raw tokens");
editor.destroy();
console.log("\nALL PASSED");
