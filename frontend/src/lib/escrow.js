import { ethers } from 'ethers'
import EscrowABI from '../contracts/Escrow.json'

// ---------- constants ----------

export const HARDHAT_CHAIN_ID = 31337
export const HARDHAT_CHAIN_HEX = '0x7a69'

// First contract deployed on a fresh `hardhat node` by scripts/deploy-local.ts.
export const DEMO_ESCROW_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3'

// Mirrors the contract: escrow amount <= REQUIRED_STAKE * STAKE_TO_ESCROW_MULTIPLIER.
// The contract enforces it; this is only so the form can warn early.
export const MAX_ESCROW_POL = 2

// Same order as `enum State` in Escrow.sol.
export const STATES = [
  'Proposed',
  'Ready',
  'Funded',
  'Shipped',
  'CustomsCleared',
  'Released',
  'Refunded',
  'Disputed',
]

export const LIFECYCLE = [
  { state: 0, title: 'Proposed', text: 'Escrow created, exporter named' },
  { state: 1, title: 'Ready', text: 'Exporter accepted the escrow' },
  { state: 2, title: 'Funded', text: 'Importer funds locked in the contract' },
  { state: 3, title: 'Shipped', text: '2 of 3 attestors confirmed dispatch' },
  { state: 4, title: 'CustomsCleared', text: '2 of 3 attestors confirmed clearance' },
  { state: 5, title: 'Released', text: 'Exporter paid, escrow settled' },
]

// Hardhat's well-known test accounts, used only by the "fill demo parties" button.
export const DEMO_PARTIES = {
  exporter: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // #1
  attestor1: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', // #2
  attestor2: '0x90F79bf6EB2c4f870365E785982E1f101E93b906', // #3
  attestor3: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65', // #4
  arbitrator: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc', // #5
  feeRecipient: '0x976EA74026E726554dB657fA54763abd0C3a0aa9', // #6
}

// ---------- small helpers ----------

export const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
export const short = (addr) => `${addr.slice(0, 6)}...${addr.slice(-4)}`
export const fmtEth = (wei) => ethers.formatEther(wei)
export const fmtTime = (ts) =>
  ts === 0n ? 'not set yet' : new Date(Number(ts) * 1000).toLocaleString()

