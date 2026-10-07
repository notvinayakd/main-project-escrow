import { useState } from 'react'
import {
  stateLabel,
  deriveRoles,
  fmtEth,
  getActions,
  parseEscrowCode,
  shortCode,
} from '../lib/escrow'

export default function EscrowList({
  escrows,
  summaries,
  account,
  onOpen,
  onRemove,
  onAdd,
  onPropose,
}) {
  const [address, setAddress] = useState('')
  const [error, setError] = useState('')

  function submit(e) {
    e.preventDefault()
    const parsed = parseEscrowCode(address)
    if (!parsed) {
      setError('That is not a valid escrow code. It looks like TLC-5FBD-B231-… (a plain 0x address also works).')
      return
    }
    setError('')
    onAdd(parsed)
    setAddress('')
  }

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="panel-label">YOUR ESCROWS</p>
            <h2>Escrows</h2>
          </div>
          <button className="action-btn primary inline-btn" onClick={onPropose}>
            + Propose new escrow
          </button>
        </div>

        {escrows.length === 0 && (
          <p className="dispute-description">
            No escrows yet. Propose one. Escrows that name your wallet appear here automatically.
          </p>
        )}

        <ul className="escrow-list">
          {escrows.map((addr) => {
            const s = summaries[addr]
            if (!s) {
              return (
                <li className="escrow-row" key={addr}>
                  <span className="escrow-sub">Loading {shortCode(addr)}…</span>
                </li>
              )
            }
            if (s.missing) {
              return (
                <li className="escrow-row" key={addr}>
                  <div>
                    <strong>{shortCode(addr)}</strong>
                    <span className="escrow-sub">{s.error}</span>
                  </div>
                  <button className="link-btn" onClick={() => onRemove(addr)}>
                    Remove
                  </button>
                </li>
              )
            }
            const roles = deriveRoles(s, account)
            const yourTurn = getActions(s, account).length > 0
            return (
              <li className="escrow-row clickable" key={addr}>
                <button className="row-main" onClick={() => onOpen(addr)}>
                  <div>
                    <strong>{s.consignmentId}</strong>
                    <span className="escrow-sub">
                      {shortCode(addr)} · {fmtEth(s.amount)} POL
                    </span>
                  </div>
                  <div className="row-tags">
                    {yourTurn && <span className="tag tag-action">Your turn</span>}
                    {s.state === 7 && <span className="tag tag-danger">Dispute</span>}
                    <span className="tag">
                      {roles.length ? roles.join(', ') : 'Observer'}
                    </span>
                    <span className="state-pill">{stateLabel(s)}</span>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="panel-label">OPEN AN ESCROW</p>
            <h2>Open by escrow code</h2>
          </div>
        </div>
        <p className="dispute-description">
          Escrows that name your wallet show up above by themselves. To look at
          any other escrow, paste its code (TLC-…) here. You can find the code
          in the Escrow details of any escrow you have open.
        </p>
        <form className="inline-form" onSubmit={submit}>
          <input
            className="hash-input"
            type="text"
            placeholder="TLC-5FBD-B231-…"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <button className="action-btn" type="submit">
            Add
          </button>
        </form>
        {error && <p className="form-error">{error}</p>}
      </section>
    </>
  )
}
