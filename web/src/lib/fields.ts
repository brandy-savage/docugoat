// Signature fields are plain markdown tokens so they survive raw editing, git, and diffing:
//   [[sign: Alice Example]]   [[date: Alice Example]]   [[initials: Alice Example]]
// Markdown serializers may escape the brackets (\[\[sign: …\]\]); every consumer tolerates that.
export type FieldKind = "sign" | "date" | "initials";
export interface Field { kind: FieldKind; name: string; raw: string }

export const FIELD_RE = /\\?\[\\?\[\s*(sign|date|initials)\s*:\s*([^\]\\]*?)\s*\\?\]\\?\]/gi;

/** Strip serializer escapes from field tokens so stored markdown is always the canonical form. */
export function normalizeFieldTokens(markdown: string): string {
  return markdown.replace(FIELD_RE, (_m, kind: string, name: string) => fieldToken(kind.toLowerCase() as FieldKind, name.trim()));
}

export function parseFields(markdown: string): Field[] {
  return [...markdown.matchAll(FIELD_RE)].map((m) => ({ kind: m[1].toLowerCase() as FieldKind, name: m[2].trim(), raw: m[0] }));
}

export function fieldToken(kind: FieldKind, name: string): string {
  return `[[${kind}: ${name}]]`;
}

export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((p) => p[0]!.toUpperCase()).join("");
}
