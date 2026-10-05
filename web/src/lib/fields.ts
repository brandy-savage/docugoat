// Fields are plain markdown tokens so they survive raw editing, git, and diffing:
//   [[sign: Alice]]  [[date: Alice]]  [[initials: Alice]]  [[text: Alice | Company name]]  [[check: Alice | I accept Schedule A]]
// Markdown serializers may escape the brackets (\[\[sign: …\]\]); every consumer tolerates that.
export type FieldKind = "sign" | "date" | "initials" | "text" | "check";
export interface Field { kind: FieldKind; name: string; label: string; raw: string }

export const FIELD_RE = /\\?\[\\?\[\s*(sign|date|initials|text|check)\s*:\s*([^\]\\|]*?)\s*(?:\|\s*([^\]\\]*?)\s*)?\\?\]\\?\]/gi;

export const FIELD_LABEL: Record<FieldKind, string> = { sign: "Signature", date: "Date", initials: "Initials", text: "Text", check: "Checkbox" };

/** Fields the signer actively fills in (everything except the auto-stamped date). */
export const INPUT_KINDS: FieldKind[] = ["text", "check"];

export function fieldToken(kind: FieldKind, name: string, label = ""): string {
  return label ? `[[${kind}: ${name} | ${label}]]` : `[[${kind}: ${name}]]`;
}

/** Strip serializer escapes from field tokens so stored markdown is always the canonical form. */
export function normalizeFieldTokens(markdown: string): string {
  return markdown.replace(FIELD_RE, (_m, kind: string, name: string, label?: string) => fieldToken(kind.toLowerCase() as FieldKind, name.trim(), (label ?? "").trim()));
}

export function parseFields(markdown: string): Field[] {
  return [...markdown.matchAll(FIELD_RE)].map((m) => ({ kind: m[1].toLowerCase() as FieldKind, name: m[2].trim(), label: (m[3] ?? "").trim(), raw: m[0] }));
}

/** Stable key for a fillable field's value inside a signature bundle. */
export function fieldKey(f: { kind: FieldKind; name: string; label: string }): string {
  return `${f.kind}:${f.name.trim().toLowerCase()}:${f.label.trim().toLowerCase()}`;
}

export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((p) => p[0]!.toUpperCase()).join("");
}
