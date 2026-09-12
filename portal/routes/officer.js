// Customs officer workspace: the work queue for this officer's station, and the actions
// that move a consignment through clearance.

const express = require('express');
const { requireRole } = require('./auth');
const { readAll } = require('../lib/store');
const { summaryRecord, publicRecord } = require('../lib/record');
const { setStatus } = require('../lib/consignments');
const { availableActions, ALL } = require('../lib/statuses');
const { resetStore } = require('../lib/store');
const { str, oneOf, paging } = require('../lib/validate');
const { wrap } = require('../lib/errors');
const { config } = require('../config');

const router = express.Router();
router.use(requireRole('officer'));

/**
 * Work queue: consignments this officer can actually act on right now, at their station.
 * A customs officer does not want a list of everything in the country -- they want the
 * ones waiting on them.
 */
router.get('/queue', wrap((req, res) => {
  const { page, size, offset } = paging(req.query);
  const rows = readAll()
    .map((c) => ({ c, actions: availableActions(req.actor, c) }))
    .filter(({ c, actions }) =>
      actions.some((a) => a !== 'held' && a !== 'cancelled') &&
      (c.origin.port === req.actor.port || c.destination.port === req.actor.port))
    .sort((a, b) => String(a.c.statusSetAt).localeCompare(String(b.c.statusSetAt)));

  res.json({
    station: { id: req.actor.id, name: req.actor.station, port: req.actor.port },
    total: rows.length, page, pageSize: size,
    pageCount: Math.max(1, Math.ceil(rows.length / size)),
    consignments: rows.slice(offset, offset + size)
      .map(({ c, actions }) => ({ ...summaryRecord(c), actions }))
  });
}));

/** What this officer may do to one consignment — drives the UI's buttons. */
router.get('/consignment/:id/actions', wrap((req, res) => {
  const c = readAll().find((x) => x.consignmentId === String(req.params.id).toUpperCase());
  if (!c) return res.status(404).json({ error: 'not_found', message: `No consignment with reference ${req.params.id}` });
  res.json({ consignmentId: c.consignmentId, currentStatus: c.status, actions: availableActions(req.actor, c) });
}));

/** Record a status change. The "a real-world event happened" action. */
router.post('/consignment/:id/status', wrap(async (req, res) => {
  const status = oneOf(req.body, 'status', ALL.map((s) => s.toUpperCase()), { enforce: true });
  const remark = str(req.body, 'remark', { required: false, max: 240 });
  const updated = await setStatus(req.actor, String(req.params.id).toUpperCase(), status.toLowerCase(), remark);
  res.json(publicRecord(updated));
}));

/** Demo convenience: put every record back to seed. Disabled in production. */
router.post('/reset', wrap(async (req, res) => {
  if (config.env === 'production') {
    return res.status(403).json({ error: 'forbidden', message: 'Reset is disabled in production.' });
  }
  const list = await resetStore();
  console.log(`[ctccs] data reset to ${list.length} seed consignments by ${req.actor.id}`);
  res.json({ ok: true, reset: list.length });
}));

module.exports = router;
