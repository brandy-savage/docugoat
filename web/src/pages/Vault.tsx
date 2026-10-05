import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Flame, Trash2 } from "lucide-react";
import { Pill } from "../components/ui";
import { relay } from "../lib/api";
import { loadVault, removeRecord, type VaultRecord } from "../lib/vault";

type Status = { status: "active" | "expired" | "burned" | "gone"; signatureCount: number };

export function Vault() {
  const [records, setRecords] = useState<VaultRecord[]>(loadVault);
  const [status, setStatus] = useState<Record<string, Status>>({});

  useEffect(() => {
    records.forEach((r) =>
      relay.status(r.id)
        .then((s) => setStatus((m) => ({ ...m, [r.id]: { status: s.status, signatureCount: s.signatureCount } })))
        .catch(() => setStatus((m) => ({ ...m, [r.id]: { status: "gone", signatureCount: 0 } }))),
    );
  }, [records]);

  async function burn(r: VaultRecord) {
    if (!r.ownerToken || !confirm(`Burn "${r.title}"? This cannot be undone.`)) return;
    await relay.burn(r.id, r.ownerToken).catch(() => undefined);
    forget(r.id);
  }
  function forget(id: string) { removeRecord(id); setRecords(loadVault()); }

  return (
    <div className="mx-auto max-w-4xl px-5 py-10">
      <p className="eyebrow">This device only</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Vault</h1>
      <p className="mt-1 text-sm text-bone-500">Codes and links for envelopes you've sealed or signed live in this browser's local storage — never on the relay.</p>

      {records.length === 0 ? (
        <div className="surface mt-8 p-10 text-center text-sm text-bone-500">Nothing here yet. <Link to="/new" className="text-goat-400 underline underline-offset-4">Create a document</Link>.</div>
      ) : (
        <ul className="surface mt-8 divide-y hairline">
          {records.map((r) => {
            const s = status[r.id];
            const tone = !s ? "neutral" : s.status === "active" ? "good" : "bad";
            const signerCount = (r.issued?.filter((c) => c.role === "signer").length) ?? 0;
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/d/${r.id}#k=${r.fragmentSecret}`} className="truncate font-semibold hover:text-goat-400">{r.title}</Link>
                    <Pill tone={r.role === "owner" ? "warn" : "neutral"}>{r.role}</Pill>
                    <Pill tone={tone}>{s ? s.status : "…"}</Pill>
                  </div>
                  <p className="mt-1 text-xs text-bone-500">
                    {r.role === "owner" ? `sealed ${new Date(r.createdAt).toLocaleDateString()} · ${s ? `${s.signatureCount}/${signerCount} signed` : ""}` : `signed as ${r.signerName} on ${new Date(r.createdAt).toLocaleDateString()}`} · expires {new Date(r.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {r.role === "owner" && <Link to={`/share/${r.id}`} className="btn-secondary btn-sm">Codes</Link>}
                  {r.role === "owner" && s?.status === "active" && <button className="btn-danger btn-sm" onClick={() => burn(r)}><Flame size={12} /> Burn</button>}
                  <button className="btn-ghost btn-sm" title="Forget on this device" onClick={() => forget(r.id)}><Trash2 size={12} /></button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
