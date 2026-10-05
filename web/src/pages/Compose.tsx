import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CalendarDays, CheckSquare, Eye, FileSignature, Lock, PenLine, Plus, ShieldAlert, TextCursorInput, Type, X } from "lucide-react";
import { DocumentView } from "../components/DocumentView";
import { Editor, type InsertField } from "../components/Editor";
import { Field, Spinner, Toast } from "../components/ui";
import { sealDocument } from "../lib/envelope";
import { FIELD_RE, fieldToken, parseFields, sameName } from "../lib/fields";
import { titleFromMarkdown } from "../lib/markdown";
import { TEMPLATES } from "../lib/templates";
import { clearDraft, loadDraft, loadVault, saveDraft } from "../lib/vault";
import { BACKEND, getSession, setSession } from "../lib/config";
import { saveAccount } from "../lib/account";

export function Compose() {
  const nav = useNavigate();
  const draft = useMemo(loadDraft, []);
  const [markdown, setMarkdown] = useState(draft?.markdown ?? TEMPLATES[1].markdown);
  const [author, setAuthor] = useState(draft?.author ?? localStorage.getItem("docugoat.author") ?? "");
  const [signers, setSigners] = useState<string[]>(draft?.recipients ?? TEMPLATES[1].signers);
  const [authorSigns, setAuthorSigns] = useState(true);
  const [signerDraft, setSignerDraft] = useState("");
  const [ttl, setTtl] = useState(30);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ m: string; tone?: "bad" | "good" } | null>(null);
  const [restored, setRestored] = useState(!!draft);
  const insertRef = useRef<((field: InsertField) => void) | null>(null);

  const title = titleFromMarkdown(markdown);
  const fields = useMemo(() => parseFields(markdown), [markdown]);
  const parties = authorSigns && author.trim() ? [author.trim(), ...signers.filter((s) => !sameName(s, author))] : signers;
  const missingFields = parties.filter((s) => !fields.some((f) => f.kind === "sign" && sameName(f.name, s)));
  const orphanFields = fields.filter((f) => f.name && !parties.some((s) => sameName(s, f.name)));
  const words = markdown.split(/\s+/).filter(Boolean).length;

  useEffect(() => { const t = setTimeout(() => saveDraft({ markdown, author, recipients: signers }), 500); return () => clearTimeout(t); }, [markdown, author, signers]);

  function applyTemplate(id: string) {
    const t = TEMPLATES.find((x) => x.id === id)!;
    const untouched = TEMPLATES.some((x) => x.markdown === markdown);
    if (!untouched && markdown.trim() && !confirm("Replace the current document with this template?")) return;
    setMarkdown(t.markdown); setSigners(t.signers); setRestored(false);
  }
  function addSigner(v = signerDraft) {
    const n = v.trim();
    if (n && !signers.some((s) => sameName(s, n))) setSigners([...signers, n]);
    setSignerDraft("");
  }
  function insert(kind: "sign" | "date" | "initials" | "text" | "check", name: string) {
    if (kind === "text" || kind === "check") {
      const label = window.prompt(kind === "text" ? "Label for this text field (e.g. Company name, Address, Title)" : "Checkbox statement (e.g. I have read Schedule A)", "");
      if (label === null) return;
      insertRef.current?.({ kind, name, label: label.trim() || (kind === "text" ? "Text" : "I agree") });
      return;
    }
    insertRef.current?.({ kind, name });
  }
  /** Rename a party everywhere: the signer list and every field token that references them. */
  function rename(from: string, to: string) {
    const next = to.trim();
    if (!next || sameName(from, next)) { if (next !== from) setSigners(signers.map((x) => (x === from ? next || from : x))); return; }
    setSigners(signers.map((x) => (x === from ? next : x)));
    setMarkdown(markdown.replace(FIELD_RE, (m, kind: string, name: string) => (sameName(name, from) ? fieldToken(kind.toLowerCase() as "sign", next) : m)));
  }

  const needsAccount = BACKEND === "github" && !getSession();

  async function seal() {
    if (needsAccount) return setToast({ m: "Sign in first — sealing writes to the GitHub store.", tone: "bad" });
    if (!markdown.trim()) return setToast({ m: "Write something first.", tone: "bad" });
    if (!author.trim()) return setToast({ m: "Add your name — it's sealed into the document as the sender.", tone: "bad" });
    setBusy(true);
    try {
      localStorage.setItem("docugoat.author", author.trim());
      const res = await sealDocument({ title, markdown, author: author.trim(), authorSigns, signerNames: signers.filter((s) => !sameName(s, author)), ttlDays: ttl });
      clearDraft();
      const session = getSession();
      if (session) setSession(await saveAccount(session, loadVault()).catch(() => session));
      nav(`/share/${res.id}`, { state: res });
    } catch (e) {
      setToast({ m: e instanceof Error ? e.message : "Sealing failed", tone: "bad" });
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      {needsAccount && (
        <div className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-goat-500/30 bg-goat-500/10 px-5 py-3 text-sm">
          <span>Drafting is local. To seal and issue codes you need your vault unlocked — it holds the GitHub write token.</span>
          <Link to="/account" className="btn-primary btn-sm shrink-0">Sign in</Link>
        </div>
      )}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow">New envelope</p>
          <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-xs text-bone-500">{words} words · {fields.length} field{fields.length === 1 ? "" : "s"} · {restored ? "draft restored from this device" : "draft autosaves on this device"} · nothing uploads until you seal</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={preview ? "btn-secondary" : "btn-ghost"} onClick={() => setPreview(!preview)}><Eye size={15} /> {preview ? "Back to editor" : "Preview as signer"}</button>
          <button className="btn-primary" disabled={busy} onClick={seal}>
            {busy ? <><Spinner /> Sealing on-device…</> : <><Lock size={15} /> Seal &amp; get codes</>}
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {preview ? (
          <div className="surface overflow-hidden"><DocumentView markdown={markdown} ctx={{ viewerName: signers[0] ?? "" }} /></div>
        ) : (
          <Editor value={markdown} onChange={setMarkdown} insertRef={insertRef} />
        )}

        <aside className="space-y-5">
          <div className="surface p-5">
            <p className="eyebrow mb-3">Template</p>
            <div className="grid grid-cols-2 gap-2">
              {TEMPLATES.map((t) => (
                <button key={t.id} type="button" onClick={() => applyTemplate(t.id)}
                  className={`rounded-xl border p-3 text-left transition hover:border-goat-500/50 ${markdown === t.markdown ? "border-goat-500/60 bg-goat-500/5" : "hairline bg-ink-900"}`}>
                  <span className="block text-sm font-semibold">{t.name}</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-bone-500">{t.blurb}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="surface space-y-4 p-5">
            <p className="eyebrow">Parties</p>
            <Field label="Your name (sender)" hint="Sealed inside the document. You get an owner code and sign from your own view.">
              <input className="input" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Ada Lovelace" />
            </Field>
            <label className="flex cursor-pointer items-center gap-2.5 text-sm">
              <input type="checkbox" className="accent-goat-500" checked={authorSigns} onChange={(e) => setAuthorSigns(e.target.checked)} />
              I'm a signing party too
            </label>
            {authorSigns && author.trim() && !preview && (
              <div className="rounded-xl border border-goat-500/25 bg-goat-500/5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{author.trim()} <span className="text-xs text-bone-500">(you)</span></span>
                  <span className={`text-[10px] font-semibold uppercase tracking-wider ${fields.some((f) => f.kind === "sign" && sameName(f.name, author)) ? "text-moss-400" : "text-goat-400"}`}>{fields.some((f) => f.kind === "sign" && sameName(f.name, author)) ? "has field" : "no field"}</span>
                </div>
                <div className="mt-2 flex gap-1.5">
                  <button type="button" className="btn-secondary btn-sm" onClick={() => insert("sign", author.trim())}><PenLine size={12} /> Signature</button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => insert("date", author.trim())}><CalendarDays size={12} /> Date</button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => insert("initials", author.trim())}><Type size={12} /> Initials</button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => insert("text", author.trim())}><TextCursorInput size={12} /> Text</button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => insert("check", author.trim())}><CheckSquare size={12} /> Checkbox</button>
                </div>
              </div>
            )}
            <div>
              <span className="label">Other signers — one code each · click a name to rename</span>
              <div className="flex gap-2">
                <input className="input" value={signerDraft} onChange={(e) => setSignerDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addSigner(); } }} placeholder="Full name, then Enter" />
                <button type="button" className="btn-secondary px-3" onClick={() => addSigner()}><Plus size={15} /></button>
              </div>
              <ul className="mt-3 space-y-2">
                {signers.map((s) => {
                  const has = fields.some((f) => f.kind === "sign" && sameName(f.name, s));
                  return (
                    <li key={s} className="rounded-xl border hairline bg-ink-900 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <input className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none focus:text-goat-300" defaultValue={s} title="Rename — fields update too"
                          onBlur={(e) => rename(s, e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                        <div className="flex items-center gap-1">
                          <span className={`text-[10px] font-semibold uppercase tracking-wider ${has ? "text-moss-400" : "text-goat-400"}`}>{has ? "has field" : "no field"}</span>
                          <button type="button" className="btn-ghost btn-sm px-1.5" onClick={() => setSigners(signers.filter((x) => x !== s))}><X size={13} /></button>
                        </div>
                      </div>
                      {!preview && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <button type="button" className="btn-secondary btn-sm" onClick={() => insert("sign", s)} title="Insert signature field"><PenLine size={12} /> Signature</button>
                          <button type="button" className="btn-secondary btn-sm" onClick={() => insert("date", s)} title="Insert date field"><CalendarDays size={12} /> Date</button>
                          <button type="button" className="btn-secondary btn-sm" onClick={() => insert("initials", s)} title="Insert initials field"><Type size={12} /> Initials</button>
                          <button type="button" className="btn-secondary btn-sm" onClick={() => insert("text", s)} title="Insert a fillable text field"><TextCursorInput size={12} /> Text</button>
                          <button type="button" className="btn-secondary btn-sm" onClick={() => insert("check", s)} title="Insert a checkbox"><CheckSquare size={12} /> Checkbox</button>
                        </div>
                      )}
                    </li>
                  );
                })}
                {signers.length === 0 && (
                  <li className="rounded-xl border border-dashed hairline p-3 text-xs leading-5 text-bone-500">
                    No other signers yet. Add each counterparty by name — they each get their own code. With none, one open code is issued and whoever holds it types their name.
                  </li>
                )}
              </ul>
              {(missingFields.length > 0 || orphanFields.length > 0) && (
                <div className="mt-3 space-y-1 rounded-xl border border-goat-500/20 bg-goat-500/5 p-3 text-xs leading-5 text-bone-400">
                  {missingFields.length > 0 && <p><ShieldAlert size={12} className="mr-1 inline text-goat-400" /> No signature field yet for {missingFields.join(", ")}. They can still sign — the mark lands on the certificate page.</p>}
                  {orphanFields.length > 0 && <p><ShieldAlert size={12} className="mr-1 inline text-goat-400" /> Fields reference {[...new Set(orphanFields.map((f) => f.name))].join(", ")} who aren't listed as signers.</p>}
                </div>
              )}
            </div>
          </div>

          <div className="surface space-y-4 p-5">
            <p className="eyebrow">Envelope</p>
            <Field label="Expires after">
              <select className="input" value={ttl} onChange={(e) => setTtl(Number(e.target.value))}>
                <option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option>
              </select>
            </Field>
            <p className="flex items-start gap-2 text-[11px] leading-5 text-bone-500"><FileSignature size={13} className="mt-0.5 shrink-0" /> Fields are plain markdown tokens — <span className="kbd">[[sign: Name]]</span>, <span className="kbd">[[date: Name]]</span>, <span className="kbd">[[initials: Name]]</span>, <span className="kbd">[[text: Name | Label]]</span>, <span className="kbd">[[check: Name | Statement]]</span>. Type them by hand in Markdown mode if you prefer. Dates are stamped automatically when that person signs.</p>
          </div>
        </aside>
      </div>
      {toast && <Toast message={toast.m} tone={toast.tone} onDone={() => setToast(null)} />}
    </div>
  );
}
