// Canonical seed consignments. Kept in code so a wiped disk still boots demo-ready.
// SHP-88214 is the consignment the TrustLC demo prototype walks through -- keep it.

const SEED = [
  {
    consignmentId: 'SHP-88214',
    lcRef: 'LC-2026-0417',
    status: 'documents_lodged',
    billOfLading: null,
    traderId: 'TRD-1001',
    exporter: { name: 'Malabar Spice Exports Pvt Ltd', country: 'IN' },
    importer: { name: 'Rotterdam Commodity BV', country: 'NL' },
    vessel: { name: 'MV Anjali Star', imo: '9401235', voyage: 'AS-118W' },
    origin: { port: 'INCOK', name: 'Kochi' },
    destination: { port: 'NLRTM', name: 'Rotterdam' },
    commodity: { description: 'Black pepper', hsCode: '090411' },
    quantity: { value: 12, unit: 'MT' },
    declaredValue: { amount: 74160, currency: 'USD' },
    customsEntryNo: null,
    statusSetBy: 'VDN-4471',
    statusSetAt: '2026-08-16T11:40:00+05:30',
    heldFrom: null,
    heldBy: null,
    movements: [
      { at: '2026-08-14T09:12:00+05:30', status: 'booking_confirmed', loc: 'Kochi (INCOK)', officer: 'SYS',
        remark: 'Consignment booked against LC-2026-0417' },
      { at: '2026-08-16T11:40:00+05:30', status: 'documents_lodged', loc: 'Kochi Customs House', officer: 'VDN-4471',
        remark: 'Shipping bill and commercial invoice lodged; awaiting vessel departure' }
    ],
    entries: []
  },
  {
    consignmentId: 'SHP-90337',
    lcRef: 'LC-2026-0512',
    status: 'dispatched',
    billOfLading: 'CHEN-90337',
    traderId: 'TRD-1002',
    exporter: { name: 'Coimbatore Textile Mills Ltd', country: 'IN' },
    importer: { name: 'Hamburg Fabrics GmbH', country: 'DE' },
    vessel: { name: 'MV Chola Breeze', imo: '9512044', voyage: 'CB-207E' },
    origin: { port: 'INMAA', name: 'Chennai' },
    destination: { port: 'DEHAM', name: 'Hamburg' },
    commodity: { description: 'Cotton yarn, 32 count', hsCode: '520522' },
    quantity: { value: 24, unit: 'MT' },
    declaredValue: { amount: 76800, currency: 'USD' },
    customsEntryNo: null,
    statusSetBy: 'TN-CUST-3390',
    statusSetAt: '2026-08-24T16:35:00+05:30',
    heldFrom: null,
    heldBy: null,
    movements: [
      { at: '2026-08-20T10:02:00+05:30', status: 'booking_confirmed', loc: 'Chennai (INMAA)', officer: 'SYS',
        remark: 'Consignment booked against LC-2026-0512' },
      { at: '2026-08-22T09:15:00+05:30', status: 'documents_lodged', loc: 'Chennai Custom House', officer: 'TN-CUST-3390',
        remark: 'Shipping bill lodged; container stuffed under supervision' },
      { at: '2026-08-24T16:35:00+05:30', status: 'dispatched', loc: 'Chennai (INMAA)', officer: 'TN-CUST-3390',
        remark: 'MV Chola Breeze departed berth 2; B/L CHEN-90337 issued' }
    ],
    entries: []
  },
  {
    consignmentId: 'SHP-91002',
    lcRef: 'LC-2026-0488',
    status: 'customs_cleared',
    billOfLading: 'KAND-91002',
    traderId: 'TRD-1003',
    exporter: { name: 'Kandla Marine Foods', country: 'IN' },
    importer: { name: 'Singapore Seafood Traders Pte', country: 'SG' },
    vessel: { name: 'MV Gulf Mariner', imo: '9377881', voyage: 'GM-045S' },
    origin: { port: 'INIXY', name: 'Kandla' },
    destination: { port: 'SGSIN', name: 'Singapore' },
    commodity: { description: 'Frozen shrimp, -18C reefer', hsCode: '030617' },
    quantity: { value: 12, unit: 'MT' },
    declaredValue: { amount: 102000, currency: 'USD' },
    customsEntryNo: 'SG-ENS-2026-44120',
    statusSetBy: 'SG-CUST-118',
    statusSetAt: '2026-08-30T14:20:00+08:00',
    heldFrom: null,
    heldBy: null,
    movements: [
      { at: '2026-08-10T08:30:00+05:30', status: 'booking_confirmed', loc: 'Kandla (INIXY)', officer: 'SYS',
        remark: 'Consignment booked against LC-2026-0488' },
      { at: '2026-08-12T04:45:00+05:30', status: 'documents_lodged', loc: 'Kandla Custom House', officer: 'GJ-CUST-2210',
        remark: 'Shipping bill lodged; reefer temperature log attached' },
      { at: '2026-08-14T18:10:00+05:30', status: 'dispatched', loc: 'Kandla (INIXY)', officer: 'GJ-CUST-2210',
        remark: 'MV Gulf Mariner departed berth 9; B/L KAND-91002 issued' },
      { at: '2026-08-30T14:20:00+08:00', status: 'customs_cleared', loc: 'Singapore (SGSIN)', officer: 'SG-CUST-118',
        remark: 'Entry summary declaration accepted; goods released to consignee' }
    ],
    entries: [
      { entryNo: 'SG-ENS-2026-44120', filedAt: '2026-08-30T14:20:00+08:00', office: 'Singapore Customs',
        officer: 'SG-CUST-118', type: 'Entry summary declaration', outcome: 'Accepted — released' }
    ]
  }
];

module.exports = { SEED };
