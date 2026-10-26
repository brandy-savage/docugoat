// Renders the exact pdfmake definition the browser uses, through pdfmake's Node build, to validate it end to end.
import path from "node:path";
import { createRequire } from "node:module";
import { buildDocDefinition } from "../src/lib/pdf";
import { TEMPLATES } from "../src/lib/templates";

const require = createRequire(import.meta.url);
const pdfmake = require("pdfmake");
const fontsDir = path.dirname(require.resolve("pdfmake/package.json")) + "/fonts/Roboto";
pdfmake.setLocalAccessPolicy((p: string) => p.startsWith(fontsDir));
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.addFonts({ Roboto: { normal: `${fontsDir}/Roboto-Regular.ttf`, bold: `${fontsDir}/Roboto-Medium.ttf`, italics: `${fontsDir}/Roboto-Italic.ttf`, bolditalics: `${fontsDir}/Roboto-MediumItalic.ttf` } });

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const t = TEMPLATES.find((x) => x.id === "services")!;
const doc = { v: 2 as const, title: "Services Agreement", markdown: t.markdown, createdAt: new Date().toISOString(), author: "Ada", recipients: [{ slot: 0, name: "Ada", role: "owner" as const }, { slot: 1, name: "Client", role: "signer" as const }, { slot: 2, name: "Contractor", role: "signer" as const }] };
const sig = { v: 2 as const, slot: 1, signerName: "Client", signedAt: new Date().toISOString(), documentSha256: "ab".repeat(32), signatureImage: png, ecdsa: { publicKeyJwk: {}, signature: "c2ln", fingerprint: "deadbeefcafef00d" }, userAgent: "smoke", relayId: "r1", relayCreatedAt: new Date().toISOString(), hashMatches: true, ecdsaValid: true, nameBound: true, recipientName: "Client", receiptValid: null, receiptBody: null, fields: { "text:client:billing address": "12 Goat Lane, Albuquerque NM", "check:client:i have reviewed schedule a and accept the fee schedule": "yes" } };
const audit = [
  { kind: "sealed" as const, at: doc.createdAt, who: "Ada", slot: 0, ip: "203.0.113.7", userAgent: "Mozilla/5.0 (Macintosh) Firefox/131.0", attested: true },
  { kind: "viewed" as const, at: new Date().toISOString(), who: "Client", slot: 1, ip: "198.51.100.23", userAgent: "Mozilla/5.0 (iPhone) Safari/17.0", attested: true },
  { kind: "signed" as const, at: sig.signedAt, who: "Client", slot: 1, ip: "198.51.100.23", userAgent: "Mozilla/5.0 (iPhone) Safari/17.0", attested: true },
];
const dd = buildDocDefinition(doc, "smokeenvelope0123456789ab", "ab".repeat(32), [sig], audit);
const out = process.argv[2] ?? "/tmp/docugoat-smoke.pdf";
await pdfmake.createPdf(dd).write(out);
console.log("wrote", out);
