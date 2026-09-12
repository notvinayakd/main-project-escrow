# CTCCS Portal — Frozen API Contract (v2)

**Frozen as of 2026-09-08.** Sections 2 and 3 are a contract between this portal and
`Escrow.sol`. Changing a field name, a status string, a status code or the key order breaks
every zkTLS proof already generated. Treat a change here like changing a smart-contract
function signature: it needs the whole team, not a pull request.

---

## 1. What this portal is

**National Trade Documentation Gateway (NTG)**, operating the **Consignment Tracking &
Customs Clearance System (CTCCS) v2.4.1** — a fictional government system where exporters
register consignments and customs officers record their movement and clearance.

It is the real-world data source the TrustLC attestation layer proves against. An attestor
makes a genuine HTTPS request to §3.2, TLSNotary witnesses the response, and the proof is
relayed to the escrow contract.

### 1.1 Actors

| Actor | Auth | May |
|---|---|---|
| **Public** | none | Track a consignment, browse the register, read the API. **This is the attestation surface.** |
| **Exporter** (trader) | account + PIN | Register consignments, amend before lodgement, withdraw before dispatch, view own book |
| **Customs officer** | account + PIN | Lodge documents, record dispatch and clearance, raise and release holds, work a station queue |

### 1.2 Scope decision, stated openly

A real deployment would read **two independent systems** — the carrier's for dispatch, the
destination customs authority's for clearance. This project collapses both into one portal.
That is a deliberate scoping decision for a student proof-of-concept, and should be said
plainly in the viva. The trust argument is unaffected: zkTLS proves *what a named server
said*, whether that server serves one event type or two.

---

## 2. The consignment record

### 2.1 Exact response body

`GET /ctccs/api/v2/consignment/SHP-88214` returns **this shape, in this key order**:

```json
{
  "consignmentId": "SHP-88214",
  "lcRef": "LC-2026-0417",
  "status": "dispatched",
  "statusCode": 3,
  "billOfLading": "KOCH-88214",
  "exporter":    { "name": "Malabar Spice Exports Pvt Ltd", "country": "IN" },
  "importer":    { "name": "Rotterdam Commodity BV", "country": "NL" },
  "vessel":      { "name": "MV Anjali Star", "imo": "9401235", "voyage": "AS-118W" },
  "origin":      { "port": "INCOK", "name": "Kochi" },
  "destination": { "port": "NLRTM", "name": "Rotterdam" },
  "commodity":   { "description": "Black pepper", "hsCode": "090411" },
  "quantity":    { "value": 12, "unit": "MT" },
  "declaredValue": { "amount": 74160, "currency": "USD" },
  "customsEntryNo": null,
  "statusSetBy": "VDN-4471",
  "statusSetAt": "2026-08-19T10:05:00+05:30",
  "recordHash": "0x1f9c4e…"
}
```

### 2.2 Field reference

| Field | Type | Standard / meaning |
|---|---|---|
| `consignmentId` | string | Portal reference, `SHP-#####`. The attestation target. |
| `lcRef` | string | The Letter of Credit. **Unique across live consignments** — see §2.6. |
| `status` | string | Lowercase snake_case, one of §2.4. **The field the contract reads.** |
| `statusCode` | integer | Numeric mirror. Contracts compare integers, not strings. |
| `billOfLading` | string \| null | Carrier's document of title. `null` until dispatch. |
| `exporter.name` / `.country` | string | Consignor and ISO 3166-1 alpha-2 country. |
| `importer.name` / `.country` | string | Consignee and country. |
| `vessel.name` / `.imo` / `.voyage` | string | Carrier vessel; `imo` is the permanent 7-digit hull id. |
| `origin.port` / `destination.port` | string | **UN/LOCODE**, e.g. `INCOK`, `NLRTM`. |
| `origin.name` / `destination.name` | string | Human-readable port names. |
| `commodity.description` | string | Plain description. |
| `commodity.hsCode` | string | **Harmonised System** 6-digit subheading, e.g. `090411`. |
| `quantity.value` / `.unit` | number / string | Unit ∈ `MT`, `KG`, `TEU`, `CBM`, `PCS`. |
| `declaredValue.amount` / `.currency` | number / string | Customs-declared value **in fiat** — see §2.3. |
| `customsEntryNo` | string \| null | Destination entry declaration (EU **ENS** format). `null` until cleared. |
| `statusSetBy` | string | Account id that set the current status. |
| `statusSetAt` | string | ISO 8601 **with offset**, in the recording station's local time. |
| `recordHash` | string | `0x` + SHA-256 of the canonical record — see §2.5. |

