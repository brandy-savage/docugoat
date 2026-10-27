import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, FileText, Lock } from "lucide-react";
import { Spinner, Toast } from "../components/ui";
import { setHandoff } from "../lib/handoff";
import reviewerCss from "@docugoat/reviewer/style.css?raw";
import { BASE_URL } from "../lib/env";
import { mountReviewer, type ReviewerHandle } from "../lib/reviewerHost";

/** Stage 1 for Word documents: the full Contract Reviewer, embedded. When the redline is done, hand the bytes to sealing. */
export function Review() {
  const nav = useNavigate();
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<ReviewerHandle | null>(null);
  const [docName, setDocName] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<"clean" | "tracked">("clean");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    mountReviewer(host.current!, { css: reviewerCss, sampleUrl: `${BASE_URL.replace(/\/$/, "")}/samples/sample-msa.docx`, onSession: (n) => alive && setDocName(n) }).then((h) => { if (!alive) return h.destroy(); handle.current = h; setReady(true); }).catch((e) => setToast(e instanceof Error ? e.message : "Reviewer failed to start"));
    return () => { alive = false; handle.current?.destroy(); };
  }, []);

  function send() {
    const out = handle.current?.app.currentExport(mode);
    if (!out) return setToast("Open a document in the reviewer first.");
    setHandoff({ name: out.name, bytes: out.bytes, mode });
    nav("/seal");
  }

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-6">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Stage 1 · Review</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{docName ?? "Open or drop a Word document"}</h1>
          <p className="mt-1 text-xs text-bone-500">Redline it, run the playbook, apply approved language, compare drafts. Everything stays in this tab. When it's final, send it on to be signed.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-xl bg-ink-900 p-1 text-xs font-semibold">
            {(["clean", "tracked"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-lg px-3 py-1.5 transition ${mode === m ? "bg-ink-600 text-bone-100" : "text-bone-500 hover:text-bone-200"}`}>{m === "clean" ? "Clean copy" : "Keep tracked changes"}</button>
            ))}
          </div>
          <button className="btn-primary" disabled={!docName} onClick={send}><Lock size={15} /> Send for signature <ArrowRight size={15} /></button>
        </div>
      </div>
      {!ready && <div className="grid h-40 place-items-center"><Spinner className="h-6 w-6" /></div>}
      <div ref={host} className="surface overflow-hidden rounded-2xl bg-white" />
      <p className="mt-3 flex items-center gap-2 text-[11px] text-bone-500"><FileText size={12} /> Prefer to write from scratch? <a href="#/new" onClick={(e) => { e.preventDefault(); nav("/new"); }} className="text-goat-400 underline underline-offset-4">Compose in markdown</a>.</p>
      {toast && <Toast message={toast} tone="bad" onDone={() => setToast(null)} />}
    </div>
  );
}
