// Render a saved pdfmake definition (from the workflow run) to a real PDF through pdfmake's Node printer.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pdfmake = require("pdfmake");
const fontsDir = path.dirname(require.resolve("pdfmake/package.json")) + "/fonts/Roboto";
pdfmake.setLocalAccessPolicy((p: string) => p.startsWith(fontsDir)); pdfmake.setUrlAccessPolicy(() => false);
pdfmake.addFonts({ Roboto: { normal: `${fontsDir}/Roboto-Regular.ttf`, bold: `${fontsDir}/Roboto-Medium.ttf`, italics: `${fontsDir}/Roboto-Italic.ttf`, bolditalics: `${fontsDir}/Roboto-MediumItalic.ttf` } });
const [inp, out] = process.argv.slice(2);
const dd = JSON.parse(fs.readFileSync(inp!, "utf8"));
dd.footer = undefined; // the browser build attaches a function; not serializable
await pdfmake.createPdf(dd).write(out!);
console.log("wrote", out);
