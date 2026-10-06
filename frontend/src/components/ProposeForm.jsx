import { useState } from 'react'
import { ethers } from 'ethers'
import { DEMO_PARTIES, MAX_ESCROW_POL, same } from '../lib/escrow'

const EMPTY = {
  exporter: '',
  amount: '1',
  consignmentId: '',
  setup: '60',
  dispatch: '1440',
  clearance: '1440',
  arbitration: '60',
  attestor1: '',
  attestor2: '',
  attestor3: '',
  arbitrator: '',
  feeRecipient: '',
}

// Returns an error message, or '' when the form is acceptable.
// The contract re-checks everything; this just saves a wasted transaction.
function validate(f, account) {
  if (!ethers.isAddress(f.exporter)) return 'Exporter must be a valid address.'
  if (same(f.exporter, account)) return 'The exporter cannot be you (the importer).'
  if (!f.consignmentId.trim()) return 'Enter a consignment ID.'

  let amountWei
  try {
    amountWei = ethers.parseEther(f.amount)
  } catch {
    return 'Amount must be a number, for example 1 or 0.5.'
  }
  if (amountWei <= 0n) return 'Amount must be greater than zero.'
  if (amountWei > ethers.parseEther(String(MAX_ESCROW_POL))) {
    return `Amount is capped at ${MAX_ESCROW_POL} POL (attestor stake cap).`
  }

  for (const [key, label] of [
    ['setup', 'Setup'],
    ['dispatch', 'Dispatch'],
    ['clearance', 'Clearance'],
    ['arbitration', 'Arbitration'],
  ]) {
    if (!/^\d+$/.test(f[key]) || Number(f[key]) <= 0) {
      return `${label} window must be a whole number of minutes, greater than zero.`
    }
  }

  const parties = [f.attestor1, f.attestor2, f.attestor3, f.arbitrator, f.feeRecipient]
  if (!parties.every((a) => ethers.isAddress(a))) {
    return 'Attestors, arbitrator and fee recipient must all be valid addresses.'
  }
  const attestors = [f.attestor1, f.attestor2, f.attestor3].map((a) => a.toLowerCase())
  if (new Set(attestors).size !== 3) return 'The three attestors must be different addresses.'

  return ''
}

function toParams(f) {
  const minutes = (v) => BigInt(v) * 60n
  return {
    exporter: f.exporter,
    amountWei: ethers.parseEther(f.amount),
    consignmentId: f.consignmentId.trim(),
    setupSeconds: minutes(f.setup),
    dispatchSeconds: minutes(f.dispatch),
    clearanceSeconds: minutes(f.clearance),
    arbitrationSeconds: minutes(f.arbitration),
    attestor1: f.attestor1,
    attestor2: f.attestor2,
    attestor3: f.attestor3,
    arbitrator: f.arbitrator,
    feeRecipient: f.feeRecipient,
  }
}

function Field({ label, hint, children }) {
  return (
    <label className="form-field">
      <span className="card-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export default function ProposeForm({ account, busy, onSubmit, onCancel }) {
  const [f, setF] = useState(EMPTY)
  const [error, setError] = useState('')

  const bind = (key) => ({
    className: 'hash-input',
    value: f[key],
    onChange: (e) => setF({ ...f, [key]: e.target.value }),
  })

  function fillDemo() {
    setF({
      ...f,
      exporter: DEMO_PARTIES.exporter,
      attestor1: DEMO_PARTIES.attestor1,
      attestor2: DEMO_PARTIES.attestor2,
      attestor3: DEMO_PARTIES.attestor3,
      arbitrator: DEMO_PARTIES.arbitrator,
      feeRecipient: DEMO_PARTIES.feeRecipient,
    })
  }

  function submit(e) {
    e.preventDefault()
    const problem = validate(f, account)
    setError(problem)
    if (!problem) onSubmit(toParams(f))
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="panel-label">NEW ESCROW</p>
          <h2>Propose an escrow</h2>
        </div>
        <button className="link-btn" type="button" onClick={onCancel}>
          ← Back
        </button>
      </div>

      <p className="dispute-description">
        You are the importer. The exporter must accept before you can deposit.
        This deploys a new escrow contract, so your wallet will ask you to
        confirm one transaction.
      </p>

      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Consignment ID">
            <input {...bind('consignmentId')} placeholder="SHP-12345" />
          </Field>
          <Field label="Amount (POL)" hint={`Max ${MAX_ESCROW_POL} POL. A 2% fee is added on deposit.`}>
            <input {...bind('amount')} />
          </Field>
          <Field label="Exporter address">
            <input {...bind('exporter')} placeholder="0x…" />
          </Field>
        </div>

        <h3 className="form-section">Time windows (minutes)</h3>
        <div className="form-grid">
          <Field label="Setup" hint="Exporter accepts and importer deposits within this time.">
            <input {...bind('setup')} />
          </Field>
          <Field label="Dispatch" hint="Attestors confirm dispatch, or the importer can refund.">
            <input {...bind('dispatch')} />
          </Field>
          <Field label="Clearance" hint="Attestors confirm customs clearance.">
            <input {...bind('clearance')} />
          </Field>
          <Field label="Arbitration" hint="Arbitrator decides a dispute within this time.">
            <input {...bind('arbitration')} />
          </Field>
        </div>

        <div className="section-row">
          <h3 className="form-section">Attestors, arbitrator and fee recipient</h3>
          <button className="link-btn" type="button" onClick={fillDemo}>
            Fill demo parties (Hardhat accounts)
          </button>
        </div>
        <div className="form-grid">
          <Field label="Attestor 1">
            <input {...bind('attestor1')} placeholder="0x…" />
          </Field>
          <Field label="Attestor 2">
            <input {...bind('attestor2')} placeholder="0x…" />
          </Field>
          <Field label="Attestor 3">
            <input {...bind('attestor3')} placeholder="0x…" />
          </Field>
          <Field label="Arbitrator">
            <input {...bind('arbitrator')} placeholder="0x…" />
          </Field>
          <Field label="Fee recipient">
            <input {...bind('feeRecipient')} placeholder="0x…" />
          </Field>
        </div>

        {error && <p className="form-error">{error}</p>}

        <div className="actions-grid" style={{ marginTop: '20px' }}>
          <button className="action-btn primary" type="submit" disabled={busy}>
            {busy ? 'Working…' : 'Propose escrow'}
          </button>
          <button className="action-btn" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  )
}
