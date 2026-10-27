import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, FileSearch, Upload, Wand2 } from "lucide-react";
import { Pill } from "./ui";
import { SAMPLE_PACK, STORED_PACK, applyChange, fillTemplate, loadPack, loadVars, planFor, reviewMarkdown, saveVars, templateVariables, type ClauseTemplate, type DocumentType, type Finding, type Perspective, type Rulepack } from "../lib/review";

const DOC_TYPES: { v: DocumentType; l: string }[] = [{ v: "nda", l: "NDA" }, { v: "msa", l: "MSA" }, { v: "sow", l: "SOW" }, { v: "other", l: "Other" }];
const PERSPECTIVES: { v: Perspective; l: string }[] = [
  { v: "mutual", l: "Mutual" }, { v: "discloser", l: "Discloser" }, { v: "recipient", l: "Recipient" }, { v: "customer", l: "Customer" }, { v: "service_provider", l: "Service provider" },
];
const TONE = { high: "bad", medium: "warn", low: "neutral", info: "neutral" } as const;

export function Findings({ markdown, onChange }: { markdown: string; onChange?: (markdown: string) => void }) {
  const deferred = useDeferredValue(markdown);
  const [docType, setDocType] = useState<DocumentType>(() => (localStorage.getItem("docugoat.review.docType") as DocumentType) || "nda");
  const [perspective, setPerspective] = useState<Perspective>(() => (localStorage.getItem("docugoat.review.perspective") as Perspective) || "mutual");
  const [pack, setPack] = useState<Rulepack>(() => { try { const s = localStorage.getItem(STORED_PACK); return s ? (loadPack(s).pack ?? SAMPLE_PACK) : SAMPLE_PACK; } catch { return SAMPLE_PACK; } });
  const [open, setOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  function apply(f: Finding, t: ClauseTemplate) {
    if (!onChange) return;
    const vars = loadVars();
    for (const name of templateVariables(t.text)) {
      if (!vars[name]?.trim()) {
        const v = window.prompt(`Value for {{${name}}}`, "");
        if (v === null) return;
        vars[name] = v.trim();
      }
    }
    saveVars(vars);
    const { text, missing } = fillTemplate(t.text, vars);
    if (missing.length) return setError(`Missing values: ${missing.join(", ")}`);
    const res = applyChange(markdown, planFor(t, f, markdown, text));
    onChange(res.markdown);
    setNote(`${t.title}: ${res.note}`);
    setError(null);
  }
  const templatesFor = (f: Finding) => f.templateIds.map((id) => pack.templates.find((t) => t.id === id)).filter((t): t is ClauseTemplate => !!t);

  useEffect(() => { localStorage.setItem("docugoat.review.docType", docType); localStorage.setItem("docugoat.review.perspective", perspective); }, [docType, perspective]);

  const result = useMemo(() => reviewMarkdown(deferred, pack, docType, perspective), [deferred, pack, docType, perspective]);
  const counts = useMemo(() => result.findings.reduce((m, f) => ({ ...m, [f.severity]: (m[f.severity] ?? 0) + 1 }), {} as Record<string, number>), [result]);
  const missing = result.coverage.filter((c) => c.state !== "located" && !result.findings.some((f) => f.ruleId === c.ruleId));

  async function importPack(f: File) {
    const { pack: p, errors } = loadPack(await f.text());
    if (!p) return setError(errors.slice(0, 3).join(" · ") || "Invalid rulepack");
    setPack(p); setError(null); localStorage.setItem(STORED_PACK, JSON.stringify(p));
  }

  return (
    <div className="surface p-5">
      <button type="button" className="flex w-full items-center justify-between" onClick={() => setOpen(!open)}>
        <span className="eyebrow flex items-center gap-2"><FileSearch size={13} /> Review</span>
        <span className="flex gap-1">
          {counts.high ? <Pill tone="bad">{counts.high} high</Pill> : null}
          {counts.medium ? <Pill tone="warn">{counts.medium} med</Pill> : null}
          {!result.findings.length && !missing.length && <Pill tone="good">clean</Pill>}
        </span>
      </button>
      {open && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="label">Document</span>
              <select className="input" value={docType} onChange={(e) => setDocType(e.target.value as DocumentType)}>{DOC_TYPES.map((d) => <option key={d.v} value={d.v}>{d.l}</option>)}</select></label>
            <label className="block"><span className="label">Reviewing as</span>
              <select className="input" value={perspective} onChange={(e) => setPerspective(e.target.value as Perspective)}>{PERSPECTIVES.map((d) => <option key={d.v} value={d.v}>{d.l}</option>)}</select></label>
          </div>
          <div className="flex items-center justify-between text-[11px] text-bone-500">
            <span className="truncate">{pack.name} · {pack.rules.filter((r) => r.enabled).length} rules{pack === SAMPLE_PACK ? " (sample)" : ""}</span>
            <button type="button" className="btn-ghost btn-sm" onClick={() => file.current?.click()}><Upload size={12} /> Import pack</button>
            <input ref={file} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && importPack(e.target.files[0])} />
          </div>
          {error && <p className="text-xs text-blood-400">{error}</p>}
          {note && <p className="rounded-lg border border-moss-500/30 bg-moss-500/10 px-3 py-2 text-xs text-moss-400">{note}</p>}

          {result.findings.length === 0 && missing.length === 0 && <p className="text-xs text-bone-500">No findings for this document type and perspective.</p>}

          <ul className="space-y-2">
            {result.findings.map((f) => (
              <li key={f.fingerprint} className="rounded-xl border hairline bg-ink-900 p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold leading-5">{f.title}</span>
                  <Pill tone={TONE[f.severity]}>{f.severity}</Pill>
                </div>
                <p className="mt-1 text-xs leading-5 text-bone-400">{f.message}</p>
                {f.excerpt && <p className="mt-1.5 border-l-2 border-goat-500/40 pl-2 text-[11px] italic leading-4 text-bone-500">“{f.excerpt.length > 180 ? f.excerpt.slice(0, 180) + "…" : f.excerpt}”</p>}
                <p className="mt-1 text-[10px] uppercase tracking-wider text-bone-500">{f.category}</p>
                {onChange && templatesFor(f).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {templatesFor(f).map((t) => (
                      <button key={t.id} type="button" className="btn-secondary btn-sm" title={t.text.slice(0, 200)} onClick={() => apply(f, t)}>
                        <Wand2 size={12} /> {t.position === "delete" ? "Strike" : t.position === "insert" ? "Insert" : "Apply"}: {t.title}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
            {missing.map((c) => (
              <li key={c.ruleId} className="rounded-xl border border-dashed hairline p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold leading-5">{c.title}</span>
                  <Pill tone={c.state === "not_located" ? "warn" : "neutral"}>{c.state === "not_located" ? "missing" : "incomplete?"}</Pill>
                </div>
                <p className="mt-1 text-xs text-bone-500">{c.state === "not_located" ? "Expected language was not found in the draft." : "Related language exists but may be incomplete."}</p>
              </li>
            ))}
          </ul>
          {result.errors.length > 0 && <p className="flex items-center gap-1 text-[11px] text-blood-400"><AlertTriangle size={11} /> {result.errors.length} rule(s) failed to run</p>}
          <p className="text-[11px] leading-5 text-bone-500">Rules run entirely in this tab on the draft as you type. {onChange ? "Approved-language buttons rewrite the draft directly; the sample pack's clauses are illustrative — import your own playbook JSON." : "Edit the document in the reviewer to act on findings."}</p>
        </div>
      )}
    </div>
  );
}
