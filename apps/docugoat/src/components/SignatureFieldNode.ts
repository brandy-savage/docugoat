// Inline atom node so signature fields are chips in the visual editor rather than escapable text.
// Serializes to / parses from the [[kind: name]] markdown token via tiptap-markdown hooks.
import { Node, mergeAttributes } from "@tiptap/core";
import { FIELD_LABEL, fieldToken, type FieldKind } from "../lib/fields";

const INLINE_TOKEN = /^\[\[\s*(sign|date|initials|text|check)\s*:\s*([^\]|]*?)\s*(?:\|\s*([^\]]*?)\s*)?\]\]/i;
const LABEL = FIELD_LABEL;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    signatureField: { insertSignatureField: (attrs: { kind: FieldKind; name: string; label?: string }) => ReturnType };
  }
}

export const SignatureField = Node.create({
  name: "signatureField",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return { kind: { default: "sign" }, name: { default: "" }, label: { default: "" } };
  },

  parseHTML() {
    return [{
      tag: "span[data-sig-field]",
      getAttrs: (el) => ({ kind: (el as HTMLElement).getAttribute("data-kind") ?? "sign", name: (el as HTMLElement).getAttribute("data-name") ?? "", label: (el as HTMLElement).getAttribute("data-label") ?? "" }),
    }];
  },

  renderHTML({ node }) {
    const kind = node.attrs.kind as FieldKind;
    const name = String(node.attrs.name ?? "");
    const label = String(node.attrs.label ?? "");
    return [
      "span",
      mergeAttributes({ "data-sig-field": "", "data-kind": kind, "data-name": name, "data-label": label, class: `field-chip field-chip-${kind}`, contenteditable: "false" }),
      ["span", { class: "field-chip-label" }, label || LABEL[kind]],
      ["span", { class: "field-chip-name" }, (label ? `${LABEL[kind]} · ` : "") + (name || "Signer")],
    ];
  },

  addCommands() {
    return {
      insertSignatureField: (attrs) => ({ chain }) =>
        chain().focus().insertContent([{ type: this.name, attrs }, { type: "text", text: " " }]).run(),
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write(fieldToken(node.attrs.kind, node.attrs.name, node.attrs.label));
        },
        parse: {
          setup(md: any) {
            md.inline.ruler.before("link", "sig_field", (state: any, silent: boolean) => {
              if (state.src.charCodeAt(state.pos) !== 0x5b || state.src.charCodeAt(state.pos + 1) !== 0x5b) return false;
              const m = INLINE_TOKEN.exec(state.src.slice(state.pos));
              if (!m) return false;
              if (!silent) {
                const t = state.push("sig_field", "", 0);
                t.meta = { kind: m[1].toLowerCase(), name: m[2].trim(), label: (m[3] ?? "").trim() };
              }
              state.pos += m[0].length;
              return true;
            });
            md.renderer.rules.sig_field = (tokens: any[], idx: number) => {
              const { kind, name, label } = tokens[idx].meta;
              return `<span data-sig-field data-kind="${esc(kind)}" data-name="${esc(name)}" data-label="${esc(label)}"></span>`;
            };
          },
        },
      },
    };
  },
});
