// Account register: customs officers and registered exporters (traders).
//
// Credentials are stored as scrypt hashes with a per-account salt, derived at boot from
// the configured PIN. Real systems hold these in a directory service; the point here is
// that no plaintext credential sits in memory or in a file, and that the comparison is
// timing-safe. That the demo derives every hash from one shared PIN is a documented
// simplification, not an accident.

const crypto = require('crypto');
const { config } = require('../config');

const OFFICERS = [
  { id: 'VDN-4471',     name: 'V. D. Nair',     station: 'Kochi Customs House',  port: 'INCOK', tzOffsetMinutes: 330 },
  { id: 'TN-CUST-3390', name: 'R. Subramanian', station: 'Chennai Custom House', port: 'INMAA', tzOffsetMinutes: 330 },
  { id: 'GJ-CUST-2210', name: 'H. Patel',       station: 'Kandla Custom House',  port: 'INIXY', tzOffsetMinutes: 330 },
  { id: 'NL-CUST-221',  name: 'J. van Dijk',    station: 'Rotterdam Douane',     port: 'NLRTM', tzOffsetMinutes: 120 },
  { id: 'DE-CUST-770',  name: 'M. Keller',      station: 'Hamburg Zollamt',      port: 'DEHAM', tzOffsetMinutes: 120 },
  { id: 'SG-CUST-118',  name: 'L. Tan',         station: 'Singapore Customs',    port: 'SGSIN', tzOffsetMinutes: 480 }
];

const TRADERS = [
  { id: 'TRD-1001', name: 'Malabar Spice Exports Pvt Ltd',  country: 'IN', homePort: 'INCOK', tzOffsetMinutes: 330 },
  { id: 'TRD-1002', name: 'Coimbatore Textile Mills Ltd',   country: 'IN', homePort: 'INMAA', tzOffsetMinutes: 330 },
  { id: 'TRD-1003', name: 'Kandla Marine Foods',            country: 'IN', homePort: 'INIXY', tzOffsetMinutes: 330 }
];

const credentials = new Map();

function hash(pin, salt) {
  return crypto.scryptSync(pin, salt, 32);
}

function register(account, role, pin) {
  const salt = crypto.randomBytes(16);
  credentials.set(account.id, { salt, digest: hash(pin, salt), role, account });
}

for (const o of OFFICERS) register(o, 'officer', config.officerPin);
for (const t of TRADERS) register(t, 'trader', config.traderPin);

/**
 * Verifies an id and PIN. Returns an actor, or null.
 * Always performs a comparison of equal cost, so response time does not reveal whether the
 * account id existed.
 */
function authenticate(id, pin) {
  const key = String(id || '').trim().toUpperCase();
  const entry = credentials.get(key);
  const salt = entry ? entry.salt : Buffer.alloc(16);
  const expected = entry ? entry.digest : Buffer.alloc(32);
  const supplied = hash(String(pin || ''), salt);
  const match = crypto.timingSafeEqual(expected, supplied);
  if (!entry || !match) return null;
  return actorFor(entry);
}

function actorFor(entry) {
  const a = entry.account;
  return entry.role === 'officer'
    ? { role: 'officer', id: a.id, name: a.name, station: a.station, port: a.port, tzOffsetMinutes: a.tzOffsetMinutes }
    : { role: 'trader', id: a.id, name: a.name, country: a.country, homePort: a.homePort, tzOffsetMinutes: a.tzOffsetMinutes };
}

const findTrader = (id) => TRADERS.find((t) => t.id === String(id || '').toUpperCase()) || null;

/** Public directory for the sign-in picker. Never exposes credentials. */
function directory() {
  return {
    officers: OFFICERS.map(({ id, name, station, port }) => ({ id, name, station, port })),
    traders: TRADERS.map(({ id, name, country, homePort }) => ({ id, name, country, homePort }))
  };
}

/**
 * ISO 8601 with an explicit offset, e.g. 2026-08-19T10:05:00+05:30.
 * A customs record states local time; a bare Z would be wrong on the paperwork.
 */
function isoAtStation(date, offsetMinutes) {
  const shifted = new Date(date.getTime() + offsetMinutes * 60000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return shifted.toISOString().replace(/\.\d{3}Z$/, '')
    + sign + String(Math.floor(abs / 60)).padStart(2, '0') + ':' + String(abs % 60).padStart(2, '0');
}

module.exports = { OFFICERS, TRADERS, authenticate, findTrader, directory, isoAtStation };
