// Builds the public consignment record -- THE FROZEN CONTRACT.
// PORTAL_SPEC.md section 2 defines this shape; section 4 explains why it must not vary
// between requests. Read both before touching this file.

const crypto = require('crypto');
const { STATUS_CODES } = require('./statuses');

/**
 * The record, minus its own hash, in the exact key order of the spec.
 *
 * Built from an explicit literal on purpose. Spreading the stored object would let key
 * order drift as records are edited over time, changing the response bytes without
 * changing any value -- and byte drift is what breaks attestor agreement.
 */
function unhashedRecord(c) {
  return {
    consignmentId: c.consignmentId,
    lcRef: c.lcRef,
    status: c.status,
    statusCode: STATUS_CODES[c.status],
    billOfLading: c.billOfLading,
    exporter: { name: c.exporter.name, country: c.exporter.country },
    importer: { name: c.importer.name, country: c.importer.country },
    vessel: { name: c.vessel.name, imo: c.vessel.imo, voyage: c.vessel.voyage },
    origin: { port: c.origin.port, name: c.origin.name },
    destination: { port: c.destination.port, name: c.destination.name },
    commodity: { description: c.commodity.description, hsCode: c.commodity.hsCode },
    quantity: { value: c.quantity.value, unit: c.quantity.unit },
    declaredValue: { amount: c.declaredValue.amount, currency: c.declaredValue.currency },
    customsEntryNo: c.customsEntryNo,
    statusSetBy: c.statusSetBy,
    statusSetAt: c.statusSetAt
  };
}

/**
 * SHA-256 over the compact JSON of the record above, in spec key order. Deterministic:
 * the same record hashes identically on any machine at any time, so a verifier can
 * recompute it from a proof. Recomputed when the record CHANGES -- never per request.
 */
function computeRecordHash(c) {
  return '0x' + crypto.createHash('sha256')
    .update(JSON.stringify(unhashedRecord(c)), 'utf8').digest('hex');
}

/** The full public record, exactly as the attestation endpoint serves it. */
const publicRecord = (c) => ({ ...unhashedRecord(c), recordHash: c.recordHash });

/** Short form for listings and search results. Not an attestation target. */
const summaryRecord = (c) => ({
  consignmentId: c.consignmentId,
  lcRef: c.lcRef,
  status: c.status,
  statusCode: STATUS_CODES[c.status],
  exporter: { name: c.exporter.name },
  origin: { port: c.origin.port, name: c.origin.name },
  destination: { port: c.destination.port, name: c.destination.name },
  commodity: { description: c.commodity.description, hsCode: c.commodity.hsCode },
  declaredValue: { amount: c.declaredValue.amount, currency: c.declaredValue.currency },
  statusSetAt: c.statusSetAt
});

module.exports = { unhashedRecord, computeRecordHash, publicRecord, summaryRecord };