### 2.3 Why the value is fiat, not POL

No customs authority denominates cargo in a crypto token. The portal records what a real
declaration records — USD by default. The escrow contract separately holds POL on Polygon
Amoy. A production system would need an FX rate agreed at LC issuance or a price oracle;
saying so is a good viva answer rather than a gap.

### 2.4 Status lifecycle

| `status` | code | Set by | Contract reaction |
|---|---|---|---|
| `booking_confirmed` | 1 | exporter (registration) | none |
| `documents_lodged` | 2 | officer at **origin** | none |
| `dispatched` | 3 | officer at **origin** | proof advances escrow to state 2 (**Shipped**) |
| `customs_cleared` | 4 | officer at **destination** | proof advances escrow to state 3 (**Customs Cleared**) |
| `cancelled` | 98 | exporter or officer, **before dispatch** | escrow refunded |
| `held` | 99 | officer, either station | off-flow; dispute / arbitration branch |

Enforced server-side:

- Forward one step at a time. No skipping, no reversing.
- Dispatch only at `origin.port`; clearance only at `destination.port`.
- `held` may interrupt any live status and resumes where it left off.
- `cancelled` is impossible once dispatched — cargo on the water is not a paperwork matter.
- `customs_cleared` and `cancelled` are terminal.
- Dispatch issues `billOfLading`; clearance issues `customsEntryNo`.

### 2.5 `recordHash` canonicalisation

SHA-256 over the record with `recordHash` removed, serialised as compact JSON
(`JSON.stringify`, no whitespace) **in the key order of §2.1**, prefixed `0x`.
Recomputed **only when the record changes** — never per request. A verifier can therefore
recompute it from a proof and confirm the body was not altered in transit.

### 2.6 One LC, one consignment

A Letter of Credit backs exactly one live consignment. Registering or amending to an
`lcRef` already in use returns `409 lc_already_used` naming the existing consignment.
Without this, two records could claim the same escrow. Withdrawing a consignment releases
its reference.

---

## 3. Routes

### 3.1 Public reads — no authentication

| Route | Returns |
|---|---|
| `GET /healthz` | Liveness. Ping to wake a sleeping free-tier service. |
| `GET /ctccs/api/v2/track?ref=` | Track by consignment reference, bill of lading **or** LC reference. |
| `GET /ctccs/api/v2/consignments` | Register listing. Filters `q`, `status`, `port`; pages via `page`, `pageSize` (max 100). |
| `GET /ctccs/api/v2/consignment/:id` | **Attestation target** — §2.1. |
| `GET /ctccs/api/v2/consignment/:id/movements` | Movement & clearance history. |
| `GET /ctccs/api/v2/consignment/:id/entries` | Customs entry declarations. |
| `GET /ctccs/api/v2/consignment/:id/amendments` | Declaration amendment trail. |
| `GET /ctccs/api/v2/reports/summary` | Aggregates by status, route and exporter. |
| `GET /ctccs/api/v2/reference/statuses` | Status vocabulary and codes. |

### 3.2 Why the attestation target is public

If fetching a consignment required a key, the attestor would carry that key **inside the
TLS session being proven**. You would then be redacting secrets out of proofs, and anyone
reading a proof might learn how to forge portal reads. A real cargo tracking site is public
anyway: you type a bill of lading and see where your goods are.

### 3.3 Authenticated routes

| Route | Role |
|---|---|
| `GET /ctccs/auth/directory` | public — account picker; never exposes credentials |
| `POST /ctccs/auth/session` | public — sign in, returns a bearer token |
| `GET` / `DELETE /ctccs/auth/session` | any — whoami / sign out |
| `GET /ctccs/trader/consignments` | trader (own) or officer (all) |
| `POST /ctccs/trader/consignments` | trader, or officer on a trader's behalf — register |
| `PATCH /ctccs/trader/consignment/:id` | trader — amend, before lodgement only |
| `POST /ctccs/trader/consignment/:id/withdraw` | trader — cancel, before dispatch only |
| `GET /ctccs/officer/queue` | officer — consignments awaiting action at their station |
| `GET /ctccs/officer/consignment/:id/actions` | officer — what they may legally do now |
| `POST /ctccs/officer/consignment/:id/status` | officer — record a status change |
| `POST /ctccs/officer/reset` | officer — reseed; **disabled in production** |

