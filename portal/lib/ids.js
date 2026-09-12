// Reference-number generation. Formats mirror the shapes real trade documents use, so the
// records read as authentic rather than as sequential test data.

/** SHP-88214 -- portal's own consignment reference, sequential from the store counter. */
const consignmentRef = (seq) => `SHP-${String(seq).padStart(5, '0')}`;

/** KOCH-88214 -- carrier's bill of lading, issued at dispatch from the origin port. */
const billOfLading = (originName, consignmentId) =>
  `${originName.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase()}-${consignmentId.split('-')[1]}`;

/** NL-ENS-2026-88214 -- destination entry summary declaration, filed at clearance. */
const customsEntry = (destinationPort, consignmentId, year = new Date().getFullYear()) =>
  `${destinationPort.slice(0, 2)}-ENS-${year}-${consignmentId.split('-')[1]}`;

module.exports = { consignmentRef, billOfLading, customsEntry };
