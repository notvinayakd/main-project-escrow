// Exporter workspace: register a consignment, amend it before lodgement, withdraw it,
// and see your own book of business.
//
// EXPORTERS ONLY. A customs officer must not be able to register a consignment: an officer
// who could both create a record and advance it would be doing the whole transaction
// alone, which is exactly the separation of duties this system exists to enforce.
// (In reality it is a licensed Customs House Agent, a private broker, who files on behalf
// of an exporter -- not the officer. Modelling that agent is future work; for now the
// exporter files for themselves.)

const express = require('express');
const { requireRole } = require('./auth');
const { readAll } = require('../lib/store');
const { summaryRecord, publicRecord } = require('../lib/record');
const { register, amend, setStatus } = require('../lib/consignments');
const { availableActions } = require('../lib/statuses');
const { paging, str, num, pattern, oneOf,
        PORT_RE, HS_RE, IMO_RE, COUNTRY_RE, LC_RE, UNITS, CURRENCIES } = require('../lib/validate');
const { wrap } = require('../lib/errors');

const router = express.Router();
router.use(requireRole('trader'));

/** Validates a consignment declaration. Shared by register and amend. */
function readDeclaration(body, { partial = false } = {}) {
  const req = !partial;
  const out = {
    lcRef: pattern(body, 'lcRef', LC_RE, 'in the form LC-2026-0417', { required: req }),
    importerName: str(body, 'importerName', { required: req, max: 120 }),
    importerCountry: pattern(body, 'importerCountry', COUNTRY_RE, 'a two-letter ISO country code', { required: req }),
    vesselName: str(body, 'vesselName', { required: req, max: 80 }),
    vesselImo: pattern(body, 'vesselImo', IMO_RE, 'a 7-digit IMO number', { required: req }),
    vesselVoyage: str(body, 'vesselVoyage', { required: req, max: 20, upper: true }),
    originPort: pattern(body, 'originPort', PORT_RE, 'a 5-letter UN/LOCODE such as INCOK', { required: req }),
    originName: str(body, 'originName', { required: req, max: 60 }),
    destinationPort: pattern(body, 'destinationPort', PORT_RE, 'a 5-letter UN/LOCODE such as NLRTM', { required: req }),
    destinationName: str(body, 'destinationName', { required: req, max: 60 }),
    commodityDescription: str(body, 'commodityDescription', { required: req, max: 120 }),
    hsCode: pattern(body, 'hsCode', HS_RE, 'a 6-digit HS code', { required: req }),
    quantityUnit: oneOf(body, 'quantityUnit', UNITS, { required: req }),
    declaredCurrency: oneOf(body, 'declaredCurrency', CURRENCIES, { required: req }),
    remark: str(body, 'remark', { required: false, max: 240 }),
    reason: str(body, 'reason', { required: false, max: 240 })
  };
  const has = (f) => body?.[f] !== undefined && body?.[f] !== null && body?.[f] !== '';
  if (req || has('quantityValue')) out.quantityValue = num(body, 'quantityValue', { min: 0.001, max: 1e6 });
  if (req || has('declaredAmount')) out.declaredAmount = num(body, 'declaredAmount', { min: 1, max: 1e11 });
  if (req && out.originPort === out.destinationPort) {
    const { badRequest } = require('../lib/errors');
    throw badRequest('Origin and destination ports must differ.', { field: 'destinationPort' });
  }
  return out;
}

/** The signed-in exporter's own consignments. */
router.get('/consignments', wrap((req, res) => {
  const { page, size, offset } = paging(req.query);
  let rows = readAll().filter((c) => c.traderId === req.actor.id);
  rows.sort((a, b) => String(b.statusSetAt).localeCompare(String(a.statusSetAt)));
  res.json({
    total: rows.length, page, pageSize: size,
    pageCount: Math.max(1, Math.ceil(rows.length / size)),
    consignments: rows.slice(offset, offset + size).map((c) => ({
      ...summaryRecord(c), actions: availableActions(req.actor, c)
    }))
  });
}));

router.post('/consignments', wrap(async (req, res) => {
  const created = await register(req.actor, readDeclaration(req.body));
  res.status(201).json(publicRecord(created));
}));

router.patch('/consignment/:id', wrap(async (req, res) => {
  const changes = readDeclaration(req.body, { partial: true });
  const updated = await amend(req.actor, String(req.params.id).toUpperCase(), changes);
  res.json(publicRecord(updated));
}));

/** Withdraw a consignment, permitted only before dispatch. */
router.post('/consignment/:id/withdraw', wrap(async (req, res) => {
  const remark = str(req.body, 'remark', { required: false, max: 240 });
  const updated = await setStatus(req.actor, String(req.params.id).toUpperCase(), 'cancelled', remark);
  res.json(publicRecord(updated));
}));

module.exports = router;
