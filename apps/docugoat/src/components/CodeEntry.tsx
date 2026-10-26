import { useEffect, useRef, useState } from "react";
import { normalizeCode } from "../lib/crypto";

const LEN = 12;

export function CodeEntry({ onSubmit, busy, error }: { onSubmit: (code: string) => void; busy: boolean; error: boolean }) {
  const [chars, setChars] = useState<string[]>(Array(LEN).fill(""));
  const [custom, setCustom] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => { refs.current[0]?.focus(); }, []);

  const value = chars.join("");
  const complete = value.length === LEN;

  function setAt(i: number, v: string) {
    const clean = normalizeCode(v);
    if (!clean) { setChars((c) => { const n = [...c]; n[i] = ""; return n; }); return; }
    setChars((c) => {
      const n = [...c];
      for (let k = 0; k < clean.length && i + k < LEN; k++) n[i + k] = clean[k];
      return n;
    });
    const next = Math.min(LEN - 1, i + clean.length);
    refs.current[next]?.focus();
    if (i + clean.length >= LEN) {
      const full = [...chars]; for (let k = 0; k < clean.length && i + k < LEN; k++) full[i + k] = clean[k];
      if (full.every(Boolean)) onSubmit(full.join(""));
    }
  }

  function onKey(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !chars[i] && i > 0) refs.current[i - 1]?.focus();
    if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
    if (e.key === "ArrowRight" && i < LEN - 1) refs.current[i + 1]?.focus();
    if (e.key === "Enter" && complete) onSubmit(value);
  }

  if (custom) {
    return (
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (customValue.trim()) onSubmit(customValue); }}>
        <input autoFocus className={`input mono text-center text-lg ${error ? "border-blood-500/60 shake" : ""}`} placeholder="passphrase"
          value={customValue} onChange={(e) => setCustomValue(e.target.value)} disabled={busy} type="password" />
        <div className="flex items-center justify-between">
          <button type="button" className="text-xs text-bone-500 hover:text-bone-200" onClick={() => setCustom(false)}>Use a standard code instead</button>
          <button className="btn-primary" disabled={busy || !customValue.trim()}>{busy ? "Unlocking…" : "Unlock"}</button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <div className={`flex items-center justify-center gap-1.5 sm:gap-2 ${error ? "shake" : ""}`}
        onPaste={(e) => { e.preventDefault(); setAt(0, e.clipboardData.getData("text")); }}>
        {chars.map((ch, i) => (
          <span key={i} className="contents">
            {i > 0 && i % 4 === 0 && <span className="mx-0.5 text-bone-500">–</span>}
            <input
              ref={(el) => { refs.current[i] = el; }}
              className={`code-cell ${error ? "border-blood-500/60" : ""}`}
              value={ch} maxLength={LEN} inputMode="text" autoComplete="one-time-code" disabled={busy}
              onChange={(e) => setAt(i, e.target.value)} onKeyDown={(e) => onKey(i, e)} onFocus={(e) => e.target.select()}
            />
          </span>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <button type="button" className="text-xs text-bone-500 hover:text-bone-200" onClick={() => setCustom(true)}>Sender used a custom passphrase?</button>
        <button type="button" className="btn-primary" disabled={busy || !complete} onClick={() => onSubmit(value)}>{busy ? "Unlocking…" : "Unlock"}</button>
      </div>
    </div>
  );
}
