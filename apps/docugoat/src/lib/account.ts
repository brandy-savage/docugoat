// Owner account for the GitHub backend: username + passphrase derive a key that encrypts the owner's vault
// (envelope codes, link secrets, the data-repo write token). The encrypted vault is stored in the data repo
// itself, so the owner can sign in from any device with just those two secrets. GitHub only ever sees ciphertext.
import { decryptJson, deriveKey, encryptJson, fromB64, randomBytes, sha256Hex, toB64 } from "./crypto";
import { readFile, writeFile, type GhConfig } from "./github";
import { loadVault, type VaultRecord } from "./vault";

export interface AccountVault { v: 1; username: string; token: string; records: VaultRecord[]; updatedAt: string }
interface StoredAccount { v: 1; kdf: { salt: string; iterations: number }; cipher: { iv: string }; ciphertext: string }

export interface Session { username: string; key: CryptoKey; cfg: GhConfig; vault: AccountVault; path: string; salt: string }

export async function accountPath(username: string): Promise<string> {
  return `vault/${(await sha256Hex(`docugoat:account:${username.trim().toLowerCase()}`)).slice(0, 32)}.json`;
}

async function accountKey(username: string, passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  // Reuse the envelope KDF with the username standing in for the link secret; the passphrase is the "code".
  return deriveKey(passphrase, `account:${username.trim().toLowerCase()}`, salt);
}

export async function signIn(cfg: GhConfig, username: string, passphrase: string): Promise<Session> {
  const path = await accountPath(username);
  const file = await readFile(cfg, path);
  if (!file) throw new Error("No account found for that username on this data repo.");
  const stored: StoredAccount = JSON.parse(file.content);
  const key = await accountKey(username, passphrase, fromB64(stored.kdf.salt));
  let vault: AccountVault;
  try { vault = await decryptJson<AccountVault>(key, { iv: stored.cipher.iv, ciphertext: stored.ciphertext }); }
  catch { throw new Error("Wrong passphrase."); }
  return { username, key, cfg: { ...cfg, token: vault.token }, vault, path, salt: stored.kdf.salt };
}

export async function createAccount(cfg: GhConfig, username: string, passphrase: string, token: string): Promise<Session> {
  const path = await accountPath(username);
  if (await readFile(cfg, path)) throw new Error("That username already has a vault here. Sign in instead.");
  const salt = randomBytes(16);
  const key = await accountKey(username, passphrase, salt);
  const vault: AccountVault = { v: 1, username, token, records: loadVault(), updatedAt: new Date().toISOString() };
  const sealed = await encryptJson(key, vault);
  const stored: StoredAccount = { v: 1, kdf: { salt: toB64(salt), iterations: 600_000 }, cipher: { iv: sealed.iv }, ciphertext: sealed.ciphertext };
  await writeFile({ ...cfg, token }, path, JSON.stringify(stored), `vault create`);
  return { username, key, cfg: { ...cfg, token }, vault, path, salt: toB64(salt) };
}

/** Re-encrypt and push the vault after records change. */
export async function saveAccount(session: Session, records: VaultRecord[]): Promise<Session> {
  const vault: AccountVault = { ...session.vault, records, updatedAt: new Date().toISOString() };
  const sealed = await encryptJson(session.key, vault);
  const current = await readFile(session.cfg, session.path);
  const stored: StoredAccount = { v: 1, kdf: { salt: session.salt, iterations: 600_000 }, cipher: { iv: sealed.iv }, ciphertext: sealed.ciphertext };
  await writeFile(session.cfg, session.path, JSON.stringify(stored), `vault update`, current?.sha);
  return { ...session, vault };
}
