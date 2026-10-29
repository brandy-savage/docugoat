import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Github, KeyRound, LogOut, Server, UserRound } from "lucide-react";
import { Field, Spinner, Toast } from "../components/ui";
import { createAccount, saveAccount, signIn } from "../lib/account";
import { makeRelay } from "../lib/api";
import { BUILD_STORE, GH_BASE, PUBLIC_RELAY, getSession, loadDefaultStore, onSessionChange, saveDefaultStore, setSession } from "../lib/config";
import { storeLabel, type Store } from "../lib/store";
import { loadVault, saveRecord } from "../lib/vault";

/**
 * Where your envelopes go. A public relay needs nothing from you. A GitHub repo you own needs a vault:
 * username + passphrase derive the key that encrypts your envelope codes and the repo token, stored in that repo.
 */
export function Account() {
  const nav = useNavigate();
  const [, tick] = useState(0);
  useEffect(() => onSessionChange(() => tick((n) => n + 1)), []);
  const session = getSession();
  const current = loadDefaultStore();
  const [kind, setKind] = useState<"relay" | "github">(session ? "github" : current.kind);
  const [advanced, setAdvanced] = useState(kind === "github");
  const [relayUrl, setRelayUrl] = useState(current.kind === "relay" ? current.url : PUBLIC_RELAY);
  const [relayOk, setRelayOk] = useState<boolean | null>(null);
  const [owner, setOwner] = useState(session?.cfg.owner ?? (current.kind === "github" ? current.owner : GH_BASE.owner));
  const [repo, setRepo] = useState(session?.cfg.repo ?? (current.kind === "github" ? current.repo : GH_BASE.repo));
  const [mode, setMode] = useState<"signin" | "create">("signin");
  const [username, setUsername] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ m: string; tone?: "bad" | "good" } | null>(null);

  useEffect(() => {
    if (kind !== "relay" || !relayUrl) { setRelayOk(null); return; }
    let alive = true;
    makeRelay(relayUrl).health().then(() => alive && setRelayOk(true)).catch(() => alive && setRelayOk(false));
    return () => { alive = false; };
  }, [kind, relayUrl]);

  function useRelay() {
    const url = relayUrl.trim().replace(/\/$/, "");
    if (!url) return setToast({ m: "Enter the relay URL.", tone: "bad" });
    saveDefaultStore({ kind: "relay", url });
    setSession(null);
    setToast({ m: `Envelopes will be sealed to ${storeLabel({ kind: "relay", url })}`, tone: "good" });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const cfg = { owner: owner.trim(), repo: repo.trim(), branch: GH_BASE.branch };
    if (!cfg.owner || !cfg.repo) return setToast({ m: "Enter the GitHub owner and repository.", tone: "bad" });
    setBusy(true);
    try {
      const s = mode === "signin" ? await signIn(cfg, username, passphrase) : await createAccount(cfg, username, passphrase, token.trim());
      for (const r of s.vault.records) saveRecord(r);
      const merged = await saveAccount(s, loadVault());
      setSession(merged);
      saveDefaultStore({ kind: "github", owner: cfg.owner, repo: cfg.repo });
      nav("/vault");
    } catch (err) {
      setToast({ m: err instanceof Error ? err.message : "Failed", tone: "bad" });
    } finally { setBusy(false); }
  }

  const defaultRelay = BUILD_STORE.kind === "relay" ? BUILD_STORE.url : "";
  const tab = (on: boolean) => `flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${on ? "bg-ink-600 text-bone-100" : "text-bone-500 hover:text-bone-200"}`;
  const store: Store = kind === "relay" ? { kind: "relay", url: relayUrl } : { kind: "github", owner, repo };

  return (
    <div className="mx-auto max-w-lg px-5 py-12">
      <p className="eyebrow">Where your envelopes live</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Store</h1>
      <p className="mt-1 text-sm text-bone-500">The store only ever holds ciphertext. You don't need an account, a token, or anything else to seal and sign — the public relay is the default. Signers need nothing either; their link names the store.</p>

      {advanced ? (
        <div className="mt-6 flex gap-1 rounded-xl bg-ink-900 p-1">
          <button type="button" className={tab(kind === "relay")} onClick={() => setKind("relay")}><Server size={14} className="mr-1.5 inline" /> Public relay</button>
          <button type="button" className={tab(kind === "github")} onClick={() => setKind("github")}><Github size={14} className="mr-1.5 inline" /> My GitHub repo</button>
        </div>
      ) : (
        <div className="mt-6 flex items-center justify-between rounded-xl border hairline bg-ink-900 px-4 py-3 text-sm">
          <span className="flex items-center gap-2"><Server size={14} className="text-goat-400" /> Public relay</span>
          <button type="button" className="text-xs text-bone-500 hover:text-bone-200" onClick={() => setAdvanced(true)}>Advanced: use my own GitHub repo instead</button>
        </div>
      )}

      {kind === "relay" ? (
        <div className="surface mt-4 space-y-4 p-6">
          <Field label="Relay URL" hint="Anyone can seal and sign through a relay — no account, no token. It stores ciphertext and attests times and IPs for the audit trail.">
            <input className="input mono" value={relayUrl} onChange={(e) => setRelayUrl(e.target.value)} placeholder="https://relay.example.com" />
          </Field>
          <p className="text-xs">
            {relayOk === true && <span className="text-moss-400">Relay reachable.</span>}
            {relayOk === false && <span className="text-blood-400">Can't reach that relay from here.</span>}
            {relayOk === null && <span className="text-bone-500">Enter a URL to check it.</span>}
          </p>
          <button type="button" className="btn-primary w-full" onClick={useRelay} disabled={relayOk === false}>Use this relay</button>
          {current.kind === "relay" && current.url === relayUrl.trim().replace(/\/$/, "") && <p className="text-center text-xs text-moss-400">This is your current store.</p>}
          {defaultRelay && defaultRelay !== relayUrl && <button type="button" className="w-full text-xs text-bone-500 hover:text-bone-200" onClick={() => setRelayUrl(defaultRelay)}>Use the default relay ({defaultRelay})</button>}
        </div>
      ) : session ? (
        <div className="surface mt-4 p-6">
          <p className="eyebrow">Signed in</p>
          <h2 className="mt-1 text-xl font-semibold">{session.username}</h2>
          <p className="mt-2 text-sm leading-6 text-bone-400">Your vault lives encrypted in <span className="mono">{session.cfg.owner}/{session.cfg.repo}</span> under a key derived from your username and passphrase. Envelopes you seal go there too.</p>
          <button className="btn-secondary mt-6" onClick={() => { setSession(null); saveDefaultStore(null); }}><LogOut size={14} /> Sign out</button>
        </div>
      ) : (
        <form onSubmit={submit} className="surface mt-4 space-y-5 p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-goat-500/10 text-goat-400"><UserRound size={18} /></div>
            <div>
              <h2 className="text-lg font-semibold">{mode === "signin" ? "Sign in" : "Create your vault"}</h2>
              <p className="text-xs text-bone-500">A repo you own: it will hold your encrypted vault and your envelopes' ciphertext.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="GitHub owner"><input className="input mono" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="your-username" /></Field>
            <Field label="Repository"><input className="input mono" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="docugoat-data" /></Field>
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
            <Field label="GitHub token (write access to that repo)" hint="A fine-grained personal access token with Contents: Read & write on that one repository (make the repo public so signers can read). It's encrypted into your vault and travels inside signer links so they can write their signature back.">
              <input className="input mono" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" />
            </Field>
          )}
          <button className="btn-primary w-full" disabled={busy || !username.trim() || passphrase.length < 8 || (mode === "create" && !token.trim())}>
            {busy ? <><Spinner /> Deriving key…</> : <><KeyRound size={14} /> {mode === "signin" ? "Unlock vault" : "Create vault"}</>}
          </button>
          {passphrase.length > 0 && passphrase.length < 8 && <p className="text-center text-xs text-goat-400">Use at least 8 characters.</p>}
        </form>
      )}
      <p className="mt-4 text-center text-[11px] text-bone-500">Selected: <span className="mono">{storeLabel(store)}</span></p>
      {toast && <Toast message={toast.m} tone={toast.tone} onDone={() => setToast(null)} />}
    </div>
  );
}
