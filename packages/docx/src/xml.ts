// A minimal, offset-preserving XML parser.
//
// The exporter never re-serializes a part from a DOM. It splices replacement
// text into the original source string, so every node records the exact
// character range it occupies. Only what OOXML parts need is supported:
// elements, attributes, text, comments, CDATA, processing instructions and a
// doctype (skipped).

export interface XmlElement {
  kind: 'element';
  name: string;
  attrs: Record<string, string>;
  /** Offset of the opening `<`. */
  start: number;
  /** Offset just past the start tag's `>`. */
  openEnd: number;
  /** Offset of the closing tag's `<` (equals `openEnd` when self-closing). */
  closeStart: number;
  /** Offset just past the element's final `>`. */
  end: number;
  selfClosing: boolean;
  children: XmlNode[];
  parent: XmlElement | null;
}

export interface XmlText {
  kind: 'text';
  start: number;
  end: number;
  /** Entity-decoded text (CDATA content is taken literally). */
  value: string;
}

export type XmlNode = XmlElement | XmlText;

export interface XmlDocument {
  source: string;
  root: XmlElement;
}

export class XmlParseError extends Error {
  constructor(message: string, readonly offset: number) {
    super(`${message} at offset ${offset}`);
    this.name = 'XmlParseError';
  }
}

export function parseXml(source: string): XmlDocument {
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  let i = 0;
  const n = source.length;

  const appendText = (start: number, end: number, value: string) => {
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push({ kind: 'text', start, end, value });
  };

  while (i < n) {
    const lt = source.indexOf('<', i);
    if (lt === -1) {
      appendText(i, n, decodeEntities(source.slice(i, n)));
      break;
    }
    if (lt > i) appendText(i, lt, decodeEntities(source.slice(i, lt)));

    if (source.startsWith('<!--', lt)) {
      i = expectIndex(source, '-->', lt, 'Unterminated comment') + 3;
    } else if (source.startsWith('<![CDATA[', lt)) {
      const close = expectIndex(source, ']]>', lt, 'Unterminated CDATA');
      appendText(lt, close + 3, source.slice(lt + 9, close));
      i = close + 3;
    } else if (source.startsWith('<?', lt)) {
      i = expectIndex(source, '?>', lt, 'Unterminated processing instruction') + 2;
    } else if (source.startsWith('<!', lt)) {
      i = expectIndex(source, '>', lt, 'Unterminated declaration') + 1;
    } else if (source.startsWith('</', lt)) {
      const gt = expectIndex(source, '>', lt, 'Unterminated end tag');
      const name = source.slice(lt + 2, gt).trim();
      const open = stack.pop();
      if (!open || open.name !== name) {
        throw new XmlParseError(`Mismatched end tag </${name}>`, lt);
      }
      open.closeStart = lt;
      open.end = gt + 1;
      i = gt + 1;
    } else {
      const el = parseStartTag(source, lt);
      const parent = stack[stack.length - 1] ?? null;
      el.parent = parent;
      if (parent) parent.children.push(el);
      else if (root) throw new XmlParseError('Multiple root elements', lt);
      else root = el;
      if (!el.selfClosing) stack.push(el);
      i = el.openEnd;
    }
  }

  if (stack.length > 0) {
    const open = stack[stack.length - 1]!;
    throw new XmlParseError(`Unclosed element <${open.name}>`, open.start);
  }
  if (!root) throw new XmlParseError('No root element', 0);
  return { source, root };
}

function parseStartTag(source: string, lt: number): XmlElement {
  let i = lt + 1;
  const nameStart = i;
  while (i < source.length && !/[\s/>]/.test(source[i]!)) i++;
  const name = source.slice(nameStart, i);
  if (!name) throw new XmlParseError('Empty element name', lt);

  const attrs: Record<string, string> = {};
  for (;;) {
    while (i < source.length && /\s/.test(source[i]!)) i++;
    const ch = source[i];
    if (ch === undefined) throw new XmlParseError('Unterminated start tag', lt);
    if (ch === '>' || (ch === '/' && source[i + 1] === '>')) break;

    const attrStart = i;
    while (i < source.length && !/[\s=/>]/.test(source[i]!)) i++;
    const attrName = source.slice(attrStart, i);
    while (/\s/.test(source[i] ?? '')) i++;
    if (source[i] !== '=') throw new XmlParseError(`Attribute ${attrName} has no value`, i);
    i++;
    while (/\s/.test(source[i] ?? '')) i++;
    const quote = source[i];
    if (quote !== '"' && quote !== "'") throw new XmlParseError('Unquoted attribute value', i);
    const close = source.indexOf(quote, i + 1);
    if (close === -1) throw new XmlParseError('Unterminated attribute value', i);
    attrs[attrName] = decodeEntities(source.slice(i + 1, close));
    i = close + 1;
  }

  const selfClosing = source[i] === '/';
  const openEnd = selfClosing ? i + 2 : i + 1;
  return {
    kind: 'element',
    name,
    attrs,
    start: lt,
    openEnd,
    closeStart: openEnd,
    end: openEnd,
    selfClosing,
    children: [],
    parent: null,
  };
}

function expectIndex(source: string, token: string, from: number, message: string): number {
  const idx = source.indexOf(token, from);
  if (idx === -1) throw new XmlParseError(message, from);
  return idx;
}

const NAMED_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

export function decodeEntities(raw: string): string {
  if (!raw.includes('&')) return raw;
  return raw.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x')) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(parseInt(body.slice(1), 10));
    return NAMED_ENTITIES[body] ?? whole;
  });
}

export function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(text: string): string {
  return escapeText(text).replace(/"/g, '&quot;');
}

/** Element children only, optionally filtered by qualified name. */
export function childElements(el: XmlElement, name?: string): XmlElement[] {
  const out: XmlElement[] = [];
  for (const child of el.children) {
    if (child.kind === 'element' && (name === undefined || child.name === name)) out.push(child);
  }
  return out;
}

export function firstChild(el: XmlElement, name: string): XmlElement | undefined {
  return childElements(el, name)[0];
}

/** Depth-first search for descendants with the given name. */
export function findDescendants(el: XmlElement, name: string): XmlElement[] {
  const out: XmlElement[] = [];
  const visit = (node: XmlElement) => {
    for (const child of node.children) {
      if (child.kind !== 'element') continue;
      if (child.name === name) out.push(child);
      visit(child);
    }
  };
  visit(el);
  return out;
}

export function hasAncestor(el: XmlElement, name: string): boolean {
  for (let p = el.parent; p; p = p.parent) if (p.name === name) return true;
  return false;
}

export function sourceOf(doc: XmlDocument, el: XmlElement): string {
  return doc.source.slice(el.start, el.end);
}
