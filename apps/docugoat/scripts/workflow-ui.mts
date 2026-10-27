// The whole workflow through the REAL React pages in jsdom against the live relay:
// compose (findings + approved clause) -> seal -> share codes -> signer on another device unlocks,
// fills fields, draws, signs -> owner verifies, exports PDF definition -> burns. Then the Word path.
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const RELAY = process.env.RELAY ?? "http://localhost:4173";
const dom = new JSDOM("<!doctype html><html><body><div id=root></div></body></html>", { url: "https://example.test/", pretendToBeVisual: true });
const W: any = dom.window;
for (const k of ["window", "document", "EventTarget", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLCanvasElement", "HTMLDialogElement", "Node", "Element", "Text", "Range", "DOMParser", "MutationObserver", "getComputedStyle", "DocumentFragment", "NodeFilter", "Selection", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "ShadowRoot", "navigator", "localStorage", "sessionStorage", "location", "history"]) {
  try { Object.defineProperty(globalThis, k, { value: W[k], configurable: true, writable: true }); } catch { /* read-only */ }
}
(globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);
// Libraries call the bare globals (signature_pad tracks pointer moves on the window this way).
for (const k of ["addEventListener", "removeEventListener", "dispatchEvent"]) (globalThis as any)[k] = (W as any)[k].bind(W);
(globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
W.scrollTo = () => {}; W.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} }); W.print = () => {};
W.HTMLElement.prototype.scrollIntoView = () => {};
W.document.createRange = () => ({ setStart() {}, setEnd() {}, getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }), getClientRects: () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) });
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
// Minimal canvas so signature_pad can run: every 2D method is a no-op, toDataURL yields a real PNG.
W.HTMLCanvasElement.prototype.getContext = function () { return new Proxy({ canvas: this }, { get: (t, k) => (k in t ? (t as any)[k] : () => undefined), set: (t, k, v) => { (t as any)[k] = v; return true; } }); };
W.HTMLCanvasElement.prototype.toDataURL = () => PNG;
Object.defineProperty(W.HTMLElement.prototype, "offsetWidth", { get() { return 400; }, configurable: true });
Object.defineProperty(W.HTMLElement.prototype, "offsetHeight", { get() { return 160; }, configurable: true });
// Relative /api calls -> live relay.
const realFetch = globalThis.fetch;
globalThis.fetch = ((url: any, init?: any) => realFetch(typeof url === "string" && url.startsWith("/") ? RELAY + url : url, init)) as any;
W.prompt = (globalThis as any).prompt = (q: string) => ({ GOVERNING_LAW: "the State of New Mexico", VENUE: "Albuquerque, New Mexico", COMPANY: "Goat Security LLC", COUNTERPARTY: "Acme Corp" } as any)[/\{\{(\w+)\}\}/.exec(q)?.[1] ?? ""] ?? "value";
W.confirm = (globalThis as any).confirm = () => true;
W.alert = (globalThis as any).alert = () => {};

const React = await import("react");
const { act } = React as any;
const { createRoot } = await import("react-dom/client");
const { createMemoryRouter, RouterProvider } = await import("react-router-dom");
const { AppShell } = await import("../src/components/AppShell");
const { Landing } = await import("../src/pages/Landing");
const { Compose } = await import("../src/pages/Compose");
const { Share } = await import("../src/pages/Share");
const { EnvelopePage } = await import("../src/pages/Envelope");
const { Vault } = await import("../src/pages/Vault");
const { Security } = await import("../src/pages/Security");
const { SealDocx } = await import("../src/pages/SealDocx");
const { loadVault } = await import("../src/lib/vault");
const { setHandoff } = await import("../src/lib/handoff");
const { buildDocDefinition } = await import("../src/lib/pdf");
const { isVerified, loadAudit, loadSignatures, openEnvelope } = await import("../src/lib/envelope");
const { relay } = await import("../src/lib/api");

