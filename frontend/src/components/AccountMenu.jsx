import { useEffect, useRef, useState } from 'react'
import { short } from '../lib/escrow'

// "Disconnect" is the wallet word for logging out: the app forgets the
// account and asks the wallet to revoke this site's access.
export default function AccountMenu({ account, onSwitch, onDisconnect }) {
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

  return (
    <div className="nav-popover" ref={ref}>
      <button className="connect-btn" onClick={() => setOpen(!open)}>
        {short(account)} ▾
      </button>

      {open && (
        <div className="popover account-popover">
          <p className="account-full">{account}</p>
          <button className="menu-item" onClick={copy}>
            {copied ? 'Copied ✓' : 'Copy address'}
          </button>
          <button
            className="menu-item"
            onClick={() => {
              setOpen(false)
              onSwitch()
            }}
          >
            Switch account
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
