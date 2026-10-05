import { ShieldAlert } from "lucide-react";
import { Logo } from "./ui";

/** WebCrypto only exists in secure contexts (https:// or localhost). Without it nothing here can work, so say so plainly. */
export function InsecureContext() {
  const httpsUrl = `https://${location.host.replace(/:\d+$/, "")}${location.pathname}${location.hash}`;
  return (
    <div className="grid min-h-full place-items-center px-5">
      <div className="surface max-w-lg p-8 text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center"><Logo size={40} /></div>
        <h1 className="text-xl font-semibold">docugoat needs a secure connection</h1>
        <p className="mt-3 text-sm leading-6 text-bone-400">
          Everything here is encrypted in your browser using WebCrypto, and browsers only enable it on <span className="mono">https://</span> pages (or <span className="mono">localhost</span>).
          You opened this page over plain <span className="mono">http://</span>, so the crypto engine is switched off.
        </p>
        <a href={httpsUrl} className="btn-primary mt-6 inline-flex">Open over HTTPS</a>
        <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-bone-500"><ShieldAlert size={12} /> Nothing was sent anywhere. Your draft is still on this device.</p>
      </div>
    </div>
  );
}
