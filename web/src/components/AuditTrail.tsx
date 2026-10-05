import { Eye, FileLock2, PenLine, ShieldCheck, ShieldOff, ShieldQuestion } from "lucide-react";
import type { AuditEvent } from "../lib/types";

const ICON = { sealed: FileLock2, viewed: Eye, signed: PenLine };
const LABEL = { sealed: "Sealed", viewed: "Viewed", signed: "Signed" };

export function AuditTrail({ events, compact = false }: { events: AuditEvent[]; compact?: boolean }) {
  if (events.length === 0) return <p className="text-sm text-bone-500">No activity yet.</p>;
  return (
    <ol className="relative space-y-3 border-l hairline pl-5">
      {events.map((e, i) => {
        const Icon = ICON[e.kind];
        return (
          <li key={`${e.kind}-${e.relayId ?? i}`} className="relative">
            <span className={`absolute -left-[29px] top-0.5 grid h-4 w-4 place-items-center rounded-full border hairline ${e.kind === "signed" ? "bg-moss-500/20 text-moss-400" : "bg-ink-700 text-bone-400"}`}><Icon size={9} /></span>
            <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-semibold">{LABEL[e.kind]}</span>
              <span className="text-bone-300">{e.who}</span>
              <span className="text-xs text-bone-500">{new Date(e.at).toLocaleString()}</span>
            </div>
            {!compact && (
              <p className="mono mt-0.5 text-[11px] text-bone-500">
                {e.ip ? `ip ${e.ip}` : "ip —"}{e.userAgent ? ` · ${shortUa(e.userAgent)}` : ""}
                {" · "}
                {e.attested === true ? <span className="text-moss-400"><ShieldCheck size={10} className="inline" /> relay-attested</span>
                  : e.attested === false ? <span className="text-blood-400"><ShieldOff size={10} className="inline" /> attestation invalid</span>
                  : <span><ShieldQuestion size={10} className="inline" /> unattested</span>}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function shortUa(ua: string): string {
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Linux/.test(ua) ? "Linux" : "";
  const br = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return [br, os].filter(Boolean).join(" · ") || ua.slice(0, 40);
}
