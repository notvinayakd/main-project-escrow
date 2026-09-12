// Configuration, read once and validated at boot.
// A misconfigured service should refuse to start rather than run insecurely and be
// discovered during a viva.

const DEFAULT_OFFICER_PIN = '4471';
const DEFAULT_TRADER_PIN = '1001';

const path = require('path');

const config = {
  env: process.env.NODE_ENV || 'development',
  // Where records are persisted. Configurable so tests can run against a throwaway file
  // and so a deployment can point at a mounted disk instead of the app directory.
  dataFile: process.env.DATA_FILE || path.join(__dirname, 'data', 'consignments.json'),
  port: Number(process.env.PORT || 4000),
  officerPin: process.env.OFFICER_PIN || DEFAULT_OFFICER_PIN,
  traderPin: process.env.TRADER_PIN || DEFAULT_TRADER_PIN,
  sessionTtlMinutes: Number(process.env.SESSION_TTL_MINUTES || 30),
  // Sign-in attempts allowed per IP per 10 minutes. Tuneable because the right number
  // depends on deployment: one demo laptop behind one address is not a public portal.
  signInLimit: Number(process.env.SIGNIN_LIMIT || 20),
  // Comma-separated list, or * for any. Reads are public, so a permissive default is
  // correct here -- an attestor may fetch from anywhere.
  corsOrigins: process.env.CORS_ORIGINS || '*',
  trustProxy: process.env.TRUST_PROXY !== 'false', // Render terminates TLS upstream

  // TESTING SWITCH. While true, declaration fields are not checked against their trade
  // formats -- any string passes for HS code, UN/LOCODE, IMO number, LC reference and
  // country, and unit/currency are not checked against their vocabularies. Required
  // fields, length caps and "must be a number" still apply, because the record shape
  // itself has to stay intact.
  //
  // Currently ON by default so the forms are quick to fill during development. Set
  // RELAXED=false to get the real checks back. It is forced OFF in production regardless
  // of the variable -- a deployed portal accepting "BANANA" as a port code is not a
  // portal anyone should attest against.
  relaxedValidation: process.env.NODE_ENV === 'production' ? false : process.env.RELAXED !== 'false'
};

function validate() {
  const problems = [];
  const warnings = [];

  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    problems.push(`PORT must be a valid port number, got "${process.env.PORT}"`);
  }
  if (!Number.isFinite(config.sessionTtlMinutes) || config.sessionTtlMinutes < 1) {
    problems.push(`SESSION_TTL_MINUTES must be a positive number, got "${process.env.SESSION_TTL_MINUTES}"`);
  }
  if (!Number.isInteger(config.signInLimit) || config.signInLimit < 1) {
    problems.push(`SIGNIN_LIMIT must be a positive whole number, got "${process.env.SIGNIN_LIMIT}"`);
  }
  for (const [name, value, fallback] of [
    ['OFFICER_PIN', config.officerPin, DEFAULT_OFFICER_PIN],
    ['TRADER_PIN', config.traderPin, DEFAULT_TRADER_PIN]
  ]) {
    if (value === fallback) {
      // Refusing to boot in production is the point: a deployed portal running on a PIN
      // published in the README is worse than a portal that does not start.
      (config.env === 'production' ? problems : warnings)
        .push(`${name} is still the documented default. Set a real one before deploying.`);
    } else if (value.length < 4) {
      problems.push(`${name} must be at least 4 characters.`);
    }
  }

  if (config.relaxedValidation) {
    warnings.push('RELAXED validation is ON — trade-document formats are not being checked. ' +
                  'Set RELAXED=false before demoing or deploying.');
  }

  return { problems, warnings };
}

module.exports = { config, validate };
