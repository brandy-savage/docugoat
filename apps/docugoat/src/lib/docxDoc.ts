// Word documents in docugoat: the original bytes travel inside the envelope, and a derived markdown
// rendering (one block per paragraph, headings kept) drives everything the app already knows how to
// do with markdown — fields, findings, the signer view, the PDF.
import { openDocx } from "@docugoat/docx/document";
import { currentBlocks } from "@docugoat/review/bridge";
import { sha256Hex, toB64, fromB64 } from "./crypto";

export interface DocxSource { name: string; b64: string; sha256: string; bytes: number }

export async function docxToMarkdown(bytes: Uint8Array): Promise<{ markdown: string; title: string }> {
  const docx = openDocx(bytes);
  const blocks = currentBlocks(docx, []);
  const lines: string[] = [];
  let title = "";
  for (const b of blocks) {
    const text = b.text.trim();
    if (!text) continue;
    if (b.heading) {
      if (!title) { title = text; lines.push(`# ${text}`); } else lines.push(`## ${text}`);
    } else lines.push(text);
  }
  if (!title) { title = blocks.find((b) => b.text.trim())?.text.trim().slice(0, 80) ?? "Word document"; }
  return { markdown: lines.join("\n\n") + "\n", title };
}

export async function docxSource(name: string, bytes: Uint8Array): Promise<DocxSource> {
  return { name, b64: toB64(bytes), sha256: await sha256Hex(toB64(bytes)), bytes: bytes.length };
}

export function docxBlob(src: DocxSource): Blob {
  return new Blob([fromB64(src.b64)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

/** The GitHub Contents API refuses reads above 1 MB; keep room for base64 and the envelope wrapper. */
export const MAX_DOCX_BYTES = 650 * 1024;
