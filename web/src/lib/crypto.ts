// All cryptography happens here, in the browser. The relay only ever sees the outputs of
// encrypt(); the code, the URL fragment secret and every plaintext never leave this device.

export const KDF_ITERATIONS = 600_000;
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const te = new TextEncoder();
const td = new TextDecoder();

export function toB64(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s);
}
export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
}
export function toB64Url(bytes: Uint8Array): string {
  return toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));
}
export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 12 Crockford-base32 chars = 60 bits of entropy, grouped for humans: XXXX-XXXX-XXXX */
export function generateCode(): string {
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) out += CROCKFORD[bytes[i] % 32];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

/** Forgiving normalization: case, separators, and the usual O/0 I/1 confusions. */
export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}
export function formatCode(normalized: string): string {
  return normalized.match(/.{1,4}/g)?.join("-") ?? normalized;
}

export function generateFragmentSecret(): string {
  return toB64Url(randomBytes(16));
}
export function generateOwnerToken(): string {
  return toB64Url(randomBytes(24));
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", te.encode(text)));
}

export async function deriveKey(
  code: string,
  fragmentSecret: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations = KDF_ITERATIONS,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    te.encode(`docugoat:v1:${normalizeCode(code)}:${fragmentSecret}`),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export interface Sealed { iv: string; ciphertext: string }

export async function encryptJson(key: CryptoKey, value: unknown): Promise<Sealed> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(JSON.stringify(value)));
  return { iv: toB64(iv), ciphertext: toB64(ct) };
}

/** Throws on a wrong key: AES-GCM authentication fails, so a bad code yields nothing at all. */
export async function decryptJson<T>(key: CryptoKey, sealed: Sealed): Promise<T> {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(sealed.iv) },
    key,
    fromB64(sealed.ciphertext),
  );
  return JSON.parse(td.decode(pt));
}

// Per-signature ECDSA P-256 keypair, generated on the signer's device.
export interface EcdsaSignature { publicKeyJwk: JsonWebKey; signature: string; fingerprint: string }

export function signingMessage(documentSha256: string, signerName: string, signedAt: string): string {
  return `docugoat:v1:${documentSha256}:${signerName}:${signedAt}`;
}

export async function ecdsaSign(message: string): Promise<EcdsaSignature> {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, te.encode(message));
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const spki = await crypto.subtle.exportKey("spki", kp.publicKey);
  const fingerprint = toHex(await crypto.subtle.digest("SHA-256", spki)).slice(0, 16);
  return { publicKeyJwk, signature: toB64(sig), fingerprint };
}

export async function ecdsaVerify(message: string, sig: EcdsaSignature): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("jwk", sig.publicKeyJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, fromB64(sig.signature), te.encode(message));
  } catch {
    return false;
  }
}

// ---- Envelope v2: one random content key, wrapped once per recipient under their own code ----

export async function generateContentKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export async function wrapContentKey(contentKey: CryptoKey, recipientKey: CryptoKey): Promise<Sealed> {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", contentKey));
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, recipientKey, raw);
  return { iv: toB64(iv), ciphertext: toB64(ct) };
}

/** Returns null when this recipient key doesn't open the wrap (i.e. the code belongs to another slot, or is wrong). */
export async function unwrapContentKey(wrap: Sealed, recipientKey: CryptoKey): Promise<CryptoKey | null> {
  try {
    const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(wrap.iv) }, recipientKey, fromB64(wrap.ciphertext));
    return await crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  } catch {
    return null;
  }
}

// ---- Relay receipts (Ed25519) ----

/** true/false when verifiable; null when this browser lacks WebCrypto Ed25519. */
export async function verifyReceipt(receipt: string, sigB64: string, publicKeyB64: string, expectedKeyB64?: string): Promise<boolean | null> {
  if (expectedKeyB64 && expectedKeyB64 !== publicKeyB64) return false;
  try {
    const key = await crypto.subtle.importKey("raw", fromB64(publicKeyB64), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, fromB64(sigB64), te.encode(receipt));
  } catch (e) {
    return e instanceof DOMException && /NotSupported|not supported|Unrecognized/i.test(e.message) ? null : false;
  }
}
