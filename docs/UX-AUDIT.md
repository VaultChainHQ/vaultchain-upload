# Upload site: UX audit and what changed

Audited on 25 Oct 2026 (America/New_York), before and after the redesign. Screenshots of every step of the new flow are produced by `npm run e2e` (see below).

## What was wrong (before)

1. **A key was a plain hex string in `localStorage`.** No passphrase, and a different key store from the VaultChain web vault, so profiles could not be moved between the two sites.
2. **One long page.** Keys, balance, upload, files and sharing were all on screen at once. Nothing said what to do first.
3. **No way to get funds.** The README told people to ask the operator. A new visitor could not upload anything.
4. **Jargon everywhere.** "Replication", "blocks", "uvault", "manifest", "deal", "grant". Costs were not shown before signing.
5. **Duration was a raw block count.** There was no estimate of cost or time.
6. **Progress was a log line.** A failure showed a raw error string and nothing about what to try next.
7. **Sharing failed late.** Granting to an address that had never signed a transaction threw "pubkey unknown" after the person had typed everything in.
8. **No share link, no search, no preview, no contacts, no empty states, no mobile layout.**

## What changed

| Area | Now |
| --- | --- |
| Keys | Passphrase-encrypted multi-profile keystore (same format as the web vault: scrypt + AES-256-GCM, so backups are interchangeable). Old plain keys are found and offered for migration with a plain prompt; nothing is deleted until you agree. |
| Flow | A 7-step guided stepper: Profile, Funds, Files, Options, Review, Upload, Done. Locked steps say why. State survives browsing to other pages; a banner shows a running upload and a `beforeunload` guard protects it. |
| Funds | A "Get 100 devnet VAULT" button calls the web app's `/api/faucet` directly from the browser (exact-origin CORS, so the faucet's rate limit sees the visitor's own address and IP). Cooldown and "busy" cases get plain messages. |
| Files | Drag and drop or picker, multiple files, per-file and per-batch limits with a reason for each refusal, image preview thumbnails. |
| Options | Private or public in plain words; a duration picker (about 1 hour to 3 days) with a VAULT price per choice; copies fixed at 1 and explained. |
| Review | A line-by-line cost (storage plus network fees), your balance after, and a clear block if you cannot afford it. |
| Progress | A per-file checklist in plain language, retry for failures (finished steps are not repeated), a friendly error with the technical text one click away. |
| Done | Share link, Copy, a dependency-free QR code, "View in explorer", next steps. |
| My files | Search, filter (all, private, public, needs attention), sort, health badge per file, download, preview, share by address or contact, revoke, storage details, `/files?open=<id>` deep links. A "Shared with me" tab. |
| Sharing | Checks the recipient's public key first. If it is missing the UI explains why and offers a message to send them, plus "Check again". Accounts get a one-click "Publish my key". Public files get an automatic public grant. |
| Everything else | Contacts, toasts, empty states, a glossary on hover or focus for jargon, dark default plus light theme, keyboard support, mobile-first layout, shared VaultChain header, footer, cross-navigation, favicon and social card. |

## Decisions

* **Faucet from the browser, not proxied.** A proxy would make every visitor share the proxy's IP in the faucet's limiter. The faucet allows only this site's origin by default (`FAUCET_ALLOWED_ORIGINS` on the web project).
* **Copies is not offered.** There is one provider and replication is fixed at 1. The UI says so rather than showing a control that does nothing.
* **Per-file limit is 64 MiB** because the whole file and its ciphertext sit in browser memory. The CLI handles more.
* **Public links open this app**, so a recipient needs a (free) profile. The page says so.
* **Previews** use only an allow-list of media types as typed blobs, never HTML or SVG, and are capped (25 MiB, text 512 KiB).
* **Devnet warnings stay visible** in the header badge and the footer, and in the Account page, without a banner on every screen.

## Security properties kept

* Keys are created, encrypted and used in the browser only. Nothing secret is sent to any server.
* The faucet and node get an address, never a key.
* The Go-vs-TypeScript vector tests are unchanged and pass.

## Tests

* `npm test`: unit tests for format, cost and duration, the stepper and upload queue (including retry and resume), friendly errors, the faucet client, library search and filters, legacy key parsing, QR (round-tripped through a decoder), the keystore, plus the existing Go vector tests.
* `npm run e2e`: a headless browser walks the whole flow against a running copy (default http://localhost:3000; set BASE to test the live site) with a throwaway profile: create profile, faucet, choose files, options, review, upload a private and a public file, share link, library, search, filters, contacts, mobile layout. Env: `BASE`, `SHOTS`, `CHROME`, `FAUCET_URL`. It needs `playwright-core` and a Chrome; it is not part of CI.

## Not done / known gaps

* No Vercel firewall rate limit on `/api/faucet` yet (the in-memory limiter is per instance).
* Short test durations show "Ends soon" and count as "needs attention".
* Files above 64 MiB, folders and resumable uploads across a page reload are not supported.