Bearer tokens expire after `SESSION_TTL_MINUTES` (default 30). Sign-in is rate limited to
`SIGNIN_LIMIT` attempts per IP per 10 minutes. Credentials are stored as scrypt hashes and
compared in constant time.

**Demo simplification:** all officers share `OFFICER_PIN`, all exporters share `TRADER_PIN`.
A real system holds per-account credentials in a directory service.

### 3.4 Accounts

| Officer | Station | Port |  | Exporter | Home port |
|---|---|---|---|---|---|
| `VDN-4471` | Kochi Customs House | `INCOK` | | `TRD-1001` Malabar Spice Exports | `INCOK` |
| `TN-CUST-3390` | Chennai Custom House | `INMAA` | | `TRD-1002` Coimbatore Textile Mills | `INMAA` |
| `GJ-CUST-2210` | Kandla Custom House | `INIXY` | | `TRD-1003` Kandla Marine Foods | `INIXY` |
| `NL-CUST-221` | Rotterdam Douane | `NLRTM` | | | |
| `DE-CUST-770` | Hamburg Zollamt | `DEHAM` | | | |
| `SG-CUST-118` | Singapore Customs | `SGSIN` | | | |

### 3.5 Error envelope

Every failure is `{ "error": "<machine_code>", "message": "<human sentence>", ...detail }`.
Codes in use: `bad_request`, `unauthorized`, `invalid_credentials`, `forbidden`,
`not_found`, `invalid_transition`, `amendment_closed`, `lc_already_used`, `rate_limited`,
`payload_too_large`, `server_error`.

---

## 4. Byte-stability — the rule that protects Phase 3

**Two attestors fetching the same consignment seconds apart must receive an identical
response body.**

zkTLS does not prove *"the cargo is dispatched."* It proves *"the server at this address
sent exactly these bytes."* Your M-of-N layer then checks that several attestors proved the
same thing. If the body varied per request, two honest attestors would produce proofs of
two different byte strings, consensus would fail, and the escrow would stall — with nothing
actually wrong.

Therefore, on `GET /ctccs/api/v2/consignment/:id`:

- **No per-request fields.** No `generatedAt`, no request id, no server time, no nonce.
- **Fixed key order**, built from an explicit object literal in `lib/record.js` — never by
  spreading a stored record, whose key order can drift as records are edited.
- `statusSetAt` is when the **status changed**, not when the request arrived.
- `recordHash` changes only when the record changes.
- No `Date.now()` anywhere in that response path.

`test/portal.test.js` enforces this. Keep it passing.

Anything time-varying belongs on `/movements`, which no proof reads.

### 4.1 A subtlety worth knowing

HTTP **response headers** are inside the TLS session too, and `Date` changes every second.
So a whole-transcript comparison would differ even with a stable body. This is why
attestation uses **selective disclosure**: the attestor reveals the byte range covering the
response body (or just the `"status"` substring) and commits to the rest. Keep the body
stable and the header variance is handled by the proof construction, not by the portal.

---

## 5. What zkTLS still cannot do

zkTLS proves the portal *said* the cargo cleared customs. It cannot prove the cargo
*actually* cleared — a lying source produces honestly-proven lies. TrustLC's answer is the
other three layers: M-of-N attestors, economic staking so a false attestation costs money,
and arbitration when consensus fails. Preempt this in the viva rather than being asked.

---

## 6. Known simplifications

Each is defensible; state them rather than hide them.

1. One portal serves both dispatch and clearance (§1.2).
2. Shared PINs per role (§3.3).
3. Fixed UTC offsets per station; no daylight-saving handling.
4. `declaredValue` is fiat while the escrow holds POL (§2.3).
5. UN/LOCODE and HS codes are validated by **shape**, not against the official datasets.
   Full validation needs the UN/CEFACT and WCO reference tables.
6. JSON-file persistence, not a database — deliberate: on-chain state is the source of truth.
