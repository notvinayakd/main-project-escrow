// Hand-rolled input validation. No schema library: the rules here are few, specific to
// trade documents, and worth reading in full rather than trusting to a dependency.
// Every validator returns a cleaned value or throws an ApiError describing the field.

const { badRequest } = require('./errors');
const { config } = require('../config');

const PORT_RE = /^[A-Z]{5}$/;          // UN/LOCODE, e.g. INCOK
const HS_RE = /^\d{6}$/;               // Harmonised System subheading
const IMO_RE = /^\d{7}$/;              // IMO ship identification number
const COUNTRY_RE = /^[A-Z]{2}$/;       // ISO 3166-1 alpha-2
const LC_RE = /^LC-\d{4}-\d{3,6}$/;
const UNITS = ['MT', 'KG', 'TEU', 'CBM', 'PCS'];
const CURRENCIES = ['USD', 'EUR', 'INR', 'SGD', 'GBP', 'AED'];

function str(body, field, { required = true, min = 1, max = 120, upper = false } = {}) {
  let v = body?.[field];
  if (v === undefined || v === null || String(v).trim() === '') {
    if (!required) return null;
    throw badRequest(`"${field}" is required.`, { field });
  }
  v = String(v).trim();
  if (upper) v = v.toUpperCase();
  if (v.length < min) throw badRequest(`"${field}" must be at least ${min} characters.`, { field });
  if (v.length > max) throw badRequest(`"${field}" must be at most ${max} characters.`, { field });
  return v;
}

function num(body, field, { min = 0, max = 1e12, integer = false } = {}) {
  const raw = body?.[field];
  if (raw === undefined || raw === null || raw === '') throw badRequest(`"${field}" is required.`, { field });
  const v = Number(raw);
  if (!Number.isFinite(v)) throw badRequest(`"${field}" must be a number.`, { field });
  if (integer && !Number.isInteger(v)) throw badRequest(`"${field}" must be a whole number.`, { field });
  if (v < min) throw badRequest(`"${field}" must be at least ${min}.`, { field });
  if (v > max) throw badRequest(`"${field}" must be at most ${max}.`, { field });
  return v;
}

function pattern(body, field, re, hint, opts = {}) {
  const v = str(body, field, { upper: true, ...opts });
  if (v === null) return null;
  // Format checks are skipped while the testing switch is on (see config.relaxedValidation).
  // The field is still required and still length-capped -- only its shape goes unchecked.
  if (config.relaxedValidation) return v;
  if (!re.test(v)) throw badRequest(`"${field}" must be ${hint}.`, { field, got: v });
  return v;
}

function oneOf(body, field, allowed, { required = true, enforce = false } = {}) {
  const v = str(body, field, { required, upper: true });
  if (v === null) return null;
  // `enforce` marks vocabularies that are never relaxed -- the status names, which the
  // escrow contract reads. Everything else is a data field and follows the testing switch.
  if (config.relaxedValidation && !enforce) return v;
  if (!allowed.includes(v)) {
    throw badRequest(`"${field}" must be one of: ${allowed.join(', ')}.`, { field, got: v });
  }
  return v;
}

/** Pagination shared by every list endpoint. */
function paging(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const size = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
  return { page, size, offset: (page - 1) * size };
}

module.exports = { str, num, pattern, oneOf, paging, PORT_RE, HS_RE, IMO_RE, COUNTRY_RE, LC_RE, UNITS, CURRENCIES };
