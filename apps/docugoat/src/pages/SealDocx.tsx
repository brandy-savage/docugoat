import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Lock, PenLine, Plus, ShieldAlert, X } from "lucide-react";
import { DocumentView } from "../components/DocumentView";
import { Findings } from "../components/Findings";
import { Field, Spinner, Toast } from "../components/ui";
import { saveAccount } from "../lib/account";
import { BACKEND, getSession, setSession } from "../lib/config";
import { MAX_DOCX_BYTES, docxSource, docxToMarkdown, type DocxSource } from "../lib/docxDoc";
import { sealDocument } from "../lib/envelope";
import { parseFields, sameName } from "../lib/fields";
import { setHandoff, takeHandoff } from "../lib/handoff";
import { loadVault } from "../lib/vault";

/** Stage 2 for Word documents: who signs, then seal. Fields are [[sign: Name]] anchors typed into the Word file. */
export function SealDocx() {
  const nav = useNavigate();
  const handoff = useMemo(takeHandoff, []);
  const [src, setSrc] = useState<DocxSource | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState(() => localStorage.getItem("docugoat.author") ?? "");
  const [authorSigns, setAuthorSigns] = useState(true);
  const [signers, setSigners] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [ttl, setTtl] = useState(30);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ m: string; tone?: "bad" | "good" } | null>(null);

  useEffect(() => {
    if (!handoff) return;
    (async () => {
      const { markdown, title } = await docxToMarkdown(handoff.bytes);
      setMarkdown(markdown); setTitle(title);
      setSrc(await docxSource(handoff.name, handoff.bytes));
      const names = [...new Set(parseFields(markdown).map((f) => f.name).filter(Boolean))];
      setSigners(names.filter((n) => !sameName(n, author)));
    })().catch((e) => setToast({ m: e instanceof Error ? e.message : "Could not read the document", tone: "bad" }));
  }, [handoff, author]);

  const fields = useMemo(() => parseFields(markdown), [markdown]);
  const needsAccount = BACKEND === "github" && !getSession();

  if (!handoff) {
    return (
      <div className="mx-auto max-w-lg px-5 py-24 text-center">
        <h1 className="text-xl font-semibold">Nothing to seal yet</h1>
        <p className="mt-2 text-sm text-bone-500">Review a Word document first, then send it for signature.</p>
        <Link to="/review" className="btn-primary mt-6">Open the reviewer</Link>
      </div>
    );
  }

  async function seal() {
    if (!src) return;
    if (needsAccount) return setToast({ m: "Sign in first — sealing writes to the GitHub store.", tone: "bad" });
    if (!author.trim()) return setToast({ m: "Add your name.", tone: "bad" });
    if (src.bytes > MAX_DOCX_BYTES) return setToast({ m: `This file is ${Math.round(src.bytes / 1024)} KB; the limit is ${Math.round(MAX_DOCX_BYTES / 1024)} KB. Remove embedded images and try again.`, tone: "bad" });
    setBusy(true);
    try {
      localStorage.setItem("docugoat.author", author.trim());
      const res = await sealDocument({ title, markdown, author: author.trim(), authorSigns, signerNames: signers, ttlDays: ttl, docx: src });
      const session = getSession();
      if (session) setSession(await saveAccount(session, loadVault()).catch(() => session));
      setHandoff(null);
      nav(`/share/${res.id}`, { state: res });
    } catch (e) { setToast({ m: e instanceof Error ? e.message : "Sealing failed", tone: "bad" }); setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow">Stage 2 · Seal</p>
          <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight">{title || handoff.name}</h1>
          <p className="mt-1 text-xs text-bone-500">{handoff.name} · {src ? `${Math.round(src.bytes / 1024)} KB` : "…"} · {handoff.mode === "tracked" ? "with tracked changes" : "clean copy"} · {fields.length} signature anchor{fields.length === 1 ? "" : "s"} found</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/review" className="btn-ghost">Back to review</Link>
          <button className="btn-primary" disabled={busy || !src} onClick={seal}>{busy ? <><Spinner /> Sealing on-device…</> : <><Lock size={15} /> Seal &amp; get codes</>}</button>
        </div>
      </div>

      {needsAccount && (
        <div className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-goat-500/30 bg-goat-500/10 px-5 py-3 text-sm">
          <span>To seal and issue codes you need your vault unlocked — it holds the GitHub write token.</span>
          <Link to="/account" className="btn-primary btn-sm shrink-0">Sign in</Link>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="surface overflow-hidden">
          <div className="border-b hairline px-5 py-2 text-xs text-bone-500">Signer view. The original Word file travels encrypted alongside this rendering and can be downloaded by every party.</div>
          {markdown ? <DocumentView markdown={markdown} ctx={{ viewerName: signers[0] ?? "" }} /> : <div className="grid h-40 place-items-center"><Spinner /></div>}
        </div>

        <aside className="space-y-5">
          <div className="surface space-y-4 p-5">
            <p className="eyebrow">Parties</p>
            <Field label="Your name (sender)"><input className="input" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Ada Lovelace" /></Field>
            <label className="flex cursor-pointer items-center gap-2.5 text-sm"><input type="checkbox" className="accent-goat-500" checked={authorSigns} onChange={(e) => setAuthorSigns(e.target.checked)} /> I'm a signing party too</label>
            <div>
              <span className="label">Other signers — one code each</span>
              <div className="flex gap-2">
                <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (draft.trim()) setSigners([...signers, draft.trim()]); setDraft(""); } }} placeholder="Full name, then Enter" />
                <button type="button" className="btn-secondary px-3" onClick={() => { if (draft.trim()) setSigners([...signers, draft.trim()]); setDraft(""); }}><Plus size={15} /></button>
              </div>
              <ul className="mt-3 space-y-2">
                {signers.map((s) => {
                  const has = fields.some((f) => f.kind === "sign" && sameName(f.name, s));
                  return (
                    <li key={s} className="flex items-center justify-between rounded-xl border hairline bg-ink-900 px-3 py-2 text-sm">
                      <span className="truncate">{s}</span>
                      <span className="flex items-center gap-2">
                        <span className={`text-[10px] font-semibold uppercase tracking-wider ${has ? "text-moss-400" : "text-goat-400"}`}>{has ? "has anchor" : "no anchor"}</span>
                        <button type="button" className="btn-ghost btn-sm px-1.5" onClick={() => setSigners(signers.filter((x) => x !== s))}><X size={13} /></button>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 flex items-start gap-2 text-[11px] leading-5 text-bone-500"><PenLine size={13} className="mt-0.5 shrink-0" /> Signature spots are text anchors typed into the Word file: <span className="kbd">[[sign: Name]]</span>, <span className="kbd">[[date: Name]]</span>, <span className="kbd">[[text: Name | Label]]</span>. Signers without an anchor still sign; their mark lands on the certificate page.</p>
              {signers.some((s) => !fields.some((f) => f.kind === "sign" && sameName(f.name, s))) && (
                <p className="mt-2 flex items-start gap-2 rounded-xl border border-goat-500/20 bg-goat-500/5 p-3 text-xs leading-5 text-bone-400"><ShieldAlert size={13} className="mt-0.5 shrink-0 text-goat-400" /> Add anchors in the reviewer (edit a paragraph, type the token) if you want marks inside the document.</p>
              )}
            </div>
          </div>

          <Findings markdown={markdown} />

          <div className="surface space-y-4 p-5">
            <p className="eyebrow">Envelope</p>
            <Field label="Expires after">
              <select className="input" value={ttl} onChange={(e) => setTtl(Number(e.target.value))}><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select>
            </Field>
          </div>
        </aside>
      </div>
      {toast && <Toast message={toast.m} tone={toast.tone} onDone={() => setToast(null)} />}
    </div>
  );
}
