import { Link, useLocation, useParams } from "react-router-dom";
import { ArrowRight, KeyRound, Link2, MessageSquareWarning, UserRound } from "lucide-react";
import { CopyButton } from "../components/ui";
import { envelopeUrl, type SealResult } from "../lib/envelope";
import { findRecord } from "../lib/vault";

export function Share() {
  const { id = "" } = useParams();
  const state = useLocation().state as SealResult | null;
  const rec = state ?? (() => {
    const r = findRecord(id);
    return r?.issued && { id: r.id, fragmentSecret: r.fragmentSecret, ownerToken: r.ownerToken ?? "", expiresAt: r.expiresAt, url: envelopeUrl(r.id, r.fragmentSecret), issued: r.issued };
  })();
  if (!rec) return <div className="mx-auto max-w-xl px-5 py-24 text-center text-bone-500">This envelope isn't in your vault on this device.</div>;

  const owner = rec.issued.find((c) => c.role === "owner")!;
  const signers = rec.issued.filter((c) => c.role === "signer");
  const message = (name: string, code: string) =>
    `Hi${name ? ` ${name}` : ""}, please review and sign: ${rec.url}\n\nYour access code (keep it private): ${code}`;

  return (
    <div className="mx-auto max-w-3xl px-5 py-12">
      <div className="rise-in">
        <p className="eyebrow">Sealed · expires {new Date(rec.expiresAt).toLocaleDateString()}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Codes issued</h1>
        <p className="mt-2 text-bone-400">Everyone shares the same link. Each signer gets their <em>own</em> code, so you'll know exactly who signed. Send the link and the code through different channels.</p>
      </div>

      <div className="surface rise-in mt-8 p-6" style={{ animationDelay: "60ms" }}>
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Link2 size={15} className="text-goat-400" /> Shared link</div>
        <div className="flex items-center gap-2">
          <input readOnly className="input mono text-xs" value={rec.url} onFocus={(e) => e.target.select()} />
          <CopyButton value={rec.url} />
        </div>
        <p className="mt-2 text-xs text-bone-500">The part after <span className="kbd">#</span> is a secret your browser never sends to the server. A code without the link opens nothing.</p>
      </div>

      <div className="mt-4 space-y-3">
        {signers.map((c, i) => (
          <div key={c.slot} className="surface rise-in p-6" style={{ animationDelay: `${120 + i * 60}ms` }}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold"><UserRound size={15} className="text-goat-400" /> {c.name || "Open signer"}</div>
              <div className="flex gap-2">
                <CopyButton value={c.code} label="Copy code" />
                <CopyButton value={message(c.name, c.code)} label="Copy message" />
              </div>
            </div>
            <div className="mono mt-3 text-3xl font-semibold tracking-[0.12em]">{c.code}</div>
            <p className="mt-2 text-xs text-bone-500">{c.name ? `Only ${c.name} should receive this code.` : "Whoever holds this code types their own name when signing."}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-2xl border hairline p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-bone-400"><KeyRound size={15} /> Your owner code</div>
          <CopyButton value={owner.code} label="Copy" />
        </div>
        <div className="mono mt-2 text-xl tracking-[0.12em] text-bone-400">{owner.code}</div>
        <p className="mt-1 text-xs text-bone-500">Saved in this browser's vault. Keep it if you'll open the envelope from another device.</p>
      </div>

      <div className="mt-4 flex items-start gap-3 rounded-2xl border border-goat-500/20 bg-goat-500/5 p-4 text-sm text-bone-400">
        <MessageSquareWarning size={18} className="mt-0.5 shrink-0 text-goat-400" />
        <p>No emails go out and no contact details are stored — that's the point. Case doesn't matter; O/0 and I/1 are interchangeable.</p>
      </div>

      <div className="surface mt-6 p-6">
        <p className="eyebrow mb-4">How signing works from here</p>
        <ol className="grid gap-4 sm:grid-cols-2">
          {[
            ["Send", "Give each signer the link plus their own code, via different channels."],
            ["They unlock", "They open the link, type the code, and the document decrypts in their browser. You'll see a \"Viewed\" event."],
            ["They sign", "Their name is fixed to the code. They draw a signature; it lands in every field marked for them, encrypted, with a relay-attested receipt (time, IP, browser)."],
            ["You sign & finish", "Open as owner, sign your own fields, hit Refresh to pull signatures, then Download PDF — document, marks, certificate and audit trail."],
          ].map(([t, d], i) => (
            <li key={t} className="flex gap-3">
              <span className="mono grid h-7 w-7 shrink-0 place-items-center rounded-lg border hairline text-xs text-goat-400">{i + 1}</span>
              <div><p className="text-sm font-semibold">{t}</p><p className="mt-0.5 text-xs leading-5 text-bone-400">{d}</p></div>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link to={`/d/${rec.id}#k=${rec.fragmentSecret}`} className="btn-primary">Open as owner &amp; sign <ArrowRight size={15} /></Link>
        <Link to="/vault" className="btn-ghost">Vault</Link>
        <Link to="/new" className="btn-ghost">Create another</Link>
      </div>
    </div>
  );
}
