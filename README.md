# docugoat

Zero-knowledge e-signatures. Write in markdown, seal it in your browser, hand each signer a link and their own access code. The relay only ever carries ciphertext.

- **Per-recipient codes** — a random content key is wrapped once per recipient (PBKDF2-SHA256 of code + link secret). A code opens exactly one slot, so the owner knows who signed.
- **Signature fields** — `[[sign: Name]]`, `[[date: Name]]`, `[[initials: Name]]` are markdown tokens; chips in the editor, filled inline after signing.
- **Verifiable signatures** — drawn mark + ephemeral ECDSA P-256 over the document hash, encrypted and relayed back.
- **Relay-attested audit trail** — the relay Ed25519-signs time / IP / user agent / hash at seal, view and sign; the browser encrypts the receipt into the bundle. The relay keeps no plaintext IP log.
- **On-device PDF** — document, filled signatures, certificate and audit trail (pdfmake).

## Two ways to run it

| Mode | Where ciphertext lives | Evidence per event | Needs |
| --- | --- | --- | --- |
| **Serverless (GitHub Pages)** | a public *data repo* on GitHub, written straight from the browser via the Contents API | GitHub-recorded commit time + sha | a fine-grained token with Contents: read/write on the data repo |
| **Relay** | an Express relay you host, isolated git repo on disk | relay Ed25519 receipt: time, IP, user agent, hash | a server with public HTTPS |

In serverless mode the owner signs in with a **username + passphrase**. Those derive a key that encrypts the owner's vault (envelope codes, link secrets, the data-repo token), and the encrypted vault is stored in the data repo too — so any device with the two secrets can pick up where another left off. Signers never need an account: their link carries the data-repo write token in the URL fragment, so their browser can commit the encrypted signature itself.

## Layout

| Path | What |
| --- | --- |
| `web/` | Vite + React app. All crypto happens here. |
| `server/` | Express relay. Stores ciphertext in an isolated git repo under `server/data/relay`. |

## Run locally

```sh
npm install
npm run dev          # relay on http://localhost:4173, web on https://localhost:5183 (self-signed)
```

WebCrypto only exists in secure contexts, so the web app must be served over **HTTPS** or `localhost`.

Tests (`cd web`): `npm test` — editor round-trip in jsdom, PDF render through pdfmake's Node printer, and a 25-check end-to-end run of the real crypto module against a live relay.

## Deploy

### Web app → GitHub Pages (serverless)

1. Create a **public** data repo (default name `docugoat-data`). It will only ever contain ciphertext.
2. `npm run deploy:pages` builds `web/` with `VITE_BASE=/<repo>/ VITE_BACKEND=github VITE_GH_OWNER=<you> VITE_GH_DATA_REPO=docugoat-data` and pushes the output to the `gh-pages` branch. Override with `DATA_REPO=…`, or `BACKEND=relay RELAY_URL=https://relay.example.com` for relay mode.
3. On the site, open **Sign in → Create**: choose a username and passphrase, and paste a **fine-grained personal access token** (GitHub → Settings → Developer settings → Fine-grained tokens) scoped to the data repo with *Contents: Read and write*. That token is encrypted into your vault and travels inside signer links; it can write to that one repo and nothing else.

Rate limits: anonymous GitHub API reads are 60/hour per IP; authenticated ones (owners signed in, signers via the link token) are 5,000/hour.

An equivalent GitHub Actions workflow lives at `deploy/pages-workflow.yml`; move it to `.github/workflows/pages.yml` once your token has the `workflow` scope (`gh auth refresh -s workflow`) and set the repository variable `RELAY_URL`.

### Relay → anywhere with Docker

```sh
docker build -f server/Dockerfile -t docugoat-relay .
docker run -d -p 4173:4173 -v docugoat-data:/app/server/data \
  -e ALLOWED_ORIGINS=https://<user>.github.io docugoat-relay
```

Put it behind TLS (Caddy, nginx, a tunnel) — the Pages site is HTTPS and browsers refuse mixed content. `ALLOWED_ORIGINS` is the comma-separated list of origins allowed to call the relay. The relay's attestation key is created on first start at `server/data/relay-ed25519.json`; keep the volume.

## Security model

See the in-app **Security** page: what the relay stores (ciphertext, KDF salt, timestamps, an owner-token hash), what it never receives (codes, the link secret, any plaintext, email addresses), how receipts work, and the honest limits.
