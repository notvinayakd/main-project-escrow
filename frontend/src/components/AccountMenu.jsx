import { useEffect, useRef, useState } from 'react'
import { demoLabel, same, short } from '../lib/escrow'

// "Disconnect" is the wallet word for logging out: the app forgets the
// account and asks the wallet to revoke this site's access.
//
// A wallet only shares the accounts you connected to this site. Every shared
// account is listed here so you can switch roles without touching the wallet.
export default function AccountMenu({
  account,
  accounts = [],
  onPick,
  onAddMore,
  onDisconnect,
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(account)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard blocked: ignore
    }
  }

  const label = demoLabel(account)

  return (
    <div className="nav-popover" ref={ref}>
      <button className="connect-btn" onClick={() => setOpen(!open)}>
        {label ? `${label} · ` : ''}
        {short(account)} ▾
      </button>

      {open && (
        <div className="popover account-popover">
          <p className="account-full">{account}</p>
          <button className="menu-item" onClick={copy}>
            {copied ? 'Copied ✓' : 'Copy address'}
          </button>

          <p className="account-section">Connected accounts</p>
          {accounts.map((a) => (
            <button
              key={a}
              className="menu-item"
              disabled={same(a, account)}
              onClick={() => {
                setOpen(false)
                onPick(a)
              }}
            >
              {same(a, account) ? '● ' : ''}
              {demoLabel(a) ? `${demoLabel(a)} · ` : ''}
              {short(a)}
            </button>
          ))}

          <button
            className="menu-item"
            onClick={() => {
              setOpen(false)
              onAddMore()
            }}
          >
            + Connect more accounts…
          </button>
          <button
            className="menu-item danger"
            onClick={() => {
              setOpen(false)
              onDisconnect()
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  )
}
