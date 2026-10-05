import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="#f5b400" />
      <path d="M8 7c0 6 3 9 8 10 5-1 8-4 8-10" stroke="#08090b" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M11 17c-1 4 0 7 5 8 5-1 6-4 5-8" stroke="#08090b" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="13" cy="20" r="1.4" fill="#08090b" /><circle cx="19" cy="20" r="1.4" fill="#08090b" />
    </svg>
  );
}

export function CopyButton({ value, label = "Copy", className = "" }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(false), 1600); return () => clearTimeout(t); }, [done]);
  return (
    <button type="button" className={`btn-secondary btn-sm ${className}`} onClick={() => navigator.clipboard.writeText(value).then(() => setDone(true))}>
      {done ? <Check size={14} className="text-moss-400" /> : <Copy size={14} />} {done ? "Copied" : label}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-bone-500">{hint}</span>}
    </label>
  );
}

export function Pill({ tone = "neutral", children }: { tone?: "neutral" | "good" | "warn" | "bad"; children: ReactNode }) {
  const tones = {
    neutral: "bg-ink-600 text-bone-400 border-white/10",
    good: "bg-moss-500/10 text-moss-400 border-moss-500/30",
    warn: "bg-goat-500/10 text-goat-400 border-goat-500/30",
    bad: "bg-blood-500/10 text-blood-400 border-blood-500/30",
  };
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>{children}</span>;
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-bone-500/40 border-t-goat-400 ${className}`} />;
}

export function Toast({ message, tone = "neutral", onDone }: { message: string; tone?: "neutral" | "bad" | "good"; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3200); return () => clearTimeout(t); }, [onDone]);
  const color = tone === "bad" ? "border-blood-500/40" : tone === "good" ? "border-moss-500/40" : "hairline";
  return (
    <div className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rise-in rounded-xl border ${color} bg-ink-700 px-4 py-2.5 text-sm shadow-card`}>{message}</div>
  );
}
