# docugoat

Zero-knowledge e-signatures. Write in markdown, seal it in your browser, hand each signer a link and their own access code. The relay only ever carries ciphertext.

- **Per-recipient codes** — a random content key is wrapped once per recipient (PBKDF2-SHA256 of code + link secret). A code opens exactly one slot, so the owner knows who signed.
- **Signature fields** — `[[sign: Name]]`, `[[date: Name]]`, `[[initials: Name]]` are markdown tokens; chips in the editor, filled inline after signing.
- **Verifiable signatures** — drawn mark + ephemeral ECDSA P-256 over the document hash, encrypted and relayed back.
- **Relay-attested audit trail** — the relay Ed25519-signs time / IP / user agent / hash at seal, view and sign; the browser encrypts the receipt into the bundle. The relay keeps no plaintext IP log.
- **On-device PDF** — document, filled signatures, certificate and audit trail (pdfmake).

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

### Web app → GitHub Pages

`npm run deploy:pages` builds `web/` with `VITE_BASE=/<repo>/` and pushes the output to the `gh-pages` branch, which GitHub Pages serves. Pass the relay origin so the static site knows where to talk:

```sh
RELAY_URL=https://relay.example.com npm run deploy:pages
```

Without `RELAY_URL` the site loads and drafting works, but sealing cannot reach a relay.

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
