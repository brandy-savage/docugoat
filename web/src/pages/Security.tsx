export function Security() {
  const Row = ({ k, v }: { k: string; v: string }) => (
    <div className="grid gap-1 py-3 sm:grid-cols-[220px_1fr]"><dt className="text-sm font-semibold">{k}</dt><dd className="text-sm leading-6 text-bone-400">{v}</dd></div>
  );
  return (
    <div className="mx-auto max-w-3xl px-5 py-12">
      <p className="eyebrow">Security model</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">What the relay can and cannot see</h1>
      <p className="mt-4 leading-7 text-bone-400">
        docugoat is built so that the operator of the relay — us — is not someone you have to trust. Every secret is generated in your browser and
        the server is only ever handed ciphertext.
      </p>

      <h2 className="mt-10 text-lg font-semibold">The relay stores</h2>
      <dl className="divide-y hairline">
        <Row k="Ciphertext" v="AES-256-GCM output of the document and of each signature bundle, base64. Indistinguishable from random bytes without the key." />
        <Row k="KDF parameters" v="A random 16-byte salt and the PBKDF2 iteration count. These are not secrets." />
        <Row k="Timestamps & counts" v="When an envelope was sealed, when it expires, and how many signature blobs exist." />
        <Row k="Owner token hash" v="SHA-256 of a random token held only by the sender, used to authorize burning the envelope." />
        <Row k="Encrypted events" v="'Viewed' events, as ciphertext, so the owner can see who opened the document and when." />
      </dl>

      <h2 className="mt-10 text-lg font-semibold">IP addresses and the audit trail</h2>
      <p className="mt-2 text-sm leading-6 text-bone-400">
        DocuSign-style evidence (IP address, user agent, timestamp per event) matters for enforceability, so we produce it — without keeping it.
        When you view or sign, your browser asks the relay for a <em>receipt</em>: the relay signs (Ed25519) the current time, your IP, your user agent and the
        document hash, and returns it. Your browser encrypts that receipt into the same bundle as your signature. The relay writes nothing down. The owner
        later decrypts the bundle and verifies the relay's signature, so the certificate can state "signed from 203.0.113.7 at 14:02:11 UTC, attested by the relay"
        while the relay operator holds no IP log at all. Access logs are not retained by the relay process; put it behind a reverse proxy configured the same way.
      </p>

      <h2 className="mt-10 text-lg font-semibold">The relay never receives</h2>
      <dl className="divide-y hairline">
        <Row k="Access codes" v="Each recipient gets their own code, typed on their device and fed into PBKDF2 there. Codes are never sent in any request." />
        <Row k="The link secret" v="The #k=… fragment. Browsers do not transmit URL fragments to servers." />
        <Row k="Plaintext of anything" v="Titles, names, document bodies, signature images and ECDSA keys are all inside the ciphertext." />
        <Row k="Email addresses" v="We don't send notifications. You deliver the link and the code yourself, through channels you choose." />
      </dl>

      <h2 className="mt-10 text-lg font-semibold">Key derivation</h2>
      <p className="mt-2 text-sm leading-6 text-bone-400">
        A random 256-bit content key encrypts the document. For every recipient, that key is wrapped (AES-GCM) under
        PBKDF2-SHA256(<span className="mono">"docugoat:v1:" + theirCode + ":" + linkSecret</span>, salt, 600,000 iterations). A code therefore opens exactly one
        wrap, which is how the sender learns <em>which</em> recipient signed. Generated codes carry 60 bits of entropy and the link secret 128 bits: an attacker
        holding the ciphertext <em>and</em> the link still faces a 60-bit search at ~600k hashes per guess; one holding only a code has nothing to decrypt.
      </p>

      <h2 className="mt-10 text-lg font-semibold">Signatures</h2>
      <p className="mt-2 text-sm leading-6 text-bone-400">
        On signing, the browser generates an ephemeral ECDSA P-256 keypair, signs <span className="mono">docugoat:v1:&lt;sha256&gt;:&lt;name&gt;:&lt;time&gt;</span>,
        and bundles the public key, the signature, the drawn mark and the document hash. The bundle is encrypted under the envelope key and relayed. The sender
        verifies it locally, and also checks that the name in the bundle matches the recipient the unlocking code was issued to. Identity is established by
        possession of a per-recipient code plus the link, so deliver each code to the person it was issued for.
      </p>

      <h2 className="mt-10 text-lg font-semibold">Honest limits</h2>
      <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-bone-400">
        <li>The relay's git history retains ciphertext after burn or expiry until the operator prunes it. It remains undecryptable without the secrets.</li>
        <li>Anyone holding the link and a recipient's code can sign as that recipient. This mirrors email-based e-signature services; deliver codes over a channel that reaches the right person.</li>
        <li>Your browser holds the plaintext while a document is open, and the vault keeps codes in local storage on your device. Clear it on shared machines.</li>
        <li>Custom passphrases shorter than the generated code weaken the offline-attack margin.</li>
      </ul>
    </div>
  );
}
