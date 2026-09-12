# NTG · CTCCS — TrustLC Mock Customs Portal

**National Trade Documentation Gateway** running the **Consignment Tracking & Customs
Clearance System v2.4.1** — a standalone mock government portal, and the real-world data
source the TrustLC attestation layer proves against.

> **[PORTAL_SPEC.md](PORTAL_SPEC.md) is the contract.** Field names, key order and status
> codes are frozen. Read it before changing anything that appears in a response body.

## Why this exists

zkTLS cannot prove something out of thin air. It proves *"the server at this address really
did send me these exact bytes."* So something must be on the other end of that request — a
real, reachable HTTPS endpoint playing the part of a customs authority. That is this app.

```
1. An exporter registers a consignment against LC-2026-0417
2. The Kochi customs officer lodges the documents, then records dispatch
3. An attestor fetches GET /ctccs/api/v2/consignment/SHP-88214 over HTTPS
4. TLSNotary produces a cryptographic proof of what this server replied
5. The backend relays that proof to Escrow.sol
6. The contract advances the escrow from Created → Shipped
```

This is a **separate deliverable**, not part of the TrustLC frontend: different app,
different repo, its own hosted URL.

## Running locally

```bash
npm install
cp .env.example .env      # then set OFFICER_PIN and TRADER_PIN
npm start                 # npm run dev for auto-restart
npm test                  # 27 tests, no network or fixtures needed
```

Open <http://localhost:4000>. First start off a OneDrive folder can take ~10 seconds.
`npm run seed` puts the records back to their seed state.

**Windows PowerShell** blocks `npm.ps1` by default. Use `npm.cmd start`, or run
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.

## Who can do what

| Actor | Signs in | Can |
|---|---|---|
| **Public** | no | Track by reference, browse the register, read the API |
| **Exporter** | `TRD-1001`…`TRD-1003` | Register consignments, amend before lodgement, withdraw before dispatch |
| **Officer** | `VDN-4471`, `NL-CUST-221`, … | Lodge, dispatch, clear, hold — **only at their own station** |

## A five-minute walkthrough

1. **Track** `SHP-88214` signed out. This is the public view an attestor reads.
2. Sign in as **`TRD-1001`** → **New consignment**. Register one — try a bad HS code first
   and watch it refuse. The record appears at `booking_confirmed`.
3. Amend it (quantity, say) and check the **Amendment history** panel: before → after,
   who, when. Amendment closes the moment documents are lodged.
4. Sign out, sign in as **`VDN-4471`** (Kochi). Your **Work queue** shows only consignments
   at INCOK — including the one just registered.
5. Lodge documents, then record **Dispatched**. The bill of lading is issued automatically.
6. Try to record **Customs cleared** yourself → `403`. Clearance belongs to Rotterdam.
7. Sign in as **`NL-CUST-221`** and clear it. A customs entry declaration is filed.
8. Open **Public API** and hit the attestation endpoint. Refresh repeatedly — byte-identical
   every time. That is the property Phase 3 depends on.

## Routes

Full reference in [PORTAL_SPEC.md §3](PORTAL_SPEC.md).

| Method | Route | Auth |
|---|---|---|
| GET | `/healthz` | — |
| GET | `/ctccs/api/v2/track?ref=` | — |
| GET | `/ctccs/api/v2/consignments` | — |
| GET | `/ctccs/api/v2/consignment/:id` | — **attestation target** |
| GET | `/ctccs/api/v2/consignment/:id/{movements,entries,amendments}` | — |
| GET | `/ctccs/api/v2/reports/summary` | — |
| POST | `/ctccs/auth/session` | — sign in |
| POST | `/ctccs/trader/consignments` | trader |
| PATCH | `/ctccs/trader/consignment/:id` | trader |
| POST | `/ctccs/trader/consignment/:id/withdraw` | trader |
| GET | `/ctccs/officer/queue` | officer |
| POST | `/ctccs/officer/consignment/:id/status` | officer |

Reads are public by design: an attestor carrying an API key would leak it into the very TLS
session being proven.

## The rule that protects Phase 3

`GET /ctccs/api/v2/consignment/:id` is **byte-stable**. No `generatedAt`, no request id, no
nonce; fixed key order; `recordHash` recomputed only when the record changes.

If the body varied per request, honest attestors would prove different byte strings, M-of-N
consensus would fail, and the escrow would stall with nothing actually wrong.

**Do not add a per-request field to that route.** Anything time-varying goes on
`/movements`, which no proof reads. There is a test for this.

## Production posture

| Concern | How it is handled |
|---|---|
| Config | Validated at boot; **refuses to start in production** on default PINs |
| Credentials | scrypt hashes, per-account salt, constant-time comparison |
| Sessions | Bearer tokens, 30-minute expiry, swept periodically, in memory only |
| Brute force | Sign-in rate limited per IP; generic failure message |
| Input | Every field validated for shape and range before it reaches the store |
| Writes | Atomic — temp file, fsync, rename — and serialised, so concurrent officers cannot lose an update |
| Errors | One envelope, machine code plus human sentence; no stack traces to clients |
| Headers | helmet, CSP, no `x-powered-by`; 64 KB body cap |
| Shutdown | SIGTERM drains in-flight requests before exit |
| Logging | One structured JSON line per request; request bodies never logged |
| Tests | 27 covering lifecycle, permissions, validation, concurrency and byte-stability |

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `PORT` | 4000 | Render sets this — do not override there |
| `NODE_ENV` | development | `production` makes default PINs fatal and disables reset |
| `OFFICER_PIN` | `4471` | **Change before deploying** |
| `TRADER_PIN` | `1001` | **Change before deploying** |
| `DATA_FILE` | `./data/consignments.json` | Point at a mounted disk if you want persistence |
| `SESSION_TTL_MINUTES` | 30 | |
| `SIGNIN_LIMIT` | 20 | Sign-in attempts per IP per 10 minutes |
| `CORS_ORIGINS` | `*` | Reads are public; an attestor may fetch from anywhere |

## Deploying to Render (free)

1. Push this folder to GitHub as its own repo.
2. Render → **New → Web Service** → connect the repo.
3. Build `npm install`, start `npm start`.
4. Set `NODE_ENV=production`, `OFFICER_PIN`, `TRADER_PIN`. Do **not** set `PORT`.
5. You get a free `.onrender.com` HTTPS URL. **That URL becomes part of what every proof
   asserts** — fix it before Phase 3 starts.

### The thing that will bite you in the viva

Free Render services **sleep after 15 minutes idle** and take ~60 seconds to wake. A cold
link during your demo looks like a broken project. Five minutes before, run:

```bash
curl https://YOUR-SERVICE.onrender.com/healthz
```

Render's disk also resets on redeploy, so records return to seed — convenient for repeat demos.

## Known simplifications

Listed in [PORTAL_SPEC.md §6](PORTAL_SPEC.md). In short: one portal serves both dispatch and
clearance; PINs are shared per role; station timezones are fixed offsets; declared value is
fiat while the escrow holds POL; UN/LOCODE and HS codes are validated by shape rather than
against the official datasets.
