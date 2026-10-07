import { ethers } from 'ethers'

// Per-browser conveniences only. Nothing here is authoritative: the
// blockchain is the source of truth for every escrow.

const ESCROWS_KEY = 'trustlc.escrows'
const SEEN_KEY = 'trustlc.seen'
const DISCONNECTED_KEY = 'trustlc.disconnected'

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage unavailable (private mode etc.): the app still works
  }
}

// Escrows this browser knows about. Starts empty. Do NOT filter by a fixed
// address here: Hardhat addresses are deterministic, so the first escrow any
// account deploys on a fresh chain lands at the same address every time.
// Entries that no longer exist on the chain show a "Remove" button instead.
export function loadEscrows() {
  const list = read(ESCROWS_KEY, [])
  return Array.isArray(list) ? list : []
}

export function addEscrow(address) {
  const normalized = ethers.getAddress(address)
  const list = loadEscrows()
  if (list.some((a) => a.toLowerCase() === normalized.toLowerCase())) return list
  const next = [...list, normalized]
  write(ESCROWS_KEY, next)
  return next
}

export function removeEscrow(address) {
  const next = loadEscrows().filter(
    (a) => a.toLowerCase() !== address.toLowerCase()
  )
  write(ESCROWS_KEY, next)
  return next
}

// How many activity entries the user has already seen, per escrow.
export function getSeen(address) {
  return read(SEEN_KEY, {})[address.toLowerCase()] ?? 0
}

export function setSeen(address, count) {
  const all = read(SEEN_KEY, {})
  all[address.toLowerCase()] = count
  write(SEEN_KEY, all)
}

// So "Disconnect" survives a page reload.
export function isDisconnected() {
  return read(DISCONNECTED_KEY, false)
}

export function setDisconnected(value) {
  write(DISCONNECTED_KEY, value)
}
