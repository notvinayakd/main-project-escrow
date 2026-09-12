// Public read API. No authentication anywhere in this file, by design:
// PORTAL_SPEC.md 3.1 explains why the attestation target must be publicly readable.

const express = require('express');
const { readAll, findConsignment, findByReference } = require('../lib/store');
const { publicRecord, summaryRecord } = require('../lib/record');
const { STATUS_CODES, LABELS, ALL } = require('../lib/statuses');
const { paging } = require('../lib/validate');
const { notFound, wrap } = require('../lib/errors');

const router = express.Router();

function mustFind(id) {
  const c = findConsignment(id);
  if (!c) throw notFound(`No consignment with reference ${id}`);
  return c;
}

/**
 * Search and listing. Supports free text across reference, B/L, LC, exporter and
 * commodity, plus status and port filters, and pages the result.
 */
router.get('/consignments', wrap((req, res) => {
  const { page, size, offset } = paging(req.query);
  const q = String(req.query.q || '').trim().toUpperCase();
  const status = String(req.query.status || '').trim().toLowerCase();
  const port = String(req.query.port || '').trim().toUpperCase();

  let rows = readAll();
  if (q) {
    rows = rows.filter((c) => [
      c.consignmentId, c.billOfLading, c.lcRef, c.exporter.name,
      c.importer.name, c.commodity.description, c.commodity.hsCode
    ].some((f) => f && String(f).toUpperCase().includes(q)));
  }
  if (status && ALL.includes(status)) rows = rows.filter((c) => c.status === status);
  if (port) rows = rows.filter((c) => c.origin.port === port || c.destination.port === port);

  rows.sort((a, b) => String(b.statusSetAt).localeCompare(String(a.statusSetAt)));

  res.json({
    total: rows.length,
    page,
    pageSize: size,
    pageCount: Math.max(1, Math.ceil(rows.length / size)),
    consignments: rows.slice(offset, offset + size).map(summaryRecord)
  });
}));

/** Public tracking box: accepts a consignment reference, a bill of lading, or an LC reference. */
router.get('/track', wrap((req, res) => {
  const ref = String(req.query.ref || '').trim();
  const c = findByReference(ref);
  if (!c) throw notFound(`No consignment found for reference "${ref}".`);
  res.json(publicRecord(c));
}));

/**
 * THE ATTESTATION TARGET.
 *
 * Returns exactly PORTAL_SPEC.md 2.1, byte-stable between requests. Do not add a
 * timestamp, request id, nonce or any other per-request field to this response body.
 * Doing so silently breaks attestor agreement in Phase 3.
 */
router.get('/consignment/:id', wrap((req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(publicRecord(mustFind(req.params.id)));
}));

router.get('/consignment/:id/movements', wrap((req, res) => {
  const c = mustFind(req.params.id);
  res.json({
    consignmentId: c.consignmentId,
    movements: c.movements.map((m) => ({ ...m, label: LABELS[m.status] || m.status }))
  });
}));

router.get('/consignment/:id/entries', wrap((req, res) => {
  const c = mustFind(req.params.id);
  res.json({ consignmentId: c.consignmentId, entries: c.entries });
}));

/** Amendment trail — what changed, when, and by whom. */
router.get('/consignment/:id/amendments', wrap((req, res) => {
  const c = mustFind(req.params.id);
  res.json({ consignmentId: c.consignmentId, amendments: c.amendments || [] });
}));

router.get('/reports/summary', wrap((req, res) => {
  const all = readAll();
  const byStatus = Object.fromEntries(Object.keys(STATUS_CODES).map((s) => [s, 0]));
  const byRoute = {};
  const byExporter = {};
  let declaredTotal = 0;

  for (const c of all) {
    byStatus[c.status] = (byStatus[c.status] || 0) + 1;
    const route = `${c.origin.port} → ${c.destination.port}`;
    byRoute[route] ??= { route, count: 0, declaredValueUsd: 0 };
    byRoute[route].count += 1;
    byRoute[route].declaredValueUsd += c.declaredValue.amount;
    byExporter[c.exporter.name] ??= { exporter: c.exporter.name, count: 0, declaredValueUsd: 0 };
    byExporter[c.exporter.name].count += 1;
    byExporter[c.exporter.name].declaredValueUsd += c.declaredValue.amount;
    declaredTotal += c.declaredValue.amount;
  }

  const desc = (a, b) => b.declaredValueUsd - a.declaredValueUsd;
  res.json({
    generatedFor: 'CTCCS operational summary',
    totalConsignments: all.length,
    declaredValueUsdTotal: declaredTotal,
    clearedCount: all.filter((c) => c.status === 'customs_cleared').length,
    heldCount: all.filter((c) => c.status === 'held').length,
    cancelledCount: all.filter((c) => c.status === 'cancelled').length,
    inTransitCount: all.filter((c) => c.status === 'dispatched').length,
    byStatus,
    byRoute: Object.values(byRoute).sort(desc),
    byExporter: Object.values(byExporter).sort(desc)
  });
}));

/** Machine-readable description of the lifecycle, for the Public API screen and integrators. */
router.get('/reference/statuses', wrap((req, res) => {
  res.json({
    statuses: Object.entries(STATUS_CODES).map(([status, statusCode]) => ({
      status, statusCode, label: LABELS[status]
    }))
  });
}));

module.exports = router;
