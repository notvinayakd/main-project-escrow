// Boots the app on an ephemeral port against a throwaway data file in the OS temp
// directory, so tests never touch the working copy of data/consignments.json.

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ctccs-test-'));

process.env.NODE_ENV = 'test';
process.env.OFFICER_PIN = 'test-officer-pin';
process.env.TRADER_PIN = 'test-trader-pin';
process.env.DATA_FILE = path.join(TMP_DIR, 'consignments.json');
// The suite tests the real validation rules, so the testing switch is pinned off here
// regardless of what the developer has in their .env.
process.env.RELAXED = 'false';

function cleanup() {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
}

async function start() {
  const { createApp } = require('../app');
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  return { server, base: `http://127.0.0.1:${server.address().port}`, stop: () => new Promise((r) => server.close(r)) };
}

async function call(base, method, path, { token, body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, body: json, text };
}

// Tokens are cached per account: the sign-in route is rate limited on purpose, and a
// test suite hammering it would be testing the limiter rather than the portal.
const tokenCache = new Map();

async function signIn(base, accountId, pin) {
  const key = `${base}|${accountId}`;
  if (tokenCache.has(key)) return tokenCache.get(key);
  const r = await call(base, 'POST', '/ctccs/auth/session', { body: { accountId, pin } });
  if (r.status !== 200) throw new Error(`sign-in failed for ${accountId}: ${r.text}`);
  tokenCache.set(key, r.body.token);
  return r.body.token;
}

let lcSeq = 5000;
/** A valid declaration with a fresh LC reference — LC references must be unique. */
const declaration = (overrides = {}) => ({ ...VALID_DECLARATION, lcRef: `LC-2026-${lcSeq++}`, ...overrides });

const VALID_DECLARATION = {
  lcRef: 'LC-2026-0999',
  importerName: 'Antwerp Trading NV',
  importerCountry: 'BE',
  vesselName: 'MV Test Runner',
  vesselImo: '9111222',
  vesselVoyage: 'TR-001W',
  originPort: 'INCOK', originName: 'Kochi',
  destinationPort: 'BEANR', destinationName: 'Antwerp',
  commodityDescription: 'Cardamom, green',
  hsCode: '090831',
  quantityValue: 5, quantityUnit: 'MT',
  declaredAmount: 42000, declaredCurrency: 'USD'
};

module.exports = { start, call, signIn, cleanup, VALID_DECLARATION, declaration, TMP_DIR };
