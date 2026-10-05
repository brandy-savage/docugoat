export type Role = "owner" | "signer";

export interface Recipient {
  slot: number;
  name: string;       // empty string = open slot, signer types their own name
  role: Role;
  /** Owner slot only: the sender is also a signing party. */
  signs?: boolean;
}

/** Relay-signed receipt. `receipt` is the exact canonical JSON the relay signed; parse it for display. */
export interface AttestedReceipt { receipt: string; sig: string; publicKey: string; keyId: string }
export interface ReceiptBody {
  v: 1; keyId: string; envelopeId: string; action: "seal" | "view" | "sign";
  documentSha256: string | null; nonce: string; receivedAt: string; ip: string; userAgent: string;
}

export interface DocumentPayload {
  v: 2;
  title: string;
  markdown: string;
  createdAt: string;
  author: string;
  recipients: Recipient[];
}

export interface SignaturePayload {
  v: 2;
  slot: number;
  signerName: string;
  signedAt: string;
  documentSha256: string;
  signatureImage: string;
  ecdsa: { publicKeyJwk: JsonWebKey; signature: string; fingerprint: string };
  userAgent: string;
  receipt?: AttestedReceipt;
}

export interface ViewEventPayload {
  v: 1;
  kind: "viewed";
  slot: number;
  name: string;
  at: string;
  receipt?: AttestedReceipt;
}

export interface AuditEvent {
  kind: "sealed" | "viewed" | "signed";
  at: string;
  who: string;
  slot: number | null;
  ip?: string;
  userAgent?: string;
  attested: boolean | null;   // null = no receipt / can't verify on this browser
  relayId?: string;
}

export interface KeyWrap { slot: number; iv: string; ciphertext: string }

export interface RelayEnvelope {
  v: 2;
  id: string;
  createdAt: string;
  expiresAt: string;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  wraps: KeyWrap[];
  cipher: { name: "AES-GCM"; iv: string };
  ciphertext: string;
  signatureCount: number;
}

export interface RelaySignature {
  id: string;
  createdAt: string;
  cipher: { name: "AES-GCM"; iv: string };
  ciphertext: string;
}

export interface VerifiedSignature extends SignaturePayload {
  relayId: string;
  relayCreatedAt: string;
  hashMatches: boolean;
  ecdsaValid: boolean;
  /** The name in the bundle matches the recipient the code was issued to (or the slot was open). */
  nameBound: boolean;
  recipientName: string;
  /** Relay receipt verified against the relay's Ed25519 key. null when absent or unverifiable. */
  receiptValid: boolean | null;
  receiptBody: ReceiptBody | null;
}
