import { useState } from 'react'
import { ethers } from 'ethers'
import './App.css'
import EscrowABI from './contracts/Escrow.json'

const ESCROW_ADDRESS = '0x5fbdb2315678afecb367f032d93f642f64180aa3'

function App() {
  const [walletConnected, setWalletConnected] = useState(false)
  const [walletAddress, setWalletAddress] = useState('')
  const [escrowContract, setEscrowContract] = useState(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function connectWallet() {
    if (!window.ethereum) {
      alert('MetaMask is not installed. Please install MetaMask first.')
      return
    }

    try {
      await window.ethereum.request({
        method: 'eth_requestAccounts',
      })

      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x7a69' }],
        })
      } catch (switchError) {
        if (switchError.code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: '0x7a69',
                chainName: 'Hardhat Local',
                nativeCurrency: {
                  name: 'Ether',
                  symbol: 'ETH',
                  decimals: 18,
                },
                rpcUrls: ['http://127.0.0.1:8545'],
              },
            ],
          })
        } else {
          throw switchError
        }
      }

      const provider = new ethers.BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()
      const address = await signer.getAddress()

      const contract = new ethers.Contract(
        ESCROW_ADDRESS,
        EscrowABI.abi,
        signer
      )

      setWalletAddress(address)
      setEscrowContract(contract)
      setWalletConnected(true)
      setMessage('Wallet and Escrow contract connected.')

      console.log('Connected wallet:', address)
      console.log('Connected Escrow contract:', contract)
    } catch (error) {
      console.error('Wallet connection failed:', error)
      setMessage(error.reason || error.message || 'Wallet connection failed.')
    }
  }

  async function runTransaction(transactionFunction, successMessage) {
    if (!escrowContract) {
      alert('Please connect your wallet first.')
      return
    }

    try {
      setBusy(true)
      setMessage('Waiting for transaction...')

      const tx = await transactionFunction()

      setMessage('Transaction submitted. Waiting for confirmation...')

      await tx.wait()

      setMessage(successMessage)
    } catch (error) {
      console.error('Transaction failed:', error)

      const reason =
        error.reason ||
        error.shortMessage ||
        error.message ||
        'Transaction failed.'

      setMessage(`Transaction failed: ${reason}`)
    } finally {
      setBusy(false)
    }
  }

  async function acceptEscrow() {
    await runTransaction(
      () => escrowContract.accept(),
      'Escrow accepted successfully.'
    )
  }

  async function depositFunds() {
  if (!escrowContract) {
    alert('Please connect your wallet first.')
    return
  }

  const amount = prompt('Enter deposit amount in ETH:', '1.0')

  if (!amount) {
    return
  }

  try {
    setBusy(true)
    setMessage('Preparing deposit...')

    const value = ethers.parseEther(amount)

    console.log('Deposit amount:', amount)
    console.log('Deposit value:', value.toString())
    console.log('Contract:', escrowContract)

    const tx = await escrowContract.deposit({
      value: value,
    })

    console.log('Transaction sent:', tx.hash)
    setMessage('Transaction submitted. Waiting for confirmation...')

    await tx.wait()

    console.log('Transaction confirmed:', tx.hash)
    setMessage('Deposit successful!')
    alert('Deposit successful!')
  } catch (error) {
    console.error('Deposit failed:', error)

    const reason =
      error?.reason ||
      error?.shortMessage ||
      error?.message ||
      'Unknown error'

    setMessage(`Deposit failed: ${reason}`)
    alert(`Deposit failed:\n\n${reason}`)
  } finally {
    setBusy(false)
  }
}
  async function submitAttestation() {
    const statusInput = window.prompt(
      'Enter status code (for example 1):',
      '1'
    )

    if (statusInput === null) return

    const statusCode = Number(statusInput)

    if (
      !Number.isInteger(statusCode) ||
      statusCode < 0 ||
      statusCode > 255
    ) {
      alert('Status code must be an integer between 0 and 255.')
      return
    }

    const recordHash = window.prompt(
      'Enter the 32-byte record hash:',
      '0x0000000000000000000000000000000000000000000000000000000000000000'
    )

    if (!recordHash) return

    if (!/^0x[0-9a-fA-F]{64}$/.test(recordHash)) {
      alert('Record hash must be exactly 32 bytes (64 hexadecimal characters).')
      return
    }

    await runTransaction(
      () => escrowContract.attest(statusCode, recordHash),
      'Attestation submitted successfully.'
    )
  }

  async function withdrawEscrow() {
    await runTransaction(
      () => escrowContract.withdraw(),
      'Escrow withdrawal completed successfully.'
    )
  }

  async function refundEscrow() {
    await runTransaction(
      () => escrowContract.refund(),
      'Refund completed successfully.'
    )
  }

  async function resolveDispute() {
    const release = window.confirm(
      'Click OK to release funds to the exporter.\n\nClick Cancel to refund the importer.'
    )

    await runTransaction(
      () => escrowContract.resolveDispute(release),
      release
        ? 'Dispute resolved: funds released to exporter.'
        : 'Dispute resolved: funds refunded.'
    )
  }

  async function checkTimeout() {
    await runTransaction(
      () => escrowContract.checkTimeout(),
      'Timeout check completed successfully.'
    )
  }

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

        <button
          className="connect-btn"
          onClick={connectWallet}
        >
          {walletConnected
            ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
            : 'Connect Wallet'}
        </button>
      </nav>

      {/* Main Content */}
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

        {/* Transaction Message */}
        {message && (
          <div className="panel" style={{ marginBottom: '20px' }}>
            <strong>{message}</strong>
          </div>
        )}

        {/* Escrow Summary */}
        <section className="summary-grid">

          <div className="summary-card">
            <span className="card-label">Consignment ID</span>
            <strong>SHP-88214</strong>
          </div>

          <div className="summary-card">
            <span className="card-label">Escrow Amount</span>
            <strong>ETH</strong>
          </div>

          <div className="summary-card">
            <span className="card-label">Network</span>
            <strong>Hardhat</strong>
          </div>

          <div className="summary-card">
            <span className="card-label">Contract</span>
            <strong>{ESCROW_ADDRESS.slice(0, 6)}...</strong>
          </div>

        </section>

        {/* Main Grid */}
        <section className="dashboard-grid">

          {/* Escrow Progress */}
          <div className="panel progress-panel">

            <div className="panel-header">
              <div>
                <p className="panel-label">ESCROW LIFECYCLE</p>
                <h2>Shipment Progress</h2>
              </div>

              <span className="state-pill">Blockchain</span>
            </div>

            <div className="timeline">

              <div className="timeline-item completed">
                <div className="timeline-marker">✓</div>

                <div>
                  <h3>Proposed</h3>
                  <p>Escrow created</p>
                </div>
              </div>

              <div className="timeline-item">
                <div className="timeline-marker">2</div>

                <div>
                  <h3>Accepted</h3>
                  <p>Exporter accepts the escrow</p>
                </div>
              </div>

              <div className="timeline-item">
                <div className="timeline-marker">3</div>

                <div>
                  <h3>Funded</h3>
                  <p>Funds deposited into escrow</p>
                </div>
              </div>

              <div className="timeline-item">
                <div className="timeline-marker">4</div>

                <div>
                  <h3>Attested</h3>
                  <p>Awaiting verification</p>
                </div>
              </div>

              <div className="timeline-item">
                <div className="timeline-marker">5</div>

                <div>
                  <h3>Resolved</h3>
                  <p>Settlement decision</p>
                </div>
              </div>

              <div className="timeline-item">
                <div className="timeline-marker">6</div>

                <div>
                  <h3>Released</h3>
                  <p>Escrow settled</p>
                </div>
              </div>

            </div>
          </div>

          {/* Escrow Details */}
          <div className="panel">

            <div className="panel-header">
              <div>
                <p className="panel-label">ESCROW DETAILS</p>
                <h2>Transaction Information</h2>
              </div>
            </div>

            <div className="details">

              <div className="detail-row">
                <span>Connected Wallet</span>

                <strong>
                  {walletConnected
                    ? `${walletAddress.slice(0, 10)}...${walletAddress.slice(-6)}`
                    : 'Not connected'}
                </strong>
              </div>

              <div className="detail-row">
                <span>Escrow Contract</span>

                <strong>
                  {ESCROW_ADDRESS.slice(0, 10)}...
                  {ESCROW_ADDRESS.slice(-6)}
                </strong>
              </div>

              <div className="detail-row">
                <span>Network</span>
                <strong>Hardhat Local</strong>
              </div>

              <div className="detail-row">
                <span>Chain ID</span>
                <strong>31337</strong>
              </div>

              <div className="detail-row">
                <span>Contract Status</span>

                <strong>
                  {escrowContract ? 'Connected' : 'Not connected'}
                </strong>
              </div>

            </div>
          </div>

        </section>

        {/* Attestation Network */}
        <section className="panel">

          <div className="panel-header">

            <div>
              <p className="panel-label">ATTESTATION NETWORK</p>
              <h2>Attestation</h2>
            </div>

            <span className="requirement">
              Blockchain verified
            </span>

          </div>

          <div className="attestor-grid">

            <div className="attestor">
              <div className="avatar">A1</div>

              <div>
                <strong>Verifier</strong>
                <p>Submit status + record hash</p>
              </div>

              <span className="staked">Active</span>
            </div>

            <div className="attestor">
              <div className="avatar">A2</div>

              <div>
                <strong>Proof</strong>
                <p>32-byte record hash</p>
              </div>

              <span className="staked">Ready</span>
            </div>

            <div className="attestor">
              <div className="avatar">A3</div>

              <div>
                <strong>Status</strong>
                <p>On-chain attestation</p>
              </div>

              <span className="staked">Enabled</span>
            </div>

          </div>

        </section>

        {/* Actions */}
        <section className="panel">

          <div className="panel-header">

            <div>
              <p className="panel-label">CONTRACT ACTIONS</p>
              <h2>Escrow Actions</h2>
            </div>

          </div>

          <div className="actions-grid">

            <button
              className="action-btn primary"
              onClick={acceptEscrow}
              disabled={busy || !walletConnected}
            >
              Accept Escrow
            </button>

            <button
              className="action-btn"
              onClick={depositFunds}
              disabled={busy || !walletConnected}
            >
              Deposit Funds
            </button>

            <button
              className="action-btn"
              onClick={submitAttestation}
              disabled={busy || !walletConnected}
            >
              Submit Attestation
            </button>

            <button
              className="action-btn"
              onClick={withdrawEscrow}
              disabled={busy || !walletConnected}
            >
              Withdraw Escrow
            </button>

            <button
              className="action-btn"
              onClick={refundEscrow}
              disabled={busy || !walletConnected}
            >
              Refund
            </button>

            <button
              className="action-btn"
              onClick={checkTimeout}
              disabled={busy || !walletConnected}
            >
              Check Timeout
            </button>

          </div>

        </section>

        {/* Dispute */}
        <section className="panel dispute-panel">

          <div>
            <p className="panel-label">DISPUTE MANAGEMENT</p>

            <h2>Dispute Resolution</h2>

            <p className="dispute-description">
              The assigned arbitrator can resolve a dispute by releasing
              the escrow to the exporter or returning the funds.
            </p>
          </div>

          <div className="dispute-actions">

            <button
              className="action-btn dispute"
              onClick={resolveDispute}
              disabled={busy || !walletConnected}
            >
              Resolve Dispute
            </button>

            <button
              className="action-btn warning"
              onClick={checkTimeout}
              disabled={busy || !walletConnected}
            >
              Check Timeout
            </button>

          </div>

        </section>

        {/* Footer */}
        <footer>
          <p>
            TrustLC • Blockchain-based Letter of Credit Escrow
          </p>

          <p>
            Hardhat Local • Chain ID 31337
          </p>
        </footer>

      </main>
    </div>
  )
}

export default App