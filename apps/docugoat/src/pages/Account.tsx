import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, LogOut, UserRound } from "lucide-react";
import { Field, Spinner, Toast } from "../components/ui";
import { createAccount, saveAccount, signIn } from "../lib/account";
import { BACKEND, GH_BASE, getSession, setSession } from "../lib/config";
import { loadVault, saveRecord } from "../lib/vault";

export function Account() {
  const nav = useNavigate();
  const session = getSession();
  const [mode, setMode] = useState<"signin" | "create">("signin");
  const [username, setUsername] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ m: string; tone?: "bad" | "good" } | null>(null);

  if (BACKEND !== "github") {
    return <div className="mx-auto max-w-lg px-5 py-24 text-center text-sm text-bone-500">This build talks to a relay; no account is needed.</div>;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const s = mode === "signin" ? await signIn(GH_BASE, username, passphrase) : await createAccount(GH_BASE, username, passphrase, token.trim());
      // Merge the account vault into this device, then push the union back so every device converges.
      for (const r of s.vault.records) saveRecord(r);
      const merged = await saveAccount(s, loadVault());
      setSession(merged);
      nav("/vault");
    } catch (err) {
      setToast({ m: err instanceof Error ? err.message : "Failed", tone: "bad" });
    } finally { setBusy(false); }
  }

  if (session) {
    return (
      <div className="mx-auto max-w-lg px-5 py-16">
        <div className="surface p-8">
          <p className="eyebrow">Signed in</p>
          <h1 className="mt-1 text-xl font-semibold">{session.username}</h1>
          <p className="mt-2 text-sm leading-6 text-bone-400">Your vault lives encrypted in <span className="mono">{GH_BASE.owner}/{GH_BASE.repo}</span> under a key derived from your username and passphrase. Nothing there is readable without both.</p>
          <button className="btn-secondary mt-6" onClick={() => { setSession(null); nav("/"); }}><LogOut size={14} /> Sign out</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-5 py-16">
      <form onSubmit={submit} className="surface rise-in space-y-5 p-8">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-goat-500/10 text-goat-400"><UserRound size={18} /></div>
          <div>
            <h1 className="text-lg font-semibold">{mode === "signin" ? "Sign in" : "Create your vault"}</h1>
            <p className="text-xs text-bone-500">Store: <span className="mono">{GH_BASE.owner}/{GH_BASE.repo}</span> on GitHub</p>
          </div>
        </div>
        <div className="flex gap-1 rounded-xl bg-ink-900 p-1 text-xs font-semibold">
          {(["signin", "create"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={`flex-1 rounded-lg px-3 py-1.5 transition ${mode === m ? "bg-ink-600 text-bone-100" : "text-bone-500 hover:text-bone-200"}`}>{m === "signin" ? "Sign in" : "Create"}</button>
          ))}
        </div>
        <Field label="Username" hint="Any name you choose. It's hashed to locate your vault file.">
          <input className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field label="Passphrase" hint="Derives your vault key (PBKDF2, 600k rounds). There is no reset — nobody can recover it.">
          <input className="input" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
        </Field>
        {mode === "create" && (
          <Field label="GitHub token (data repo write access)" hint={`A fine-grained personal access token with Contents: Read & write on ${GH_BASE.owner}/${GH_BASE.repo} only. It's encrypted into your vault and shared with signers inside their link so they can write their signature back.`}>
            <input className="input mono" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" />
          </Field>
        )}
        <button className="btn-primary w-full" disabled={busy || !username.trim() || passphrase.length < 8 || (mode === "create" && !token.trim())}>
          {busy ? <><Spinner /> Deriving key…</> : <><KeyRound size={14} /> {mode === "signin" ? "Unlock vault" : "Create vault"}</>}
        </button>
        {passphrase.length > 0 && passphrase.length < 8 && <p className="text-center text-xs text-goat-400">Use at least 8 characters.</p>}
      </form>
      {toast && <Toast message={toast.m} tone={toast.tone} onDone={() => setToast(null)} />}
    </div>
  );
}