const routes = [{ element: React.createElement(AppShell), children: [
  { path: "/", element: React.createElement(Landing) }, { path: "/new", element: React.createElement(Compose) }, { path: "/share/:id", element: React.createElement(Share) },
  { path: "/d/:id", element: React.createElement(EnvelopePage) }, { path: "/vault", element: React.createElement(Vault) }, { path: "/security", element: React.createElement(Security) }, { path: "/seal", element: React.createElement(SealDocx) },
] }];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const step = (s: string) => console.log("✓", s);
let root: any = null, container: HTMLElement = W.document.getElementById("root");
let router: any;
async function render(path: string) {
  if (root) await act(async () => root.unmount());
  container.remove(); container = W.document.createElement("div"); W.document.body.append(container);
  router = createMemoryRouter(routes, { initialEntries: [path] });
  root = createRoot(container);
  await act(async () => { root.render(React.createElement(RouterProvider, { router })); await sleep(50); });
}
async function until(pred: () => boolean, what: string, ms = 20000) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) {
      const dbg = qa<HTMLInputElement>("input").map((i) => `${i.type}:${i.previousElementSibling?.textContent?.slice(0, 20) ?? i.placeholder ?? ""}=${i.type === "checkbox" ? i.checked : JSON.stringify(i.value.slice(0, 20))}`).join(" | ");
      throw new Error(`timeout: ${what}\n  buttons: ${qa<HTMLButtonElement>("button").map((b) => `${b.textContent?.trim().slice(0, 18)}${b.disabled ? "(disabled)" : ""}`).join(", ")}\n  inputs: ${dbg}`);
    }
    await act(async () => { await sleep(60); });
  }
}
const q = <T extends Element = HTMLElement>(sel: string) => container.querySelector(sel) as T | null;
const qa = <T extends Element = HTMLElement>(sel: string) => [...container.querySelectorAll(sel)] as T[];
const text = () => container.textContent ?? "";
const btn = (re: RegExp) => qa<HTMLButtonElement>("button, a").find((b) => re.test((b.textContent ?? "").trim())) ?? null;
async function type(el: HTMLInputElement | HTMLTextAreaElement, v: string) {
  const proto = el instanceof W.HTMLTextAreaElement ? W.HTMLTextAreaElement.prototype : W.HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v); el.dispatchEvent(new W.Event("input", { bubbles: true })); await sleep(10); });
}
async function click(el: Element | null, what = "") { assert.ok(el, "missing element to click " + what); await act(async () => { (el as HTMLElement).click(); await sleep(30); }); }
async function stroke(canvas: HTMLCanvasElement) {
  await act(async () => { for (const [t, x] of [["pointerdown", 10], ["pointermove", 60], ["pointermove", 120], ["pointerup", 120]] as const) canvas.dispatchEvent(new W.PointerEvent(t, { bubbles: true, clientX: x, clientY: 40, buttons: t === "pointerup" ? 0 : 1, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true })); await sleep(30); });
}
const snapshotStorage = () => Object.fromEntries(Object.keys(W.localStorage).map((k) => [k, W.localStorage.getItem(k)]));
const restoreStorage = (s: Record<string, string>) => { W.localStorage.clear(); for (const [k, v] of Object.entries(s)) W.localStorage.setItem(k, v!); };

// ---------------------------------------------------------------- static pages
for (const [path, needle] of [["/", /Sign documents/], ["/security", /What the relay can and cannot see/], ["/vault", /Vault/]] as const) {
  await render(path); assert.match(text(), needle, path); step(`page ${path} renders`);
}

// ---------------------------------------------------------------- compose: findings, approved clause, seal
await render("/new");
await until(() => !!q(".tiptap") && /Review/.test(text()), "composer ready");
assert.match(text(), /Mutual Non-Disclosure Agreement/); step("composer loads the NDA template into the editor");
await type(qa<HTMLInputElement>("input").find((i) => i.placeholder === "Ada Lovelace")!, "Ada Lovelace");
await until(() => /No governing law/.test(text()), "finding visible");
step("Review panel flags 'No governing law' on the NDA");
const applyBtn = btn(/Insert governing law/i); assert.ok(applyBtn, "approved-language button for the finding");
await click(applyBtn, "apply clause");
await until(() => !/No governing law/.test(text()), "finding cleared");
assert.match(text(), /inserted before the signature section/i);
step("approved clause applied from the panel; finding cleared; editor updated");
assert.match(q(".tiptap")!.textContent ?? "", /New Mexico/); step("governing-law clause with the prompted variable is in the editor");

// signers from the template: Party A, Party B; rename Party B -> Bob Builder via the inline name input
const partyB = qa<HTMLInputElement>("input").find((i) => i.defaultValue === "Party B")!;
assert.ok(partyB, "Party B name input");
await type(partyB, "Bob Builder"); await act(async () => { partyB.dispatchEvent(new W.FocusEvent("focusout", { bubbles: true })); await sleep(20); });
await until(() => /\[\[sign: Bob Builder\]\]|Bob Builder/.test(q(".tiptap")!.textContent ?? ""), "rename propagated");
step("renaming a party renames its fields in the document");

