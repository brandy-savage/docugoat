// Runs the embedded Contract Reviewer exactly as the /review page mounts it (shadow root, dialog host,
// sample URL), in jsdom with a real IndexedDB shim: load the sample, check it renders, open a dialog,
// export the current document and re-open the bytes.
import assert from "node:assert/strict";
import fs from "node:fs";
import "fake-indexeddb/auto";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body><div id=host></div></body></html>", { url: "https://example.test/docugoat/review" });
(globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);
for (const k of ["window", "document", "HTMLElement", "HTMLDialogElement", "HTMLInputElement", "HTMLTextAreaElement", "Node", "Element", "Text", "Range", "DOMParser", "MutationObserver", "getComputedStyle", "DocumentFragment", "NodeFilter", "Selection", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "ShadowRoot", "navigator"]) {
  try { Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true, writable: true }); } catch { /* read-only in Node */ }
}
dom.window.document.createRange = () => ({ setStart() {}, setEnd() {}, getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }), getClientRects: () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) } as any);
const HD = dom.window.HTMLDialogElement.prototype as any;
HD.showModal = function () { this.setAttribute("open", ""); };
HD.show = HD.showModal;
HD.close = function () { this.removeAttribute("open"); this.dispatchEvent(new dom.window.Event("close")); };
(dom.window as any).matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
(globalThis as any).matchMedia = (dom.window as any).matchMedia;
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).File = (globalThis as any).File ?? dom.window.File;

const sample = new Uint8Array(fs.readFileSync(new URL("../public/samples/sample-msa.docx", import.meta.url)));
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init?: any) => {
  if (String(url).endsWith("/samples/sample-msa.docx")) return new Response(sample, { status: 200, headers: { "content-type": "application/octet-stream" } });
  return realFetch(url, init);
}) as any;

const { mountReviewer } = await import("../src/lib/reviewerHost");
const { openDocx } = await import("@docugoat/docx/document");
const css = fs.readFileSync(new URL("../../../packages/reviewer/src/style.css", import.meta.url), "utf8");
const step = (s: string) => console.log("✓", s);

const names: (string | null)[] = [];
const host = dom.window.document.getElementById("host")!;
const h = await mountReviewer(host, { css, sampleUrl: "/docugoat/samples/sample-msa.docx", onSession: (n) => names.push(n) });
assert.ok(h.shadow.querySelector("style")!.textContent!.includes(":host {"), "css scoped to :host");
assert.ok(!/(^|[\s}])body\s*\{/.test(h.shadow.querySelector("style")!.textContent!), "no body selector left");
assert.ok(h.shadow.querySelector("#app")?.children.length, "reviewer shell rendered inside the shadow root");
step("mounted in a shadow root with scoped CSS; shell rendered");

// The "Load sample" button → fetch(sampleUrl) → import.
const sampleBtn = [...h.shadow.querySelectorAll("button")].find((b) => /sample/i.test(b.textContent ?? ""));
assert.ok(sampleBtn, "a Load-sample button exists");
sampleBtn!.click();
for (let i = 0; i < 100 && !h.app.openDocumentName; i++) await new Promise((r) => setTimeout(r, 50));
assert.ok(h.app.openDocumentName, "sample opened: " + h.app.openDocumentName);
assert.ok(names.includes(h.app.openDocumentName), "host was notified of the open document");
step(`sample loaded via the button: "${h.app.openDocumentName}"`);

const text = h.shadow.querySelector("#app")!.textContent ?? "";
assert.ok(/master services agreement/i.test(text), "document text rendered");
step("document paragraphs render inside the shadow root");

// Dialogs must be mounted inside the shadow root (where the stylesheet lives), not on document.body.
const rulesBtn = h.shadow.querySelector<HTMLButtonElement>("#rules");
assert.ok(rulesBtn, "rules button exists");
rulesBtn!.click();
await new Promise((r) => setTimeout(r, 50));
assert.ok(h.shadow.querySelector("dialog[open]"), "rules dialog opened inside the shadow root");
assert.equal(dom.window.document.body.querySelector("dialog"), null, "no dialog leaked onto document.body");
step("Rules dialog opens inside the shadow root (styled), not on document.body");
(h.shadow.querySelector("dialog[open]") as any).close();

const out = h.app.currentExport("clean");
assert.ok(out && out.bytes.length > 1000, "export produced bytes");
const reopened = openDocx(out!.bytes);
const original = openDocx(sample);
assert.equal(reopened.main.paragraphs.length, original.main.paragraphs.length, "paragraph count preserved");
step(`currentExport('clean') → ${out!.bytes.length} bytes, ${reopened.main.paragraphs.length} paragraphs, re-opens cleanly`);

h.destroy();
assert.equal(h.shadow.childNodes.length, 0, "destroy clears the shadow root");
step("destroy() clears the mount");
console.log("\nEMBED CHECKS PASSED");