export function fmtDuration(seconds) {
  const s = Math.abs(Number(seconds))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${m}m`
  return `${Math.max(m, 1)}m`
}

export function errText(error) {
  return (
    error?.reason ||
    error?.shortMessage ||
    error?.info?.error?.message ||
    error?.message ||
    'Unknown error'
  )
}

export async function ensureHardhatChain() {
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: HARDHAT_CHAIN_HEX }],
    })
  } catch (switchError) {
    // 4902 = chain not added to the wallet yet
    if (switchError.code === 4902 || switchError.code === -32603) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: HARDHAT_CHAIN_HEX,
            chainName: 'Hardhat Local',
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            rpcUrls: ['http://127.0.0.1:8545'],
          },
        ],
      })
    } else {
      throw switchError
    }
  }
}

export function getContract(address, runner) {
  return new ethers.Contract(address, EscrowABI.abi, runner)
}

// ---------- propose (deploy) a new escrow ----------

// One Escrow contract = one deal. The connected wallet deploys it and so
// becomes the importer (the constructor stores msg.sender as importer).
export async function deployEscrow(signer, p) {
  const factory = new ethers.ContractFactory(
    EscrowABI.abi,
    EscrowABI.bytecode,
    signer
  )
  const contract = await factory.deploy(
    p.exporter,
    p.amountWei,
    p.consignmentId,
    p.setupSeconds,
    p.dispatchSeconds,
    p.clearanceSeconds,
    [p.attestor1, p.attestor2, p.attestor3],
    p.arbitrator,
    p.feeRecipient,
    p.arbitrationSeconds
  )
  await contract.waitForDeployment()
  return contract.getAddress()
}

// ---------- reading the chain ----------

const blockTimeCache = new Map() // blockHash -> unix seconds

async function blockTime(provider, blockHash) {
  if (!blockTimeCache.has(blockHash)) {
    const block = await provider.getBlock(blockHash)
    blockTimeCache.set(blockHash, block.timestamp)
  }
  return blockTimeCache.get(blockHash)
}

// Every event the contract has emitted, oldest first, with timestamps.
// (Local chain: no block-range limits. Public RPC providers cap log ranges,
// so this needs revisiting before moving to a testnet.)
async function loadEvents(provider, address) {
  const iface = getContract(address, provider).interface
  const logs = await provider.getLogs({
    address,
    fromBlock: 0,
    toBlock: 'latest',
  })

  const events = []
  for (const log of logs) {
    let parsed
    try {
      parsed = iface.parseLog(log)
    } catch {
      parsed = null
    }
    if (!parsed) continue
    events.push({
      id: `${log.blockHash}-${log.index}`,
      name: parsed.name,
      args: parsed.args,
      blockNumber: log.blockNumber,
      index: log.index,
      blockHash: log.blockHash,
    })
  }

  events.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index)
  await Promise.all(
    events.map(async (e) => {
      e.time = await blockTime(provider, e.blockHash)
    })
  )
  return events
}

// Read everything the screens need about one escrow.
export async function loadSnapshot(
  address,
  provider,
  account,
  { withEvents = false } = {}
) {
  const code = await provider.getCode(address)
  if (code === '0x') {
    throw new Error(
      'No Escrow contract at this address on the connected chain (was the local node restarted?).'
    )
  }

  const contract = getContract(address, provider)

  const [
    state,
    importer,
    exporter,
    amount,
    consignmentId,
    arbitrator,
    feeBps,
    requiredStake,
    setupDeadline,
    dispatchDeadline,
    clearanceDeadline,
    arbitrationDeadline,
    block,
  ] = await Promise.all([
    contract.state(),
    contract.importer(),
    contract.exporter(),
    contract.amount(),
    contract.consignmentId(),
    contract.arbitrator(),
    contract.FEE_BPS(),
    contract.REQUIRED_STAKE(),
    contract.setupDeadline(),
    contract.dispatchDeadline(),
    contract.clearanceDeadline(),
    contract.arbitrationDeadline(),
    provider.getBlock('latest'),
  ])

  const attestors = await Promise.all(
    [0, 1, 2].map((i) => contract.attestors(i))
  )
  const stakes = await Promise.all(
    attestors.map((a) => contract.attestorStake(a))
  )

  // The contract compares deadlines against the NEXT block's timestamp.
  // The latest block can lag behind wall-clock time on a quiet local chain,
  // so use whichever is later.
  const now = BigInt(
    Math.max(block.timestamp, Math.floor(Date.now() / 1000))
  )

  const myAttestorIndex = attestors.findIndex((a) => same(a, account))

  return {
    address,
    state: Number(state),
    importer,
    exporter,
    amount,
    consignmentId,
    arbitrator,
    attestors,
    stakes,
    requiredStake,
    total: amount + (amount * feeBps) / 10000n, // amount + platform fee
    setupDeadline,
    dispatchDeadline,
    clearanceDeadline,
    arbitrationDeadline,
    now,
    myAttestorIndex,
    myStake: myAttestorIndex >= 0 ? stakes[myAttestorIndex] : 0n,
    events: withEvents ? await loadEvents(provider, address) : [],
  }
}

// ---------- roles, actions, status text ----------

// Which roles does this wallet hold in THIS escrow? (never chosen, only derived)
export function deriveRoles(s, account) {
  const roles = []
  if (same(account, s.importer)) roles.push('Importer')
  if (same(account, s.exporter)) roles.push('Exporter')
  if (s.myAttestorIndex >= 0) roles.push(`Attestor ${s.myAttestorIndex + 1}`)
  if (same(account, s.arbitrator)) roles.push('Arbitrator')
  return roles
}

// The frontend does not enforce permissions (the contract does). It only
// predicts which calls the contract would accept, so we never offer a
// button that is certain to revert and waste gas.
export function getActions(s, account) {
  const actions = []
  const isImporter = same(account, s.importer)
  const isExporter = same(account, s.exporter)
  const isArbitrator = same(account, s.arbitrator)
  const isAttestor = s.myAttestorIndex >= 0
  const staked = s.myStake >= s.requiredStake

  if (isExporter && s.state === 0) {
    actions.push({ key: 'accept', label: 'Accept escrow', variant: 'primary' })
  }

  if (isImporter && s.state === 1) {
    actions.push({
      key: 'deposit',
      label: `Deposit ${fmtEth(s.total)} POL (amount + fee)`,
      variant: 'primary',
    })
  }

  if (isAttestor && s.myStake === 0n && s.state <= 4) {
    actions.push({
      key: 'stake',
      label: `Stake ${fmtEth(s.requiredStake)} POL to become active`,
      variant: 'primary',
    })
  }

  if (isAttestor && staked && (s.state === 2 || s.state === 3)) {
    if (s.state === 2) {
      actions.push({
        key: 'attest',
        code: 3,
        label: 'Confirm dispatch (code 3)',
        variant: 'primary',
      })
    } else {
      actions.push({
        key: 'attest',
        code: 4,
        label: 'Confirm customs clearance (code 4)',
        variant: 'primary',
      })
    }
    actions.push({
      key: 'attest',
      code: 99,
      label: 'Raise a dispute (code 99)',
      variant: 'warning',
    })
  }

  if (isExporter && (s.state === 3 || s.state === 4)) {
    actions.push({ key: 'withdraw', label: 'Withdraw payment', variant: 'primary' })
  }

  if (isImporter && s.state === 2 && s.now > s.dispatchDeadline) {
    actions.push({
      key: 'refund',
      label: 'Claim refund (dispatch deadline passed)',
      variant: 'warning',
    })
  }

  if (s.state === 3 && s.now > s.clearanceDeadline) {
    actions.push({
      key: 'checkTimeout',
      label: 'Trigger clearance timeout (raises a dispute)',
      variant: 'warning',
    })
  }

  if (isArbitrator && s.state === 7) {
    actions.push({
      key: 'resolve',
      release: true,
      label: 'Resolve: release to exporter',
      variant: 'dispute',
    })
    actions.push({
      key: 'resolve',
      release: false,
      label: 'Resolve: refund importer',
      variant: 'dispute',
    })
  }

  if (s.state === 7 && s.now > s.arbitrationDeadline) {
    actions.push({
      key: 'forceResolve',
      label: 'Force refund (arbitrator did not act in time)',
      variant: 'warning',
    })
  }

  if (isAttestor && (s.state === 5 || s.state === 6) && s.myStake > 0n) {
    actions.push({
      key: 'withdrawStake',
      label: `Withdraw stake (${fmtEth(s.myStake)} POL)`,
      variant: 'primary',
    })
  }

  return actions
}

// Plain-language "what is happening and who is it waiting on".
export function waitingOn(s) {
  switch (s.state) {
    case 0:
      return `Waiting for the exporter to accept before ${fmtTime(s.setupDeadline)}.`
    case 1:
      return `Waiting for the importer to deposit ${fmtEth(s.total)} POL before ${fmtTime(s.setupDeadline)}.`
    case 2:
      return `Funds are locked. Waiting for 2 of 3 staked attestors to confirm dispatch. If that has not happened by ${fmtTime(s.dispatchDeadline)}, the importer can claim a refund.`
    case 3:
      return `Dispatch confirmed. The exporter can withdraw payment now. Attestors can still confirm customs clearance until ${fmtTime(s.clearanceDeadline)}; after that anyone can trigger the timeout.`
    case 4:
      return 'Customs cleared. Waiting for the exporter to withdraw payment.'
    case 5:
      return 'Settled: the exporter has been paid. Attestors can now withdraw their stakes.'
    case 6:
      return 'Settled: the importer has been refunded. Attestors can now withdraw their stakes.'
    case 7:
      return `Disputed. Waiting for the arbitrator to decide before ${fmtTime(s.arbitrationDeadline)}. After that, anyone can force a refund to the importer.`
    default:
      return ''
  }
}