await click(btn(/Seal & get codes/), "seal");
await until(() => /Codes issued/.test(text()), "share page", 30000);
const vault = loadVault(); assert.equal(vault.length, 1); const rec = vault[0];
assert.equal(rec.role, "owner"); assert.ok(rec.issued && rec.issued.length === 3, "owner + 2 signers issued");
const bob = rec.issued!.find((c) => c.name === "Bob Builder")!; assert.ok(bob, "Bob's code issued");
assert.ok(text().includes(bob.code) && text().includes(rec.code), "codes shown on the share page");
const link = (q<HTMLInputElement>("input[readonly]")!).value;
assert.ok(link.includes(`/d/${rec.id}#k=${rec.fragmentSecret}`), "share link carries id + fragment secret");
step(`sealed ${rec.id}; share page lists the link and 3 personal codes`);

// ---------------------------------------------------------------- signer, on another device
const ownerStorage = snapshotStorage();
W.localStorage.clear(); W.sessionStorage.clear();
await render(`/d/${rec.id}#k=${rec.fragmentSecret}`);
await until(() => qa(".code-cell").length === 12, "code entry");
step("signer link opens the code screen (no vault on this device)");
await type(qa<HTMLInputElement>(".code-cell")[0], "ZZZZZZZZZZZZ");
await until(() => /didn't unlock/.test(text()), "wrong code rejected", 30000);
step("a wrong code is rejected");
await type(qa<HTMLInputElement>(".code-cell")[0], bob.code.replace(/-/g, ""));
await until(() => /Review & sign/.test(text()), "unlocked", 40000);
assert.match(text(), /Opened with Bob Builder's code/); step("Bob's code unlocks the document and the sign panel");
assert.ok(q(".sig-field.mine"), "Bob's own field is highlighted"); step("Bob's signature field is highlighted as his");
const nameInput = qa<HTMLInputElement>("input").find((i) => i.value === "Bob Builder")!; assert.ok(nameInput.readOnly, "name is locked to the code"); step("signer name is locked to the issued code");
for (const f of qa<HTMLInputElement>("input").filter((i) => !i.readOnly && i.type === "text" && /Full legal name|Company/.test(i.previousElementSibling?.textContent ?? ""))) await type(f, f.previousElementSibling!.textContent!.includes("Company") ? "Builder Co" : "Robert Builder");
const consent = qa<HTMLInputElement>("input[type=checkbox]").at(-1)!; await click(consent, "consent");
await stroke(q<HTMLCanvasElement>("canvas")!);
await until(() => !btn(/^Sign document$/)?.disabled, "sign enabled");
await click(btn(/^Sign document$/), "sign");
await until(() => /You signed as/.test(text()), "signed", 40000);
assert.match(text(), /Builder Co/); step("Bob fills his text fields, draws, signs; the document shows his filled values");
assert.ok(q(".sig-field.signed img"), "signature image placed in Bob's field"); step("Bob's drawn mark is placed into his field");

// ---------------------------------------------------------------- owner comes back
restoreStorage(ownerStorage); W.sessionStorage.clear();
await render(`/d/${rec.id}#k=${rec.fragmentSecret}`);
await until(() => /You sealed this/.test(text()), "owner auto-unlock", 40000);
await until(() => /1\/2 signed|signed/.test(text()) && /Bob Builder/.test(text()), "progress");
step("owner auto-unlocks from the vault and sees Bob's signature in progress");
await until(() => /Viewed/.test(text()), "audit loaded", 40000);
assert.match(text(), /Viewed.*Bob Builder|Bob Builder.*Viewed/s); step("audit trail shows Bob viewed before signing");

// owner signs too (Party A field is his)
await until(() => !!btn(/^Sign document$/), "owner sign panel");
for (const f of qa<HTMLInputElement>("input").filter((i) => !i.readOnly && i.type === "text" && /Full legal name|Company/.test(i.previousElementSibling?.textContent ?? ""))) await type(f, "Ada Value");
await click(qa<HTMLInputElement>("input[type=checkbox]").at(-1)!, "consent"); await stroke(q<HTMLCanvasElement>("canvas")!);
await until(() => !btn(/^Sign document$/)?.disabled, "owner sign enabled"); await click(btn(/^Sign document$/), "owner sign");
await until(() => /2\/3 signed/.test(text()), "owner signature counted", 40000);
assert.ok(!btn(/^Sign document$/), "owner's sign panel is gone after signing");
step("owner signs with the owner code; progress shows 2/3 signed (Party A still outstanding)");

// verify with the library + build the PDF definition from what the owner sees
const env = await relay.fetch(rec.id);
const opened = await openEnvelope(env, rec.code, rec.fragmentSecret);
const sigs = await loadSignatures(opened); assert.equal(sigs.length, 2); assert.ok(sigs.every(isVerified), "both signatures verified");
assert.equal(sigs.find((s) => s.signerName === "Bob Builder")!.fields!["text:bob builder:company"], "Builder Co");
const audit = await loadAudit(opened, sigs); assert.ok(audit.filter((e) => e.kind === "signed").length === 2 && audit.some((e) => e.kind === "viewed"));
const dd = buildDocDefinition(opened.doc, rec.id, opened.documentSha256, sigs, audit);
const flat = JSON.stringify(dd.content); assert.ok(flat.includes("Builder Co") && flat.includes("New Mexico") && flat.includes("VERIFIED"));
step("both signatures verify (ECDSA + name binding + field hash); PDF definition carries values, clause, VERIFIED, audit");
fs.writeFileSync("/tmp/docugoat-workflow-dd.json", JSON.stringify(dd));

// burn from the vault page
await render("/vault");
await until(() => !!btn(/Burn/), "vault lists the envelope"); await click(btn(/Burn/), "burn");
await until(() => !btn(/Burn/), "burned");
await assert.rejects(relay.fetch(rec.id), /burned/); step("owner burns from the vault; relay refuses the envelope afterwards");

// ---------------------------------------------------------------- Word document path
restoreStorage({}); W.sessionStorage.clear();
const bytes = new Uint8Array(fs.readFileSync(new URL("../public/samples/sample-msa.docx", import.meta.url)));
setHandoff({ name: "Sample MSA.docx", bytes, mode: "clean" });
await render("/seal");
await until(() => /Stage 2 · Seal/.test(text()) && /MASTER SERVICES AGREEMENT/.test(text()), "seal page renders the Word doc", 30000);
step("Word document hand-off renders on the seal stage (headings + paragraphs)");
await type(qa<HTMLInputElement>("input").find((i) => i.placeholder === "Ada Lovelace")!, "Ada Lovelace");
const signerInput = qa<HTMLInputElement>("input").find((i) => i.placeholder === "Full name, then Enter")!;
await type(signerInput, "Carol Client"); await act(async () => { signerInput.dispatchEvent(new W.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await sleep(20); });
await until(() => /Carol Client/.test(text()), "signer added");
await until(() => /Review/.test(text()) && !/Spinner/.test(text()), "findings on docx");
await click(btn(/Seal & get codes/), "seal docx");
await until(() => /Codes issued/.test(text()), "docx share page", 30000);
const rec2 = loadVault()[0]; const carol = rec2.issued!.find((c) => c.name === "Carol Client")!;
step(`Word document sealed as ${rec2.id}; codes issued`);
const env2 = await relay.fetch(rec2.id); const opened2 = await openEnvelope(env2, carol.code, rec2.fragmentSecret);
assert.equal(opened2.doc.kind, "docx"); assert.equal(opened2.doc.docx!.name, "Sample MSA.docx"); assert.equal(opened2.doc.docx!.bytes, bytes.length);
step("Carol's code opens it; the original .docx travels inside the envelope with its hash");
W.localStorage.clear();
await render(`/d/${rec2.id}#k=${rec2.fragmentSecret}`);
await until(() => qa(".code-cell").length === 12, "code entry 2");
await type(qa<HTMLInputElement>(".code-cell")[0], carol.code.replace(/-/g, ""));
await until(() => /Review & sign/.test(text()), "carol unlocked", 40000);
assert.ok(btn(/Original \.docx/), "download button for the original Word file"); step("signer view offers the original .docx download");
await click(qa<HTMLInputElement>("input[type=checkbox]").at(-1)!, "consent"); await stroke(q<HTMLCanvasElement>("canvas")!);
await until(() => !btn(/^Sign document$/)?.disabled, "carol sign enabled"); await click(btn(/^Sign document$/), "carol signs");
await until(() => /You signed as/.test(text()), "carol signed", 40000);
step("Carol signs the Word document (no anchors → mark goes to the certificate)");
const sigs2 = await loadSignatures(opened2); assert.equal(sigs2.length, 1); assert.ok(isVerified(sigs2[0]));
const dd2 = buildDocDefinition(opened2.doc, rec2.id, opened2.documentSha256, sigs2, await loadAudit(opened2, sigs2));
fs.writeFileSync("/tmp/docugoat-workflow-docx-dd.json", JSON.stringify(dd2));
step("Word-document signature verifies; PDF definition built");
await relay.burn(rec2.id, rec2.ownerToken!);
console.log("\nWORKFLOW PASSED");
await act(async () => root.unmount());
process.exit(0);
