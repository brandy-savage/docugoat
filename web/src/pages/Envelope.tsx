import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { CheckCircle2, Download, Flame, Lock, PenLine, Printer, RefreshCw, ShieldCheck, Unlock } from "lucide-react";
import { Certificate } from "../components/Certificate";
import { CodeEntry } from "../components/CodeEntry";
import { DocumentView } from "../components/DocumentView";
import { SignaturePad, type SignaturePadHandle } from "../components/SignaturePad";
import { Pill, Spinner, Toast } from "../components/ui";
import { RelayError } from "../lib/api";
import { BACKEND, setLinkToken, transport } from "../lib/config";
import { isVerified, loadAudit, loadSignatures, openEnvelope, recordView, signEnvelope, type OpenedEnvelope } from "../lib/envelope";
import { parseFields, sameName } from "../lib/fields";
import { downloadPdf } from "../lib/pdf";
import type { AuditEvent, RelayEnvelope, VerifiedSignature } from "../lib/types";
import { AuditTrail } from "../components/AuditTrail";
import { findRecord, removeRecord, saveRecord, type VaultRecord } from "../lib/vault";

type Phase =
  | { k: "loading" }
  | { k: "gone"; reason: string }
  | { k: "locked"; envelope: RelayEnvelope; busy: boolean; failed: number }
  | { k: "open"; opened: OpenedEnvelope; code: string };

