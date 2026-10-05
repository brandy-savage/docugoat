import { CheckCircle2, XCircle } from "lucide-react";
import { isVerified } from "../lib/envelope";
import type { AuditEvent, DocumentPayload, VerifiedSignature } from "../lib/types";
import { AuditTrail } from "./AuditTrail";

interface Props { doc: DocumentPayload; envelopeId: string; documentSha256: string; signatures: VerifiedSignature[]; audit?: AuditEvent[] }

export function Certificate({ doc, envelopeId, documentSha256, signatures, audit }: Props) {
  const signers = doc.recipients.filter((r) => r.role === "signer" || r.signs);
  const outstanding = signers.filter((r) => !signatures.some((s) => s.slot === r.slot));
  return (
    <section className="cert print-page px-8 py-8">
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <div>
          <p className="eyebrow">Certificate of signatures</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">{doc.title}</h2>
        </div>
        <span className="mono text-[11px] text-bone-500">envelope {envelopeId}</span>
      </div>

      <dl className="mb-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-xs">
        <dt className="text-bone-500">Document SHA-256</dt><dd className="mono break-all">{documentSha256}</dd>
        <dt className="text-bone-500">Sealed by</dt><dd>{doc.author} · {new Date(doc.createdAt).toUTCString()}</dd>
        <dt className="text-bone-500">Encryption</dt><dd>AES-256-GCM. Per-recipient keys derived on-device (PBKDF2-SHA256). The relay never held a key or plaintext.</dd>
        <dt className="text-bone-500">Signatures</dt><dd>{signatures.filter(isVerified).length} verified of {signatures.length} recorded · {signers.length} recipient{signers.length === 1 ? "" : "s"}</dd>
      </dl>

      {signatures.length === 0 && <p className="text-sm text-bone-500">No signatures yet.</p>}

      {signatures.length > 0 && (
        <div className="divide-y hairline rounded-2xl border hairline">
          {signatures.map((s) => {
            const ok = isVerified(s);
            const why = !s.hashMatches ? "content mismatch" : !s.ecdsaValid ? "bad signature" : !s.nameBound ? `name mismatch (code issued to ${s.recipientName})` : "";
            return (
              <div key={s.relayId} className="grid grid-cols-[1fr_auto] gap-6 p-5">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold">{s.signerName}</span>
                    {ok
                      ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-moss-400"><CheckCircle2 size={13} /> verified</span>
                      : <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blood-400"><XCircle size={13} /> {why}</span>}
                  </div>
                  <p className="text-xs text-bone-400">Signed {new Date(s.signedAt).toUTCString()} · {s.slot === 0 ? "sender's own code" : `code issued to ${s.recipientName || "open slot"}`}</p>
                  {s.receiptBody && <p className="mono text-[11px] text-bone-500">ip {s.receiptBody.ip} · relay received {new Date(s.receiptBody.receivedAt).toISOString()} · {s.receiptValid === true ? "attested" : s.receiptValid === false ? "ATTESTATION INVALID" : "unverified"}</p>}
                  {s.fields && Object.keys(s.fields).length > 0 && (
                    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                      {Object.entries(s.fields).map(([k, v]) => <span key={k} className="contents"><dt className="text-bone-500">{k.split(":")[2] || k.split(":")[0]}</dt><dd>{k.startsWith("check:") ? (v === "yes" ? "☑ yes" : "☐ no") : v}</dd></span>)}
                    </dl>
                  )}
                  <p className="mono text-[11px] text-bone-500">key {s.ecdsa.fingerprint} · relay {s.relayId} · received {new Date(s.relayCreatedAt).toISOString()}</p>
                </div>
                <img src={s.signatureImage} alt={`${s.signerName} signature`} className="h-16 w-40 rounded-lg bg-white object-contain" />
              </div>
            );
          })}
        </div>
      )}

      {outstanding.length > 0 && <p className="mt-4 text-xs text-bone-500">Awaiting: {outstanding.map((r) => r.name || "open signer").join(", ")}</p>}

      {audit && (
        <div className="mt-8">
          <p className="eyebrow mb-3">Audit trail</p>
          <AuditTrail events={audit} />
        </div>
      )}

      <p className="mt-8 text-[11px] leading-5 text-bone-500">
        Each signature is an ECDSA P-256 signature over <span className="mono">docugoat:v1:&lt;sha256&gt;:&lt;signer&gt;:&lt;time&gt;</span>, produced by a key generated
        on the signer's device and relayed as ciphertext under the envelope key. Identity is established by possession of the recipient's own access code, which the sender delivered out-of-band.
      </p>
    </section>
  );
}
