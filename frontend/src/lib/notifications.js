import { STATES, fmtDuration, fmtEth, getActions } from './escrow'

// Tones: 'action' (your turn), 'warn', 'danger', 'success', 'info'.
// Only action / warn / danger count towards the bell badge.

// Attestations submitted in the CURRENT phase (since the escrow entered
// Funded or Shipped). Two matching votes advance the escrow.
export function attestationVotes(events, state) {
  const marker = state === 2 ? 'EscrowFunded' : state === 3 ? 'EscrowShipped' : null
  if (!marker) return []
  let start = -1
  events.forEach((e, i) => {
    if (e.name === marker) start = i
  })
  return events
    .slice(start + 1)
    .filter((e) => e.name === 'StatusAttested')
    .map((e) => ({ attestor: e.args.attestor, code: Number(e.args.statusCode) }))
}

const PASSED_TEXT = {
  0: 'Setup window expired. The contract will now reject accept and deposit.',
  1: 'Setup window expired. The contract will now reject accept and deposit.',
  2: 'Dispatch deadline passed. The importer can claim a refund.',
  3: 'Clearance deadline passed. Anyone can trigger the timeout.',
  7: 'Arbitration deadline passed. Anyone can force a refund to the importer.',
}

// "What needs attention on the escrow I am looking at right now."
export function buildAlerts(s, account) {
  const out = []
  const push = (id, tone, text) => out.push({ id, tone, text })
  const actions = getActions(s, account)

  if (actions.length) {
    const more = actions.length > 1 ? ` (+${actions.length - 1} more)` : ''
    push('action', 'action', `Action needed from you: ${actions[0].label}${more}`)
  }

  if (s.state === 7) {
    push('dispute', 'danger', 'Dispute open. The arbitrator must decide the outcome.')
  }

  const deadline = {
    0: ['Setup window', s.setupDeadline],
    1: ['Setup window', s.setupDeadline],
    2: ['Dispatch deadline', s.dispatchDeadline],
    3: ['Clearance deadline', s.clearanceDeadline],
    7: ['Arbitration deadline', s.arbitrationDeadline],
  }[s.state]
  if (deadline) {
    const left = deadline[1] - s.now
    if (left > 0n) {
      push('deadline', left < 3600n ? 'warn' : 'info', `${deadline[0]}: ${fmtDuration(left)} left`)
    } else {
      push('deadline', 'warn', PASSED_TEXT[s.state])
    }
  }

  if (s.state === 2 || s.state === 3) {
    const votes = attestationVotes(s.events, s.state)
    push(
      'votes',
      'info',
      `Attestation: ${votes.length} of 3 attestors have voted this phase (2 matching votes needed).`
    )
  }

  if (s.state <= 3) {
    const staked = s.stakes.filter((x) => x >= s.requiredStake).length
    if (staked < 2) {
      push(
        'staking',
        'warn',
        `Only ${staked} of 3 attestors have staked. At least 2 must stake before a quorum is possible.`
      )
    }
  }

  if (s.state === 5 || s.state === 6) {
    push('settled', 'success', `Escrow settled (${STATES[s.state]}).`)
  }

  return out
}

// Light version for the escrows you are NOT looking at.
export function buildListAlerts(s, account) {
  if (!s || s.missing) return []
  const out = []
  const actions = getActions(s, account)
  if (actions.length) {
    out.push({
      id: `${s.address}-action`,
      tone: 'action',
      text: `${s.consignmentId}: ${actions[0].label}`,
    })
  }
  if (s.state === 7) {
    out.push({
      id: `${s.address}-dispute`,
      tone: 'danger',
      text: `${s.consignmentId}: dispute open`,
    })
  }
  return out
}

// Turn raw contract events into readable activity entries, newest first.
export function eventsToNotes(s) {
  const who = (addr) => {
    const i = s.attestors.findIndex((a) => a.toLowerCase() === addr.toLowerCase())
    return i >= 0 ? `Attestor ${i + 1}` : 'An attestor'
  }

  const notes = s.events.map((e) => {
    let tone = 'info'
    let text = e.name
    switch (e.name) {
      case 'EscrowAccepted':
        text = 'The exporter accepted the escrow.'
        break
      case 'EscrowFunded':
        text = `The importer funded the escrow (${fmtEth(e.args.amount)} POL locked).`
        break
      case 'AttestorStaked':
        text = `${who(e.args.attestor)} staked ${fmtEth(e.args.amount)} POL.`
        break
      case 'StatusAttested': {
        const code = Number(e.args.statusCode)
        if (code === 99) {
          tone = 'warn'
          text = `${who(e.args.attestor)} raised a dispute (code 99).`
        } else if (code === 3) {
          text = `${who(e.args.attestor)} confirmed dispatch (code 3).`
        } else if (code === 4) {
          text = `${who(e.args.attestor)} confirmed customs clearance (code 4).`
        } else {
          text = `${who(e.args.attestor)} attested with code ${code}.`
        }
        break
      }
      case 'EscrowShipped':
        text = 'Dispatch confirmed by 2 of 3 attestors.'
        tone = 'success'
        break
      case 'EscrowCustomsCleared':
        text = 'Customs clearance confirmed by 2 of 3 attestors.'
        tone = 'success'
        break
      case 'EscrowReleased':
        text = `${fmtEth(e.args.amount)} POL released to the exporter.`
        tone = 'success'
        break
      case 'EscrowRefunded':
        text = `${fmtEth(e.args.amount)} POL refunded to the importer.`
        tone = 'success'
        break
      case 'EscrowDisputed':
        text = 'The escrow is now in dispute. The arbitrator must decide.'
        tone = 'danger'
        break
      case 'AttestorSlashed':
        text = `${who(e.args.attestor)} was slashed ${fmtEth(e.args.amount)} POL.`
        tone = 'danger'
        break
      case 'DisputeResolved':
        text = `The arbitrator resolved the dispute: ${STATES[Number(e.args.outcome)]}.`
        tone = 'success'
        break
      case 'ForcedDisputeResolution':
        text = 'Arbitration deadline passed: the importer was refunded automatically.'
        tone = 'warn'
        break
      case 'AttestorStakeWithdrawn':
        text = `${who(e.args.attestor)} withdrew their stake.`
        break
      default:
        break
    }
    return { id: e.id, tone, text, time: e.time }
  })

  return notes.reverse()
}