export function EnvelopePage() {
  const { id = "" } = useParams();
  const { hash } = useLocation();
  const frag = new URLSearchParams(hash.replace(/^#/, ""));
  const fragmentSecret = frag.get("k") ?? "";
  setLinkToken(frag.get("t") ?? undefined);
  const [phase, setPhase] = useState<Phase>({ k: "loading" });
  const [record, setRecord] = useState<VaultRecord | undefined>(() => findRecord(id));
  const [signatures, setSignatures] = useState<VerifiedSignature[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [toast, setToast] = useState<{ m: string; tone?: "bad" | "good" } | null>(null);
  const [exporting, setExporting] = useState(false);

  const unlock = useCallback(async (envelope: RelayEnvelope, code: string) => {
    setPhase((p) => ({ k: "locked", envelope, busy: true, failed: p.k === "locked" ? p.failed : 0 }));
    try {
      const opened = await openEnvelope(envelope, code, fragmentSecret);
      setPhase({ k: "open", opened, code });
      await recordView(opened);
      const sigs = await loadSignatures(opened);
      setSignatures(sigs);
      setAudit(await loadAudit(opened, sigs));
    } catch {
      setPhase((p) => ({ k: "locked", envelope, busy: false, failed: (p.k === "locked" ? p.failed : 0) + 1 }));
    }
  }, [fragmentSecret]);

  useEffect(() => {
    let cancelled = false;
    transport().fetch(id).then((envelope) => {
      if (cancelled) return;
      const rec = findRecord(id);
      if (rec && rec.fragmentSecret === fragmentSecret) unlock(envelope, rec.code);
      else setPhase({ k: "locked", envelope, busy: false, failed: 0 });
    }).catch((e) => {
      if (cancelled) return;
      const status = e instanceof RelayError ? e.status : (e as any)?.status;
      const msg = e instanceof Error ? e.message : "";
      setPhase({ k: "gone", reason: status === 404 || msg === "not found" ? "not found" : msg === "expired" || msg === "burned" ? msg : status === 410 ? msg : "unreachable" });
    });
    return () => { cancelled = true; };
  }, [id, fragmentSecret, unlock]);

  async function refresh(quiet = false) {
    if (phase.k !== "open") return;
    const sigs = await loadSignatures(phase.opened);
    setSignatures(sigs);
    setAudit(await loadAudit(phase.opened, sigs));
    if (!quiet) setToast({ m: "Refreshed" });
  }
  async function exportPdf() {
    if (phase.k !== "open") return;
    setExporting(true);
    try { await downloadPdf(phase.opened.doc, id, phase.opened.documentSha256, signatures, audit); }
    catch (e) { setToast({ m: e instanceof Error ? e.message : "PDF failed", tone: "bad" }); }
    finally { setExporting(false); }
  }
  async function burn() {
    if (!record?.ownerToken || !confirm("Burn this envelope? Nobody will be able to open it again.")) return;
    try { await transport().burn(id, record.ownerToken); removeRecord(id); setPhase({ k: "gone", reason: "burned" }); }
    catch (e) { setToast({ m: e instanceof Error ? e.message : "Burn failed", tone: "bad" }); }
  }

  const mySignature = useMemo(() => phase.k === "open" ? signatures.find((s) => s.slot === phase.opened.slot) : undefined, [phase, signatures]);
  const ctx = useMemo(() => {
    if (phase.k !== "open") return undefined;
    const me = phase.opened.me;
    return { signatures, viewerName: me.role === "signer" && !mySignature ? me.name : null };
  }, [phase, signatures, mySignature]);

  if (!fragmentSecret) return <Empty title="This link is incomplete" body="The secret after the # in the link is missing. Ask the sender to resend the full link." />;
  if (phase.k === "loading") return <div className="grid h-[60vh] place-items-center"><Spinner className="h-6 w-6" /></div>;
  if (phase.k === "gone") {
    const copy: Record<string, [string, string]> = {
      "not found": ["No such envelope", "The link may be wrong, or the envelope was swept after expiring."],
      expired: ["This envelope has expired", "The sender's retention window has passed and the ciphertext was removed."],
      burned: ["This envelope was burned", "The owner destroyed it. The relay no longer holds anything for this link."],
    };
    const [t, b] = copy[phase.reason] ?? ["Can't reach the relay", phase.reason];
    return <Empty title={t} body={b} />;
  }

  if (phase.k === "locked") {
    const { envelope, busy, failed } = phase;
    return (
      <div className="mx-auto max-w-lg px-5 py-16">
        <div className="surface rise-in p-8">
          <div className="mb-6 flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-goat-500/10 text-goat-400"><Lock size={18} /></div>
            <div>
              <h1 className="text-lg font-semibold">Enter your access code</h1>
              <p className="text-xs text-bone-500">Sealed {new Date(envelope.createdAt).toLocaleDateString()} · {envelope.wraps.length - 1} recipient{envelope.wraps.length === 2 ? "" : "s"} · {envelope.signatureCount} signed</p>
            </div>
          </div>
          <CodeEntry busy={busy} error={failed > 0} onSubmit={(code) => unlock(envelope, code)} />
          {failed > 0 && <p className="mt-4 text-center text-xs text-blood-400">That code didn't unlock the document.{failed >= 3 && " We already normalize 0/O and 1/I — the code itself is likely wrong, or this link isn't the one it was issued with."}</p>}
          {busy && <p className="mt-4 text-center text-xs text-bone-500">Deriving your key on this device…</p>}
          <p className="mt-6 text-center text-[11px] leading-5 text-bone-500">Decryption happens in this tab. The relay can't see whether your code was right — a wrong code simply produces nothing.</p>
        </div>
      </div>
    );
  }

  const { opened, code } = phase;
  const me = opened.me;
  const isOwner = me.role === "owner";
  const signers = opened.doc.recipients.filter((r) => r.role === "signer" || r.signs);
  const myFields = parseFields(opened.doc.markdown).filter((f) => f.kind === "sign" && (me.name === "" || sameName(f.name, me.name)));
  const iCanSign = !isOwner || !!me.signs || myFields.length > 0;

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Pill tone="good"><Unlock size={11} /> decrypted on-device</Pill>
          <span className="text-sm text-bone-400">{isOwner ? "You sealed this" : `Opened with ${me.name ? `${me.name}'s` : "an open"} code`} · from {opened.doc.author} · expires {new Date(opened.envelope.expiresAt).toLocaleDateString()}</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost btn-sm" onClick={() => refresh()}><RefreshCw size={13} /> Refresh</button>
          <button className="btn-ghost btn-sm" onClick={() => window.print()}><Printer size={13} /> Print</button>
          <button className="btn-secondary btn-sm" onClick={exportPdf} disabled={exporting}>{exporting ? <Spinner /> : <Download size={13} />} Download PDF</button>
          {isOwner && record?.ownerToken && <button className="btn-danger btn-sm" onClick={burn}><Flame size={13} /> Burn</button>}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="surface overflow-hidden">
          <DocumentView markdown={opened.doc.markdown} ctx={ctx} />
          <div className="border-t hairline">
            <Certificate doc={opened.doc} envelopeId={id} documentSha256={opened.documentSha256} signatures={signatures} audit={audit} />
          </div>
        </div>

        <aside className="no-print space-y-5 lg:sticky lg:top-20 lg:self-start">
          {iCanSign && !mySignature && (
            <SignPanel opened={opened} fieldCount={myFields.length} canWrite={BACKEND !== "github" || !!frag.get("t") || !!record} onSigned={async (name) => {
              if (!isOwner) {
                const rec: VaultRecord = { id, title: opened.doc.title, fragmentSecret, createdAt: new Date().toISOString(), expiresAt: opened.envelope.expiresAt, role: "signer", code, slot: opened.slot, signerName: name };
                saveRecord(rec); setRecord(rec);
              }
              await refresh(true);
              setToast({ m: "Signed and relayed", tone: "good" });
              window.scrollTo({ top: 0, behavior: "smooth" });
            }} onError={(m) => setToast({ m, tone: "bad" })} />
          )}
          {isOwner ? (
            <div className="surface space-y-4 p-5">
              <div className="flex items-center justify-between">
                <p className="eyebrow">Progress</p>
                {signers.every((r) => signatures.some((s) => s.slot === r.slot && isVerified(s))) ? <Pill tone="good">complete</Pill> : <Pill tone="warn">{signers.filter((r) => signatures.some((s) => s.slot === r.slot)).length}/{signers.length} signed</Pill>}
              </div>
              <ul className="space-y-2">
                {signers.map((r) => {
                  const s = signatures.find((x) => x.slot === r.slot);
                  return (
                    <li key={r.slot} className="flex items-center justify-between rounded-xl border hairline bg-ink-900 px-3 py-2.5 text-sm">
                      <span className="truncate">{r.name || <span className="text-bone-500">open signer</span>}{r.slot === 0 && <span className="text-bone-500"> (you)</span>}{s && r.name === "" && <span className="text-bone-400"> · {s.signerName}</span>}</span>
                      {s ? (isVerified(s) ? <span className="inline-flex items-center gap-1 text-xs text-moss-400"><CheckCircle2 size={13} /> {new Date(s.signedAt).toLocaleDateString()}</span> : <span className="text-xs text-blood-400">needs review</span>) : <span className="text-xs text-bone-500">awaiting</span>}
                    </li>
                  );
                })}
              </ul>
              <p className="text-[11px] leading-5 text-bone-500">Signatures arrive encrypted; hit Refresh to pull new ones. Codes and the link are on the <Link to={`/share/${id}`} className="text-goat-400 underline underline-offset-4">share screen</Link>.</p>
            </div>
          ) : mySignature ? (
            <div className="surface p-5">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-moss-400"><ShieldCheck size={15} /> Signed</div>
              <p className="text-xs leading-5 text-bone-400">You signed as <strong className="text-bone-200">{mySignature.signerName}</strong> on {new Date(mySignature.signedAt).toLocaleString()}. Your encrypted signature has been relayed to {opened.doc.author}.</p>
              <button className="btn-primary mt-4 w-full" onClick={exportPdf} disabled={exporting}>{exporting ? <Spinner /> : <Download size={14} />} Download signed PDF</button>
            </div>
          ) : null}
          <div className="surface p-5">
            <p className="eyebrow mb-3">Activity</p>
            <AuditTrail events={audit} compact />
          </div>
          <div className="rounded-2xl border hairline p-4 text-[11px] leading-5 text-bone-500">
            <p className="mb-1 font-semibold text-bone-400">Integrity</p>
            <p className="mono break-all">sha256 {opened.documentSha256}</p>
          </div>
        </aside>
      </div>
      {toast && <Toast message={toast.m} tone={toast.tone} onDone={() => setToast(null)} />}
    </div>
  );
}

function SignPanel({ opened, fieldCount, canWrite, onSigned, onError }: { opened: OpenedEnvelope; fieldCount: number; canWrite: boolean; onSigned: (name: string) => Promise<void>; onError: (m: string) => void }) {
  const pad = useRef<SignaturePadHandle>(null);
  const locked = opened.me.name !== "";
  const [name, setName] = useState(opened.me.name);
  const [agree, setAgree] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [busy, setBusy] = useState(false);
  const onDraw = useCallback(() => setDrawn(true), []);

  async function sign() {
    if (!name.trim()) return onError("Enter your full name.");
    if (!pad.current || pad.current.isEmpty()) return onError("Draw your signature.");
    setBusy(true);
    try { await signEnvelope(opened, name.trim(), pad.current.toDataUrl()); await onSigned(name.trim()); }
    catch (e) { onError(e instanceof Error ? e.message : "Signing failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="surface space-y-4 p-5">
      <div className="flex items-center justify-between">
        <p className="eyebrow">Review &amp; sign</p>
        <span className="inline-flex items-center gap-1 text-[11px] text-goat-400"><PenLine size={12} /> {fieldCount} field{fieldCount === 1 ? "" : "s"} for you</span>
      </div>
      <label className="block">
        <span className="label">Signing as</span>
        <input className={`input ${locked ? "opacity-70" : ""}`} value={name} readOnly={locked} onChange={(e) => setName(e.target.value)} placeholder="Full legal name" />
        {locked && <span className="mt-1.5 block text-[11px] text-bone-500">{opened.me.role === "owner" ? "You're signing with your owner code." : `Bound to the code ${opened.doc.author} issued to you.`}</span>}
      </label>
      <div>
        <span className="label">Draw your signature</span>
        <SignaturePad ref={pad} onDraw={onDraw} />
      </div>
      <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-5 text-bone-400">
        <input type="checkbox" className="mt-1 accent-goat-500" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        I have read this document and intend this to be my legally binding electronic signature.
      </label>
      {!canWrite && <p className="text-xs text-goat-400">This link has no write access to the store — ask the sender for the full link.</p>}
      <button className="btn-primary w-full" disabled={busy || !agree || !name.trim() || !drawn || !canWrite} onClick={sign}>
        {busy ? <><Spinner /> Signing &amp; encrypting…</> : "Sign document"}
      </button>
      <p className="text-[11px] leading-5 text-bone-500">Your mark is placed into every highlighted field. The relay stamps a signed receipt (time, IP, browser) that's sealed into your encrypted bundle — evidence for the certificate, never stored in the clear.</p>
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-lg px-5 py-24 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-bone-500">{body}</p>
      <Link to="/" className="btn-ghost mt-6">Back to start</Link>
    </div>
  );
}
