# TrustLC

**Trust-minimized blockchain escrow for Letter of Credit trade finance.**

Final-year B.Tech capstone (CSD415), College of Engineering Chengannur, APJ Abdul Kalam
Technological University, 2026.

---

## The problem

International trade runs on the Letter of Credit: an importer's bank promises to pay an
exporter once documents prove the goods shipped and cleared customs. It works, but it is
slow, paper-heavy, and every party has to trust a chain of correspondent banks.

The obvious fix — hold the money in a smart contract — hits a wall immediately. **A
blockchain cannot browse the web.** It cannot look at a customs portal and see whether a
shipment cleared. Someone has to tell it, and that someone has every incentive to lie.

## The approach

TrustLC removes the trusted intermediary rather than replacing it with a different one.

1. An escrow contract on **Polygon** holds the importer's funds.
2. Three independent **attestors** watch a customs portal.
3. Each attestor uses **zkTLS** ([TLSNotary](https://tlsnotary.org)) to obtain a
   cryptographic proof of what the portal actually served — a guarantee ordinary HTTPS
   cannot give, because HTTPS proves a response to *you* but not to a third party.
4. When **2 of 3** attestors agree the shipment cleared, the contract releases the funds.
5. Attestors post a stake. Lying costs them money. An arbitrator can act **only** when the
   quorum fails, and has no powers while consensus holds.

No notary, no oracle operator, and no party who can both lie and profit from it.

---

## Repository layout

| Path | What it is |
|---|---|
| `contracts/` | Solidity escrow contract and its test suite (Hardhat 3, Solidity, Mocha + ethers). Note the `contracts/contracts/` nesting — that is Hardhat's own convention for `.sol` sources. |
| `portal/` | Mock customs portal — the National Trade Documentation Gateway (NTG/CTCCS). Node.js + Express. This is the real-world data source attestations are proven against. |
| `docs/` | Project knowledge base, team roadmap, interactive prototype, and portal screenshots. |

## Stack

| Layer | Choice |
|---|---|
| Chain | Polygon Amoy testnet |
| Contracts | Solidity, Hardhat 3 |
| zkTLS | TLSNotary |
| Portal | Node.js 24, Express 5 |
| Frontend | React + Vite + Tailwind *(planned)* |

---

## Running it

### Mock customs portal

```
cd portal
npm install
npm run seed
npm start
```

Serves on `http://localhost:3000`. `npm test` runs the suite.
The record contract and lifecycle rules are specified in `portal/PORTAL_SPEC.md` — that
spec is frozen, because changing a field name or key order breaks every attestation.

### Contracts

```
cd contracts
npm install
npx hardhat test
```

Requires Node.js 22.13 or later, and `git` on PATH.

---

## Project status

| Phase | Scope | State |
|---|---|---|
| 0 | Proposal, literature review | Complete |
| 1 | Escrow contract | In progress |
| 2 | Mock customs portal | Complete — not yet deployed |
| 3 | zkTLS attestation layer | Not started |
| 4 | Frontend | Not started |

## Team

Vinayak D · Aleena M · Karthik M · Roshan Joseph
Guide: Smt. Alka Vijay

---

## Scope, stated openly

A production deployment would read two independent systems — the carrier's for dispatch and
the destination customs authority's for clearance. This project collapses both into a single
mock portal. That is a deliberate scoping decision for a student proof of concept, and it
does not weaken the trust argument: zkTLS proves *what a named server said*, whether that
server serves one event type or two.

TLSNotary is pre-1.0 and unaudited at the time of writing. It is pinned to an exact release.
