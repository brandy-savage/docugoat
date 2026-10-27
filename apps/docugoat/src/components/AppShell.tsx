import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { FilePlus2, FileSearch, Shield, UserRound, Vault as VaultIcon } from "lucide-react";
import { Logo } from "./ui";
import { useEffect, useState } from "react";
import { currentStore, getSession, onSessionChange } from "../lib/config";
import { makeRelay } from "../lib/api";
import { storeLabel } from "../lib/store";

export function AppShell() {
  const { pathname } = useLocation();
  const [relayDown, setRelayDown] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => onSessionChange(() => tick((n) => n + 1)), []);
  const store = currentStore();
  useEffect(() => { if (store.kind === "relay") makeRelay(store.url).health().then(() => setRelayDown(false)).catch(() => setRelayDown(true)); else setRelayDown(false); }, [store.kind, store.kind === "relay" ? store.url : ""]);
  const session = getSession();
  const minimal = pathname.startsWith("/d/");
  const nav = "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-bone-400 hover:text-bone-100 hover:bg-ink-700 transition";
  const active = ({ isActive }: { isActive: boolean }) => (isActive ? `${nav} text-bone-100 bg-ink-700` : nav);
  return (
    <div className="flex min-h-full flex-col">
      <header className="no-print sticky top-0 z-40 border-b hairline bg-ink-900/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
          <Link to="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
            <Logo /> <span>docugoat</span>
          </Link>
          {!minimal && (
            <nav className="flex items-center gap-1">
              <NavLink to="/review" className={active}><FileSearch size={15} /> Review</NavLink>
              <NavLink to="/new" className={active}><FilePlus2 size={15} /> Compose</NavLink>
              <NavLink to="/vault" className={active}><VaultIcon size={15} /> Vault</NavLink>
              <NavLink to="/security" className={active}><Shield size={15} /> Security</NavLink>
              <NavLink to="/account" className={active}><UserRound size={15} /> {session ? session.username : "Account"}</NavLink>
            </nav>
          )}
          {minimal && <span className="eyebrow">end-to-end encrypted</span>}
        </div>
      </header>
      {relayDown && (
        <div className="no-print border-b border-goat-500/30 bg-goat-500/10 px-5 py-2 text-center text-xs text-goat-300">
          Can't reach the relay{store.kind === "relay" && store.url ? ` at ${store.url}` : ""}. Drafting works, but sealing and signing need a reachable store — choose one under Account.
        </div>
      )}
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="no-print border-t hairline py-6 text-center text-xs text-bone-500">
        Documents are encrypted on your device; the store only ever holds ciphertext. Current store: <span className="mono">{storeLabel(store)}</span>.
      </footer>
    </div>
  );
}
