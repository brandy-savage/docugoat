import { useEffect, useState, type MutableRefObject } from "react";
import { EditorContent, useEditor, type Editor as TipTap } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { SignatureField } from "./SignatureFieldNode";
import { fieldToken, normalizeFieldTokens, type FieldKind } from "../lib/fields";
import {
  Bold, Code, Heading1, Heading2, Heading3, Italic, Link2, List, ListOrdered, Minus, Quote, Redo2, Strikethrough, Undo2,
} from "lucide-react";

export interface InsertField { kind: FieldKind; name: string; label?: string }
interface Props { value: string; onChange: (md: string) => void; insertRef?: MutableRefObject<((field: InsertField) => void) | null> }

function ToolbarButton({ active, onClick, title, children }: { active?: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-lg transition ${active ? "bg-goat-500/15 text-goat-400" : "text-bone-400 hover:bg-ink-600 hover:text-bone-100"}`}>
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: TipTap }) {
  const sep = <span className="mx-1 h-5 w-px bg-white/10" />;
  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") editor.chain().focus().unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b hairline px-3 py-2">
      <ToolbarButton title="Undo" onClick={() => editor.chain().focus().undo().run()}><Undo2 size={16} /></ToolbarButton>
      <ToolbarButton title="Redo" onClick={() => editor.chain().focus().redo().run()}><Redo2 size={16} /></ToolbarButton>
      {sep}
      <ToolbarButton title="Heading 1" active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 size={16} /></ToolbarButton>
      <ToolbarButton title="Heading 2" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={16} /></ToolbarButton>
      <ToolbarButton title="Heading 3" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 size={16} /></ToolbarButton>
      {sep}
      <ToolbarButton title="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={16} /></ToolbarButton>
      <ToolbarButton title="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={16} /></ToolbarButton>
      <ToolbarButton title="Strike" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={16} /></ToolbarButton>
      <ToolbarButton title="Inline code" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}><Code size={16} /></ToolbarButton>
      <ToolbarButton title="Link" active={editor.isActive("link")} onClick={setLink}><Link2 size={16} /></ToolbarButton>
      {sep}
      <ToolbarButton title="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={16} /></ToolbarButton>
      <ToolbarButton title="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={16} /></ToolbarButton>
      <ToolbarButton title="Quote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={16} /></ToolbarButton>
      <ToolbarButton title="Divider" onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus size={16} /></ToolbarButton>
    </div>
  );
}

export function Editor({ value, onChange, insertRef }: Props) {
  const [mode, setMode] = useState<"wysiwyg" | "raw">("wysiwyg");
  const [raw, setRaw] = useState(value);
  const [, bump] = useState(0);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Link.configure({ openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"] }),
      Placeholder.configure({ placeholder: "Write the agreement. Markdown shortcuts work: # heading, - list, **bold**…" }),
      Markdown.configure({ html: false, transformPastedText: true, transformCopiedText: true }),
      SignatureField,
    ],
    content: normalizeFieldTokens(value),
    editorProps: { attributes: { class: "tiptap prose-doc" } },
    onUpdate: ({ editor }) => {
      const md = normalizeFieldTokens(editor.storage.markdown.getMarkdown());
      setRaw(md);
      onChange(md);
    },
    onSelectionUpdate: () => bump((n) => n + 1),
    onTransaction: () => bump((n) => n + 1),
  });


  useEffect(() => {
    if (!insertRef) return;
    insertRef.current = (field: InsertField) => {
      if (mode === "raw" || !editor) {
        const text = fieldToken(field.kind, field.name, field.label);
        const next = raw.endsWith("\n") || raw === "" ? `${raw}${text}\n` : `${raw}\n\n${text}\n`;
        setRaw(next); onChange(next); editor?.commands.setContent(next);
      } else if (field.kind === "sign") {
        editor.chain().focus().createParagraphNear().insertSignatureField(field).run();
      } else {
        editor.commands.insertSignatureField(field);
      }
    };
    return () => { insertRef.current = null; };
  }, [insertRef, mode, raw, editor, onChange]);

  // External resets (template switch, draft restore) replace the editor content.
  useEffect(() => {
    if (!editor) return;
    const v = normalizeFieldTokens(value);
    if (v !== normalizeFieldTokens(editor.storage.markdown.getMarkdown()) && v !== raw) { editor.commands.setContent(v); setRaw(v); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const toRaw = () => { if (editor) setRaw(normalizeFieldTokens(editor.storage.markdown.getMarkdown())); setMode("raw"); };
  const toWysiwyg = () => { editor?.commands.setContent(raw); onChange(raw); setMode("wysiwyg"); };

  const tab = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-xs font-semibold transition ${active ? "bg-ink-600 text-bone-100" : "text-bone-500 hover:text-bone-200"}`;

  return (
    <div className="surface overflow-hidden">
      <div className="flex items-center justify-between border-b hairline px-3 py-2">
        <div className="flex gap-1 rounded-xl bg-ink-900 p-1">
          <button type="button" className={tab(mode === "wysiwyg")} onClick={toWysiwyg}>Visual</button>
          <button type="button" className={tab(mode === "raw")} onClick={toRaw}>Markdown</button>
        </div>
        <span className="text-xs text-bone-500">{mode === "raw" ? "Editing raw markdown" : "Rich editor · markdown underneath"}</span>
      </div>
      {mode === "wysiwyg" && editor ? (
        <>
          <Toolbar editor={editor} />
          <EditorContent editor={editor} />
        </>
      ) : (
        <textarea
          className="mono block min-h-[480px] w-full resize-y bg-transparent px-8 py-6 text-[13.5px] leading-6 text-bone-200 outline-none"
          value={raw}
          spellCheck={false}
          onChange={(e) => { setRaw(e.target.value); onChange(e.target.value); }}
        />
      )}
    </div>
  );
}
