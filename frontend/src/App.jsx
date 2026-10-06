import { useState, useEffect, useCallback, useRef } from 'react'
import { ethers } from 'ethers'
import './App.css'
import {
  HARDHAT_CHAIN_ID,
  LIFECYCLE,
  STATES,
  deployEscrow,
  deriveRoles,
  ensureHardhatChain,
  errText,
  fmtEth,
  fmtTime,
  getActions,
  getContract,
  loadSnapshot,
  same,
  short,
  waitingOn,
} from './lib/escrow'
import {
  buildAlerts,
  buildListAlerts,
  eventsToNotes,
} from './lib/notifications'
import {
  addEscrow,
  getSeen,
  isDisconnected,
  loadEscrows,
  removeEscrow,
  setDisconnected,
  setSeen,
} from './lib/storage'
import NotificationBell from './components/NotificationBell'
import AccountMenu from './components/AccountMenu'
import EscrowList from './components/EscrowList'
import ProposeForm from './components/ProposeForm'

function App() {
  const [account, setAccount] = useState('')
  const [escrows, setEscrows] = useState(() => loadEscrows())
  const [summaries, setSummaries] = useState({})
  const [selected, setSelected] = useState(null) // escrow address being viewed
  const [view, setView] = useState('list') // 'list' | 'detail' | 'propose'
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [recordHash, setRecordHash] = useState('')
  const [seenMap, setSeenMap] = useState({})

  // Refs so the polling timer and wallet listeners always see current values.
  const signerRef = useRef(null)
  const escrowsRef = useRef(escrows)
  const selectedRef = useRef(null)
  const busyRef = useRef(false)
  useEffect(() => {
    busyRef.current = busy
  }, [busy])

  const connected = !!account

  // Re-read the chain. A fresh provider each time avoids ethers'
  // cached-network errors after the wallet switches chain.
  const refresh = useCallback(async (silent = false) => {
    try {
      const provider = new ethers.BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()
      const address = await signer.getAddress()
      const network = await provider.getNetwork()

      if (Number(network.chainId) !== HARDHAT_CHAIN_ID) {
        throw new Error(
          `Wrong network (chain ${network.chainId}). Switch the wallet to Hardhat Local (31337).`
        )
      }

      signerRef.current = signer
      const sel = selectedRef.current
      const next = {}
      await Promise.all(
        escrowsRef.current.map(async (addr) => {
          try {
            next[addr] = await loadSnapshot(addr, provider, address, {
              withEvents: addr === sel, // activity feed only for the open escrow
            })
          } catch (error) {
            next[addr] = { missing: true, error: errText(error) }
          }
        })
      )

      setAccount(address)
      setSummaries(next)
    } catch (error) {
      if (!silent) {
        console.error('Refresh failed:', error)
        setMessage(errText(error))
        setAccount('')
        setSummaries({})
      }
    }
  }, [])

  async function connectWallet() {
    if (!window.ethereum) {
      setMessage('No wallet found. Install MetaMask, then reload this page.')
      return
    }
    try {
      await window.ethereum.request({ method: 'eth_requestAccounts' })
      await ensureHardhatChain()
      setDisconnected(false)
      setMessage('')
      await refresh()
    } catch (error) {
      console.error('Wallet connection failed:', error)
      setMessage(errText(error))
    }
  }

  // Wallets have no real "logout". Disconnect = the app forgets the account
  // and asks the wallet to revoke this site's access.
  async function disconnectWallet() {
    try {
      await window.ethereum.request({
        method: 'wallet_revokePermissions',
        params: [{ eth_accounts: {} }],
      })
    } catch {
      // older wallets: the app-side disconnect below still applies
    }
    setDisconnected(true)
    signerRef.current = null
    selectedRef.current = null
    setSelected(null)
    setView('list')
    setAccount('')
    setSummaries({})
    setMessage('')
  }

  // Opens the wallet's own account chooser.
  async function switchAccount() {
    try {
      await window.ethereum.request({
        method: 'wallet_requestPermissions',
        params: [{ eth_accounts: {} }],
      })
      await refresh()
    } catch (error) {
      if (error.code !== 4001) setMessage(errText(error)) // 4001 = user closed it
    }
  }

  // Reconnect automatically after a page reload, unless the user disconnected.
  useEffect(() => {
    if (!window.ethereum || isDisconnected()) return
    window.ethereum
      .request({ method: 'eth_accounts' })
      .then((accounts) => {
        if (accounts.length) refresh()
      })
      .catch(() => {})
  }, [refresh])

  // Follow the wallet: switching account or network updates the screen.
  useEffect(() => {
    if (!connected || !window.ethereum) return undefined
    const onAccounts = (accounts) => {
      if (accounts.length === 0) {
        setAccount('')
        setSummaries({})
      } else {
        refresh()
      }
    }
    const onChain = () => refresh()
    window.ethereum.on('accountsChanged', onAccounts)
    window.ethereum.on('chainChanged', onChain)
    return () => {
      window.ethereum.removeListener('accountsChanged', onAccounts)
      window.ethereum.removeListener('chainChanged', onChain)
    }
  }, [connected, refresh])

  // Poll so the screen also reflects actions taken by the other parties.
  useEffect(() => {
    if (!connected) return undefined
    const id = setInterval(() => {
      if (!busyRef.current) refresh(true)
    }, 4000)
    return () => clearInterval(id)
  }, [connected, refresh])

  // ---------- navigation ----------

  function openEscrow(address) {
    selectedRef.current = address
    setSelected(address)
    setView('detail')
    setMessage('')
    refresh(true)
  }

  function backToList() {
    selectedRef.current = null
    setSelected(null)
    setView('list')
  }

  function addByAddress(address) {
    const list = addEscrow(address)
    escrowsRef.current = list
    setEscrows(list)
    openEscrow(ethers.getAddress(address))
  }

  function forget(address) {
    const list = removeEscrow(address)
    escrowsRef.current = list
    setEscrows(list)
  }

  // ---------- transactions ----------

  async function run(transactionFunction, successMessage) {
    try {
      setBusy(true)
      setMessage('Confirm the transaction in your wallet...')
      const tx = await transactionFunction()
      setMessage('Transaction submitted. Waiting for confirmation...')
      await tx.wait()
      setMessage(successMessage)
      await refresh(true)
    } catch (error) {
      console.error('Transaction failed:', error)
      setMessage(`Transaction failed: ${errText(error)}`)
    } finally {
      setBusy(false)
    }
  }

  async function proposeEscrow(params) {
    try {
      setBusy(true)
      setMessage('Confirm the deployment in your wallet...')
      const address = await deployEscrow(signerRef.current, params)

      const list = addEscrow(address)
      escrowsRef.current = list
      setEscrows(list)
      selectedRef.current = address
      setSelected(address)
      setView('detail')
      setMessage(
        `Escrow ${params.consignmentId} proposed at ${address}. Send this address to the exporter: they open it with "Open by address" and accept.`
      )
      await refresh(true)
    } catch (error) {
      console.error('Proposal failed:', error)
      setMessage(`Could not propose escrow: ${errText(error)}`)
    } finally {
      setBusy(false)
    }
  }

  function execute(action, snap) {
    const c = getContract(snap.address, signerRef.current)
    switch (action.key) {
      case 'accept':
        return run(() => c.accept(), 'Escrow accepted. It is now Ready for the importer to fund.')
      case 'deposit':
        return run(() => c.deposit({ value: snap.total }), 'Deposit confirmed. The escrow is Funded.')
      case 'stake':
        return run(
          () => c.stakeAsAttestor({ value: snap.requiredStake }),
          'Stake locked. You can now attest.'
        )
      case 'attest': {
        // All attestors must submit the SAME hash for their votes to match.
        // Leave the box empty to use a deterministic demo hash.
        const hash =
          recordHash.trim() || ethers.id(`${snap.consignmentId}:${action.code}`)
        if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
          setMessage('Record hash must be 0x followed by 64 hex characters (32 bytes).')
          return undefined
        }
        return run(
          () => c.attest(action.code, hash),
          `Attestation (code ${action.code}) recorded.`
        )
      }
      case 'withdraw':
        return run(() => c.withdraw(), 'Payment withdrawn. Escrow released.')
      case 'refund':
        return run(() => c.refund(), 'Refund completed.')
      case 'checkTimeout':
        return run(() => c.checkTimeout(), 'Timeout triggered. The escrow is now Disputed.')
      case 'resolve':
        return run(
          () => c.resolveDispute(action.release),
          action.release
            ? 'Dispute resolved: funds released to the exporter.'
            : 'Dispute resolved: importer refunded.'
        )
      case 'forceResolve':
        return run(() => c.forceResolveDispute(), 'Forced resolution: importer refunded.')
      case 'withdrawStake':
        return run(() => c.withdrawStake(), 'Stake withdrawn.')
      default:
        return undefined
    }
  }

  // ---------- derived data for rendering ----------

  const snap =
    selected && summaries[selected] && !summaries[selected].missing
      ? summaries[selected]
      : null

  const roles = snap ? deriveRoles(snap, account) : []
  const actions = snap ? getActions(snap, account) : []
  const needsHash = actions.some((a) => a.key === 'attest')

  // Notification bell: alerts for the open escrow + "your turn" pings for the rest.
  const attention = connected
    ? [
        ...(snap ? buildAlerts(snap, account) : []),
        ...escrows
          .filter((a) => a !== selected)
          .flatMap((a) => buildListAlerts(summaries[a], account)),
      ]
    : []
  const activity = snap ? eventsToNotes(snap) : []
  const seen = snap ? (seenMap[selected] ?? getSeen(selected)) : 0
  const unread = snap ? Math.max(0, snap.events.length - seen) : 0
  const badge =
    attention.filter((a) => ['action', 'warn', 'danger'].includes(a.tone)).length +
    unread

  function markActivitySeen() {
    if (!snap) return
    setSeen(selected, snap.events.length)
    setSeenMap({ ...seenMap, [selected]: snap.events.length })
  }

  // Highest lifecycle step reached. Refunded/Disputed sit off the main path;
  // both can only happen after Funded, so show steps up to Funded as done.
  const progress = snap ? (snap.state <= 5 ? snap.state : 3) : -1

  return (
    <div className="app">
      {/* Navigation */}
      <nav className="navbar">
        <div className="brand">
          <div className="brand-icon">T</div>
          <div>
            <h2>TrustLC</h2>
            <span>Blockchain Trade Escrow</span>
          </div>
        </div>

        <div className="network">
          <span className="network-dot"></span>
          Hardhat Local
        </div>

        <div className="nav-right">
          {connected && (
            <NotificationBell
              attention={attention}
              activity={activity}
              badge={badge}
              hasEscrowOpen={!!snap}
              onOpen={markActivitySeen}
            />
          )}
          {connected ? (
            <AccountMenu
              account={account}
              onSwitch={switchAccount}
              onDisconnect={disconnectWallet}
            />
          ) : (
            <button className="connect-btn" onClick={connectWallet}>
              Connect Wallet
            </button>
          )}
        </div>
      </nav>

      <main className="container">
        {/* Page Header */}
        <section className="page-header">
          <div>
            <p className="eyebrow">LETTER OF CREDIT ESCROW</p>
            <h1>TrustLC Dashboard</h1>
            <p className="subtitle">
              Trust-minimized digital trade settlement using blockchain
              escrow and independent attestations.
            </p>
          </div>

          <div className="status-badge">
            <span></span>
            Hardhat Demo
          </div>
        </section>

        {/* Transaction / error message */}
        {message && (
          <div className="panel" style={{ marginBottom: '20px' }}>
            <strong>{message}</strong>
          </div>
        )}

        {/* Not connected */}
        {!connected && (
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-label">GET STARTED</p>
                <h2>Connect your wallet</h2>
              </div>
            </div>
            <p className="dispute-description">
              Your wallet is your identity. Once connected, the app shows the
              escrows you are part of, works out your role in each one, and
              offers only the actions the contract will accept from you.
            </p>
          </section>
        )}

        {/* Escrow list */}
        {connected && view === 'list' && (
          <EscrowList
            escrows={escrows}
            summaries={summaries}
            account={account}
            onOpen={openEscrow}
            onRemove={forget}
            onAdd={addByAddress}
            onPropose={() => {
              setMessage('')
              setView('propose')
            }}
          />
        )}

        {/* Propose */}
        {connected && view === 'propose' && (
          <ProposeForm
            account={account}
            busy={busy}
            onSubmit={proposeEscrow}
            onCancel={() => setView('list')}
          />
        )}

        {/* Detail: escrow not readable */}
        {connected && view === 'detail' && !snap && (
          <section className="panel">
            <p className="dispute-description">Loading escrow…</p>
            <button className="link-btn" onClick={backToList}>
              ← All escrows
            </button>
          </section>
        )}

        {/* Detail */}
        {connected && view === 'detail' && snap && (
          <>
            <button className="link-btn back-link" onClick={backToList}>
              ← All escrows
            </button>

            <section className="summary-grid">
              <div className="summary-card">
                <span className="card-label">Consignment ID</span>
                <strong>{snap.consignmentId}</strong>
              </div>
              <div className="summary-card">
                <span className="card-label">Escrow Amount</span>
                <strong>{fmtEth(snap.amount)} POL</strong>
              </div>
              <div className="summary-card">
                <span className="card-label">State</span>
                <strong>{STATES[snap.state]}</strong>
              </div>
              <div className="summary-card">
                <span className="card-label">Your role</span>
                <strong>{roles.length ? roles.join(', ') : 'Observer'}</strong>
              </div>
            </section>

            <section className="dashboard-grid">
              <div className="panel progress-panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-label">ESCROW LIFECYCLE</p>
                    <h2>Shipment Progress</h2>
                  </div>
                  <span className="state-pill">{STATES[snap.state]}</span>
                </div>

                <div className="timeline">
                  {LIFECYCLE.map((step) => {
                    const completed =
                      step.state < progress ||
                      (snap.state === 5 && step.state === 5)
                    const active =
                      !completed && step.state === progress && snap.state <= 5
                    return (
                      <div
                        key={step.state}
                        className={`timeline-item${completed ? ' completed' : ''}${active ? ' active' : ''}`}
                      >
                        <div className="timeline-marker">
                          {completed ? '✓' : step.state + 1}
                        </div>
                        <div>
                          <h3>{step.title}</h3>
                          <p>{step.text}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-label">ESCROW DETAILS</p>
                    <h2>Transaction Information</h2>
                  </div>
                </div>

                <div className="details">
                  <div className="detail-row">
                    <span>Connected wallet</span>
                    <strong>{short(account)}</strong>
                  </div>
                  <div className="detail-row">
                    <span>Importer</span>
                    <strong>{short(snap.importer)}</strong>
                  </div>
                  <div className="detail-row">
                    <span>Exporter</span>
                    <strong>{short(snap.exporter)}</strong>
                  </div>
                  <div className="detail-row">
                    <span>Arbitrator</span>
                    <strong>{short(snap.arbitrator)}</strong>
                  </div>
                  <div className="detail-row">
                    <span>Contract</span>
                    <strong>{short(snap.address)}</strong>
                  </div>
                  <div className="detail-row">
                    <span>Chain ID</span>
                    <strong>{HARDHAT_CHAIN_ID}</strong>
                  </div>
                </div>
              </div>
            </section>

            {/* What's next: the ONE place that tells you what to do */}
            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-label">WHAT HAPPENS NEXT</p>
                  <h2>Status &amp; your actions</h2>
                </div>
              </div>

              <p className="dispute-description">{waitingOn(snap)}</p>

              {roles.length === 0 && (
                <p className="dispute-description">
                  This wallet has no role in this escrow, so the view is
                  read-only.
                </p>
              )}

              {needsHash && (
                <div style={{ margin: '16px 0' }}>
                  <label className="card-label" htmlFor="record-hash">
                    Record hash (32 bytes). Attestors must submit the same
                    value for their votes to count together. Leave empty to
                    use the demo hash.
                  </label>
                  <input
                    id="record-hash"
                    className="hash-input"
                    type="text"
                    placeholder="0x… (optional)"
                    value={recordHash}
                    onChange={(e) => setRecordHash(e.target.value)}
                  />
                </div>
              )}

              {actions.length > 0 ? (
                <div className="actions-grid">
                  {actions.map((action) => (
                    <button
                      key={`${action.key}-${action.code ?? ''}-${action.release ?? ''}`}
                      className={`action-btn ${action.variant || ''}`}
                      onClick={() => execute(action, snap)}
                      disabled={busy}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              ) : (
                roles.length > 0 && (
                  <p className="dispute-description">
                    Nothing for this wallet to do right now.
                  </p>
                )
              )}
            </section>

            {/* Attestors */}
            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-label">ATTESTATION NETWORK</p>
                  <h2>Attestors</h2>
                </div>
                <span className="requirement">
                  2 of 3 must agree · stake {fmtEth(snap.requiredStake)} POL each
                </span>
              </div>

              <div className="attestor-grid">
                {snap.attestors.map((addr, i) => {
                  const isStaked = snap.stakes[i] >= snap.requiredStake
                  return (
                    <div className="attestor" key={addr}>
                      <div className="avatar">A{i + 1}</div>
                      <div>
                        <strong>
                          {short(addr)}
                          {same(addr, account) ? ' (you)' : ''}
                        </strong>
                        <p>Stake: {fmtEth(snap.stakes[i])} POL</p>
                      </div>
                      <span
                        className="staked"
                        style={isStaked ? undefined : { opacity: 0.6 }}
                      >
                        {isStaked ? 'Staked' : 'Not staked'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </section>

            {/* Deadlines */}
            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-label">TIMING</p>
                  <h2>Deadlines</h2>
                </div>
              </div>
              <div className="details">
                <div className="detail-row">
                  <span>Setup (accept + deposit)</span>
                  <strong>{fmtTime(snap.setupDeadline)}</strong>
                </div>
                <div className="detail-row">
                  <span>Dispatch</span>
                  <strong>{fmtTime(snap.dispatchDeadline)}</strong>
                </div>
                <div className="detail-row">
                  <span>Clearance</span>
                  <strong>{fmtTime(snap.clearanceDeadline)}</strong>
                </div>
                <div className="detail-row">
                  <span>Arbitration</span>
                  <strong>{fmtTime(snap.arbitrationDeadline)}</strong>
                </div>
              </div>
            </section>
          </>
        )}

        <footer>
          <p>TrustLC • Blockchain-based Letter of Credit Escrow</p>
          <p>Hardhat Local • Chain ID 31337</p>
        </footer>
      </main>
    </div>
  )
}

export default App
