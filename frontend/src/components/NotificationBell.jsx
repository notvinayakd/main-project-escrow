import { useEffect, useRef, useState } from 'react'

const TONE_LABEL = {
  action: 'Your turn',
  warn: 'Warning',
  danger: 'Alert',
  success: 'Done',
  info: 'Info',
}

function Item({ tone, text, time }) {
  return (
    <li className="notif-item">
      <span className={`notif-dot tone-${tone}`} title={TONE_LABEL[tone]} />
      <div>
        <p>{text}</p>
        {time ? (
          <span className="notif-time">
            {new Date(time * 1000).toLocaleString()}
          </span>
        ) : null}
      </div>
    </li>
  )
}

// attention: alerts that need a look right now
// activity:  what has happened on the open escrow, newest first
export default function NotificationBell({
  attention,
  activity,
  badge,
  hasEscrowOpen,
  onOpen,
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  function toggle() {
    const next = !open
    setOpen(next)
    if (next) onOpen()
  }

  return (
    <div className="nav-popover" ref={ref}>
      <button
        className="icon-btn"
        onClick={toggle}
        aria-label="Notifications"
        aria-expanded={open}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {badge > 0 && <span className="badge">{badge > 9 ? '9+' : badge}</span>}
      </button>

      {open && (
        <div className="popover notif-popover">
          <h4>Needs attention</h4>
          {attention.length ? (
            <ul className="notif-list">
              {attention.map((a) => (
                <Item key={a.id} tone={a.tone} text={a.text} />
              ))}
            </ul>
          ) : (
            <p className="notif-empty">Nothing needs your attention.</p>
          )}

          <h4>Activity</h4>
          {!hasEscrowOpen ? (
            <p className="notif-empty">Open an escrow to see its activity.</p>
          ) : activity.length ? (
            <ul className="notif-list">
              {activity.slice(0, 30).map((n) => (
                <Item key={n.id} tone={n.tone} text={n.text} time={n.time} />
              ))}
            </ul>
          ) : (
            <p className="notif-empty">No activity yet.</p>
          )}
        </div>
      )}
    </div>
  )
}
