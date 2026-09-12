// Consignment domain logic. Everything that creates or changes a consignment goes through
// here, so the rules live in one place rather than being restated in each route.

const { transaction } = require('./store');
const { computeRecordHash } = require('./record');
const { consignmentRef, billOfLading, customsEntry } = require('./ids');
const { isoAtStation, findTrader } = require('./users');
const {
  HELD, CANCELLED, LABELS, canTransition, canActorSet, isClosed
} = require('./statuses');
const { notFound, forbidden, conflict, badRequest } = require('./errors');

const now = (actor) => isoAtStation(new Date(), actor.tzOffsetMinutes ?? 330);

/** Registers a new consignment. Exporters register their own -- see routes/trader.js. */
async function register(actor, input) {
  const trader = findTrader(actor.id);
  if (!trader) throw badRequest('A registered exporter must be named for the consignment.', { field: 'traderId' });

  const at = now(actor);
  return transaction((db) => {
    // A Letter of Credit backs exactly one consignment. Allowing two would break the
    // link from this record to its escrow contract, which is keyed on the LC reference.
    const clash = db.consignments.find(
      (c) => c.lcRef.toUpperCase() === input.lcRef.toUpperCase() && c.status !== 'cancelled');
    if (clash) {
      throw conflict('lc_already_used',
        `${input.lcRef} is already registered against consignment ${clash.consignmentId}.`,
        { consignmentId: clash.consignmentId });
    }

    const seq = db.nextConsignmentSeq++;
    const consignmentId = consignmentRef(seq);

    const record = {
      consignmentId,
      lcRef: input.lcRef,
      status: 'booking_confirmed',
      billOfLading: null,
      traderId: trader.id,
      exporter: { name: trader.name, country: trader.country },
      importer: { name: input.importerName, country: input.importerCountry },
      vessel: { name: input.vesselName, imo: input.vesselImo, voyage: input.vesselVoyage },
      origin: { port: input.originPort, name: input.originName },
      destination: { port: input.destinationPort, name: input.destinationName },
      commodity: { description: input.commodityDescription, hsCode: input.hsCode },
      quantity: { value: input.quantityValue, unit: input.quantityUnit },
      declaredValue: { amount: input.declaredAmount, currency: input.declaredCurrency },
      customsEntryNo: null,
      statusSetBy: actor.id,
      statusSetAt: at,
      heldFrom: null,
      heldBy: null,
      movements: [{
        at, status: 'booking_confirmed',
        loc: `${input.originName} (${input.originPort})`,
        officer: actor.id,
        remark: input.remark || `Consignment registered against ${input.lcRef}`
      }],
      entries: [],
      amendments: []
    };
    record.recordHash = computeRecordHash(record);
    db.consignments.push(record);
    return record;
  });
}

/**
 * Amends declaration details. Only before the goods are lodged with customs: once an
 * officer has accepted the paperwork, changing it is a formal amendment, not an edit.
 * Every change is kept in `amendments` so the record is auditable.
 */
async function amend(actor, consignmentId, changes) {
  const at = now(actor);
  return transaction((db) => {
    const c = db.consignments.find((x) => x.consignmentId === consignmentId);
    if (!c) throw notFound(`No consignment with reference ${consignmentId}`);
    if (actor.role === 'trader' && c.traderId !== actor.id) {
      throw forbidden('This consignment belongs to another exporter.');
    }
    if (c.status !== 'booking_confirmed') {
      throw conflict('amendment_closed',
        `Details may only be amended before documents are lodged. This consignment is ${LABELS[c.status].toLowerCase()}.`,
        { currentStatus: c.status });
    }

    if (changes.lcRef && changes.lcRef.toUpperCase() !== c.lcRef.toUpperCase()) {
      const clash = db.consignments.find(
        (x) => x.lcRef.toUpperCase() === changes.lcRef.toUpperCase() && x.status !== 'cancelled');
      if (clash) {
        throw conflict('lc_already_used',
          `${changes.lcRef} is already registered against consignment ${clash.consignmentId}.`,
          { consignmentId: clash.consignmentId });
      }
    }

    const before = {};
    const after = {};
    const apply = (path, value) => {
      if (value === undefined || value === null) return;
      const [head, leaf] = path.split('.');
      const target = leaf ? c[head] : c;
      const key = leaf || head;
      if (String(target[key]) === String(value)) return;
      before[path] = target[key];
      after[path] = value;
      target[key] = value;
    };

    apply('lcRef', changes.lcRef);
    apply('importer.name', changes.importerName);
    apply('importer.country', changes.importerCountry);
    apply('vessel.name', changes.vesselName);
    apply('vessel.imo', changes.vesselImo);
    apply('vessel.voyage', changes.vesselVoyage);
    apply('origin.port', changes.originPort);
    apply('origin.name', changes.originName);
    apply('destination.port', changes.destinationPort);
    apply('destination.name', changes.destinationName);
    apply('commodity.description', changes.commodityDescription);
    apply('commodity.hsCode', changes.hsCode);
    apply('quantity.value', changes.quantityValue);
    apply('quantity.unit', changes.quantityUnit);
    apply('declaredValue.amount', changes.declaredAmount);
    apply('declaredValue.currency', changes.declaredCurrency);

    if (!Object.keys(after).length) {
      throw badRequest('Nothing to amend — the submitted values match the current record.');
    }

    c.amendments.push({ at, by: actor.id, before, after, reason: changes.reason || null });
    c.recordHash = computeRecordHash(c);
    return c;
  });
}

/** Records a status change. The single path by which a consignment advances. */
async function setStatus(actor, consignmentId, status, remark) {
  const at = now(actor);
  return transaction((db) => {
    const c = db.consignments.find((x) => x.consignmentId === consignmentId);
    if (!c) throw notFound(`No consignment with reference ${consignmentId}`);

    const flow = canTransition(c.status, status, c.heldFrom);
    if (!flow.ok) throw conflict('invalid_transition', flow.reason, { currentStatus: c.status });

    const rights = canActorSet(actor, c, status);
    if (!rights.ok) throw forbidden(rights.reason, { currentStatus: c.status });

    const previous = c.status;

    // Dispatch issues the bill of lading; clearance files the customs entry.
    if (status === 'dispatched' && !c.billOfLading) {
      c.billOfLading = billOfLading(c.origin.name, c.consignmentId);
    }
    if (status === 'customs_cleared' && !c.customsEntryNo) {
      c.customsEntryNo = customsEntry(c.destination.port, c.consignmentId);
    }

    // Remember both WHERE it was held from and WHO held it: heldFrom is the bookmark the
    // lifecycle resumes at, heldBy is the officer entitled to lift the hold.
    c.heldFrom = status === HELD ? previous : null;
    c.heldBy = status === HELD ? actor.id : null;
    c.status = status;
    c.statusSetBy = actor.id;
    c.statusSetAt = at;
    c.movements.push({
      at, status, from: previous,
      loc: actor.role === 'officer' ? actor.station : `${actor.name}`,
      officer: actor.id,
      remark: remark || LABELS[status]
    });

    if (status === 'customs_cleared') {
      c.entries.push({
        entryNo: c.customsEntryNo, filedAt: at, office: actor.station, officer: actor.id,
        type: 'Entry summary declaration', outcome: 'Accepted — released'
      });
    }

    c.recordHash = computeRecordHash(c);
    return c;
  });
}

module.exports = { register, amend, setStatus, isClosed, CANCELLED };
