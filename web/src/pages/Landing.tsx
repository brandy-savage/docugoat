import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, EyeOff, Fingerprint, KeyRound, Lock } from "lucide-react";

export function Landing() {
  const nav = useNavigate();
  const [open, setOpen] = useState("");
  function go(e: React.FormEvent) {
    e.preventDefault();
    const v = open.trim();
    const m = v.match(/\/d\/([a-z0-9]+)(#.*)?/) ?? v.match(/^([a-z0-9]{20,32})$/);
    if (m) nav(`/d/${m[1]}${m[2] ?? ""}`);
  }
  return (
    <div className="mx-auto max-w-6xl px-5">
      <section className="grid items-center gap-12 py-20 md:grid-cols-[1.2fr_1fr] md:py-28">
        <div className="rise-in">
          <p className="eyebrow mb-4">Zero-knowledge e-signatures</p>
          <h1 className="text-5xl font-bold leading-[1.05] tracking-tight md:text-6xl">
            Sign documents.<br /><span className="text-goat-400">Leave no trace.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-bone-400">
            Write in markdown, seal it on your device, hand the other party a link and a code. The relay only ever
            carries ciphertext — it can't read your contract, your names, or your signatures. Nothing to subpoena, nothing to leak.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link to="/new" className="btn-primary px-5 py-3 text-base">Create a document <ArrowRight size={16} /></Link>
            <Link to="/security" className="btn-ghost">How it stays private</Link>
          </div>
        </div>
        <form onSubmit={go} className="surface rise-in p-6" style={{ animationDelay: "120ms" }}>
          <p className="eyebrow mb-3">Received a document?</p>
          <h2 className="text-lg font-semibold">Open with your link</h2>
          <p className="mt-1 text-sm text-bone-500">Paste the link you were sent. You'll enter the access code on the next screen.</p>
          <input className="input mono mt-4" placeholder="https://…/d/…#k=…" value={open} onChange={(e) => setOpen(e.target.value)} />
          <button className="btn-secondary mt-3 w-full">Continue</button>
        </form>
      </section>

      <section className="grid gap-4 pb-24 md:grid-cols-3">
        {[
          { icon: <EyeOff size={18} />, t: "The server is blind", d: "AES-256-GCM in the browser. The relay stores opaque blobs in an append-only git log and can't tell a contract from noise." },
          { icon: <KeyRound size={18} />, t: "One code per signer", d: "A shared link with a secret fragment (never sent to the server), plus a personal 12-character code for each recipient. You learn exactly who signed." },
          { icon: <Fingerprint size={18} />, t: "Signatures you can verify", d: "Every signer draws their mark and signs the document hash with a fresh ECDSA key. You verify it locally — not by trusting us." },
        ].map((f) => (
          <div key={f.t} className="surface p-6">
            <div className="mb-4 grid h-9 w-9 place-items-center rounded-xl bg-goat-500/10 text-goat-400">{f.icon}</div>
            <h3 className="font-semibold">{f.t}</h3>
            <p className="mt-2 text-sm leading-6 text-bone-400">{f.d}</p>
          </div>
        ))}
      </section>

      <section className="border-t hairline py-16">
        <p className="eyebrow mb-6">How it works</p>
        <ol className="grid gap-6 md:grid-cols-4">
          {[
            ["Write", "Rich editor or raw markdown. Your draft never leaves the tab."],
            ["Seal", "Your browser encrypts the document and issues a personal code to every signer. Only ciphertext is uploaded."],
            ["Share", "Send the link through one channel and each code through another."],
            ["Sign & verify", "They unlock, sign in the highlighted fields, and the encrypted signature comes back to you."],
          ].map(([t, d], i) => (
            <li key={t} className="flex gap-4">
              <span className="mono grid h-8 w-8 shrink-0 place-items-center rounded-lg border hairline text-xs text-goat-400">{i + 1}</span>
              <div><h3 className="font-semibold">{t}</h3><p className="mt-1 text-sm leading-6 text-bone-400">{d}</p></div>
            </li>
          ))}
        </ol>
        <p className="mt-10 inline-flex items-center gap-2 text-xs text-bone-500"><Lock size={12} /> Envelopes expire automatically. Owners can burn them at any time.</p>
      </section>
    </div>
  );
}
