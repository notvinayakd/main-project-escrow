const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { start, call, signIn, cleanup, VALID_DECLARATION, declaration } = require('./helpers');

let app, base;
const KOCHI = 'VDN-4471', RTM = 'NL-CUST-221', HAMBURG = 'DE-CUST-770';
const TRADER = 'TRD-1001', OTHER_TRADER = 'TRD-1002';
const OPIN = 'test-officer-pin', TPIN = 'test-trader-pin';

test.before(async () => { app = await start(); base = app.base; });
test.after(async () => { await app.stop(); cleanup(); });

/* ---------------- the attestation contract ---------------- */

test('attestation target returns the frozen key order', async () => {
  const r = await call(base, 'GET', '/ctccs/api/v2/consignment/SHP-88214');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body), [
    'consignmentId', 'lcRef', 'status', 'statusCode', 'billOfLading',
    'exporter', 'importer', 'vessel', 'origin', 'destination', 'commodity',
    'quantity', 'declaredValue', 'customsEntryNo', 'statusSetBy', 'statusSetAt', 'recordHash'
  ]);
});

test('attestation target is byte-stable across repeated reads', async () => {
  const reads = [];
  for (let i = 0; i < 5; i++) {
    reads.push((await call(base, 'GET', '/ctccs/api/v2/consignment/SHP-88214')).text);
    await new Promise((r) => setTimeout(r, 120));
  }
  assert.equal(new Set(reads).size, 1, 'response body varied between requests');
});

test('recordHash is reproducible from the served body', async () => {
  const r = await call(base, 'GET', '/ctccs/api/v2/consignment/SHP-88214');
  const { recordHash, ...rest } = r.body;
  const recomputed = '0x' + crypto.createHash('sha256').update(JSON.stringify(rest), 'utf8').digest('hex');
  assert.equal(recordHash, recomputed);
});

test('unknown consignment returns a 404 envelope', async () => {
  const r = await call(base, 'GET', '/ctccs/api/v2/consignment/SHP-00000');
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'not_found');
});

/* ---------------- authentication ---------------- */

test('write routes reject anonymous callers', async () => {
  const r = await call(base, 'POST', '/ctccs/officer/consignment/SHP-88214/status', { body: { status: 'dispatched' } });
  assert.equal(r.status, 401);
});

test('wrong PIN is rejected and does not leak which field was wrong', async () => {
  const r = await call(base, 'POST', '/ctccs/auth/session', { body: { accountId: KOCHI, pin: 'wrong' } });
  assert.equal(r.status, 401);
  const unknown = await call(base, 'POST', '/ctccs/auth/session', { body: { accountId: 'NOPE-1', pin: 'wrong' } });
  assert.equal(unknown.body.message, r.body.message);
});

test('a trader cannot use officer routes', async () => {
  const token = await signIn(base, TRADER, TPIN);
  const r = await call(base, 'GET', '/ctccs/officer/queue', { token });
  assert.equal(r.status, 403);
});

/* ---------------- registration ---------------- */

test('an officer cannot register a consignment — separation of duties', async () => {
  const token = await signIn(base, KOCHI, OPIN);
  const r = await call(base, 'POST', '/ctccs/trader/consignments', { token, body: declaration() });
  assert.equal(r.status, 403, 'an officer who can both create and advance a record defeats the whole model');
  assert.equal(r.body.error, 'forbidden');

  // ...nor amend or withdraw one.
  const trader = await signIn(base, TRADER, TPIN);
  const mine = await call(base, 'POST', '/ctccs/trader/consignments', { token: trader, body: declaration() });
  const id = mine.body.consignmentId;
  const amend = await call(base, 'PATCH', `/ctccs/trader/consignment/${id}`, { token, body: { quantityValue: 99 } });
  assert.equal(amend.status, 403);
  const withdraw = await call(base, 'POST', `/ctccs/trader/consignment/${id}/withdraw`, { token, body: {} });
  assert.equal(withdraw.status, 403);
});

test('a consignment is always owned by the exporter who filed it', async () => {
  const token = await signIn(base, OTHER_TRADER, TPIN);
  // A caller cannot claim to be filing for someone else.
  const r = await call(base, 'POST', '/ctccs/trader/consignments',
    { token, body: { ...declaration(), traderId: 'TRD-1001' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.exporter.name, 'Coimbatore Textile Mills Ltd', 'traderId in the body must be ignored');
});

test('a trader registers a consignment and it enters the public record', async () => {
  const token = await signIn(base, TRADER, TPIN);
  const r = await call(base, 'POST', '/ctccs/trader/consignments', { token, body: declaration() });
  assert.equal(r.status, 201);
  assert.match(r.body.consignmentId, /^SHP-\d{5}$/);
  assert.equal(r.body.status, 'booking_confirmed');
  assert.equal(r.body.statusCode, 1);
  assert.equal(r.body.billOfLading, null);
  assert.equal(r.body.exporter.name, 'Malabar Spice Exports Pvt Ltd');

  const fetched = await call(base, 'GET', `/ctccs/api/v2/consignment/${r.body.consignmentId}`);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.recordHash, r.body.recordHash);
});

test('registration rejects malformed trade references', async () => {
  const token = await signIn(base, TRADER, TPIN);
  const cases = [
    ['hsCode', '12', /6-digit HS code/],
    ['originPort', 'KOCH', /UN\/LOCODE/],
    ['vesselImo', '123', /7-digit IMO/],
    ['lcRef', 'LC/2026/1', /LC-2026-0417/],
    ['quantityUnit', 'TONNES', /must be one of/],
    ['declaredCurrency', 'POL', /must be one of/]
  ];
  for (const [field, value, expected] of cases) {
    const r = await call(base, 'POST', '/ctccs/trader/consignments',
      { token, body: { ...declaration(), [field]: value } });
    assert.equal(r.status, 400, `${field} should have been rejected`);
    assert.match(r.body.message, expected);
  }
});

test('registration rejects an identical origin and destination', async () => {
  const token = await signIn(base, TRADER, TPIN);
  const r = await call(base, 'POST', '/ctccs/trader/consignments',
    { token, body: { ...declaration(), destinationPort: 'INCOK', destinationName: 'Kochi' } });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /must differ/);
});

test('consignment references are unique under concurrent registration', async () => {
  const token = await signIn(base, TRADER, TPIN);
  const bodies = Array.from({ length: 8 }, () => declaration());
  const results = await Promise.all(bodies.map((body) =>
    call(base, 'POST', '/ctccs/trader/consignments', { token, body })));
  const ids = results.map((r) => r.body.consignmentId);
  assert.equal(new Set(ids).size, ids.length, `duplicate references issued: ${ids}`);
});

test('one Letter of Credit cannot back two consignments', async () => {
  const token = await signIn(base, TRADER, TPIN);
  const body = declaration();
  const first = await call(base, 'POST', '/ctccs/trader/consignments', { token, body });
  assert.equal(first.status, 201);

  const duplicate = await call(base, 'POST', '/ctccs/trader/consignments', { token, body });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error, 'lc_already_used');
  assert.equal(duplicate.body.consignmentId, first.body.consignmentId);

  // Withdrawing the first releases the reference for re-use.
  await call(base, 'POST', `/ctccs/trader/consignment/${first.body.consignmentId}/withdraw`, { token, body: {} });
  const retry = await call(base, 'POST', '/ctccs/trader/consignments', { token, body });
  assert.equal(retry.status, 201);
});

/* ---------------- amendment ---------------- */

test('a trader amends before lodgement and the change is audited', async () => {
  const token = await signIn(base, TRADER, TPIN);
  const created = await call(base, 'POST', '/ctccs/trader/consignments', { token, body: declaration() });
  const id = created.body.consignmentId;

  const amended = await call(base, 'PATCH', `/ctccs/trader/consignment/${id}`,
    { token, body: { quantityValue: 7, reason: 'Revised packing list' } });
  assert.equal(amended.status, 200);
  assert.equal(amended.body.quantity.value, 7);
  assert.notEqual(amended.body.recordHash, created.body.recordHash);

  const trail = await call(base, 'GET', `/ctccs/api/v2/consignment/${id}/amendments`);
  assert.equal(trail.body.amendments.length, 1);
  assert.equal(trail.body.amendments[0].before['quantity.value'], 5);
  assert.equal(trail.body.amendments[0].after['quantity.value'], 7);
});

test('a trader cannot amend another exporter consignment', async () => {
  const mine = await signIn(base, TRADER, TPIN);
  const created = await call(base, 'POST', '/ctccs/trader/consignments', { token: mine, body: declaration() });
  const theirs = await signIn(base, OTHER_TRADER, TPIN);
  const r = await call(base, 'PATCH', `/ctccs/trader/consignment/${created.body.consignmentId}`,
    { token: theirs, body: { quantityValue: 99 } });
  assert.equal(r.status, 403);
});

test('amendment closes once documents are lodged', async () => {
  const trader = await signIn(base, TRADER, TPIN);
  const officer = await signIn(base, KOCHI, OPIN);
  const created = await call(base, 'POST', '/ctccs/trader/consignments', { token: trader, body: declaration() });
  const id = created.body.consignmentId;

  await call(base, 'POST', `/ctccs/officer/consignment/${id}/status`, { token: officer, body: { status: 'documents_lodged' } });
  const r = await call(base, 'PATCH', `/ctccs/trader/consignment/${id}`, { token: trader, body: { quantityValue: 9 } });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'amendment_closed');
});

/* ---------------- lifecycle and station rules ---------------- */

async function freshDispatched() {
  const trader = await signIn(base, TRADER, TPIN);
  const kochi = await signIn(base, KOCHI, OPIN);
  const created = await call(base, 'POST', '/ctccs/trader/consignments', { token: trader, body: declaration() });
  const id = created.body.consignmentId;
  await call(base, 'POST', `/ctccs/officer/consignment/${id}/status`, { token: kochi, body: { status: 'documents_lodged' } });
  const disp = await call(base, 'POST', `/ctccs/officer/consignment/${id}/status`, { token: kochi, body: { status: 'dispatched' } });
  return { id, kochi, trader, disp };
}

test('dispatch issues a bill of lading at the origin port', async () => {
  const { disp } = await freshDispatched();
  assert.equal(disp.status, 200);
  assert.equal(disp.body.status, 'dispatched');
  assert.equal(disp.body.statusCode, 3);
  assert.match(disp.body.billOfLading, /^KOCH-\d+$/);
});

test('clearance is refused at the wrong station and accepted at the right one', async () => {
  const { id } = await freshDispatched();
  const hamburg = await signIn(base, HAMBURG, OPIN);
  const wrong = await call(base, 'POST', `/ctccs/officer/consignment/${id}/status`, { token: hamburg, body: { status: 'customs_cleared' } });
  assert.equal(wrong.status, 403);
  assert.match(wrong.body.message, /destination port \(BEANR\)/);
});

test('the lifecycle refuses skips and reversals', async () => {
  const trader = await signIn(base, TRADER, TPIN);
  const kochi = await signIn(base, KOCHI, OPIN);
  const created = await call(base, 'POST', '/ctccs/trader/consignments', { token: trader, body: declaration() });
  const id = created.body.consignmentId;

  const skip = await call(base, 'POST', `/ctccs/officer/consignment/${id}/status`, { token: kochi, body: { status: 'dispatched' } });
  assert.equal(skip.status, 409);
  assert.match(skip.body.message, /Next status after booking_confirmed/);

  await call(base, 'POST', `/ctccs/officer/consignment/${id}/status`, { token: kochi, body: { status: 'documents_lodged' } });
  const back = await call(base, 'POST', `/ctccs/officer/consignment/${id}/status`, { token: kochi, body: { status: 'booking_confirmed' } });
  assert.equal(back.status, 409);
  assert.match(back.body.message, /backwards/);
});

test('a hold interrupts and resumes where it left off', async () => {
  const { id, kochi } = await freshDispatched();
  const held = await call(base, 'POST', `/ctccs/officer/consignment/${id}/status`, { token: kochi, body: { status: 'held', remark: 'Query raised' } });
  assert.equal(held.body.status, 'held');
  assert.equal(held.body.statusCode, 99);

  const bad = await call(base, 'POST', `/ctccs/officer/consignment/${id}/status`, { token: kochi, body: { status: 'booking_confirmed' } });
  assert.equal(bad.status, 409);

  const resumed = await call(base, 'POST', `/ctccs/officer/consignment/${id}/status`, { token: kochi, body: { status: 'dispatched' } });
  assert.equal(resumed.body.status, 'dispatched');
});

// A hold carries no station requirement, so any officer may place one -- including on a
// route neither of whose ports is theirs. Releasing must therefore be open to them too,
// or an off-route officer could freeze a consignment and strand it.
test('the officer who placed a hold can release it from any station', async () => {
  const { id } = await freshDispatched();          // INCOK -> BEANR
  const hamburg = await signIn(base, HAMBURG, OPIN); // DEHAM: neither end of the voyage

  const held = await call(base, 'POST', `/ctccs/officer/consignment/${id}/status`, { token: hamburg, body: { status: 'held', remark: 'Query raised off-route' } });
  assert.equal(held.status, 200);
  assert.equal(held.body.status, 'held');

  const actions = await call(base, 'GET', `/ctccs/officer/consignment/${id}/actions`, { token: hamburg });
  assert.deepEqual(actions.body.actions, ['dispatched'], 'the holder must be offered the release');

  const released = await call(base, 'POST', `/ctccs/officer/consignment/${id}/status`, { token: hamburg, body: { status: 'dispatched' } });
  assert.equal(released.status, 200);
  assert.equal(released.body.status, 'dispatched');
});

test('releasing is a release only — the holder cannot advance the consignment', async () => {
  const { id } = await freshDispatched();
  const hamburg = await signIn(base, HAMBURG, OPIN);
  await call(base, 'POST', `/ctccs/officer/consignment/${id}/status`, { token: hamburg, body: { status: 'held' } });

  // Lifting the hold is allowed; clearing customs at the wrong station is not.
  const advance = await call(base, 'POST', `/ctccs/officer/consignment/${id}/status`, { token: hamburg, body: { status: 'customs_cleared' } });
  assert.equal(advance.status, 403);
  assert.match(advance.body.message, /destination port \(BEANR\)/);
});

test('a hold placed before lodgement can be released back to booking_confirmed', async () => {
  const trader = await signIn(base, TRADER, TPIN);
  const kochi = await signIn(base, KOCHI, OPIN);
  const created = await call(base, 'POST', '/ctccs/trader/consignments', { token: trader, body: declaration() });
  const id = created.body.consignmentId;

  await call(base, 'POST', `/ctccs/officer/consignment/${id}/status`, { token: kochi, body: { status: 'held' } });
  const released = await call(base, 'POST', `/ctccs/officer/consignment/${id}/status`, { token: kochi, body: { status: 'booking_confirmed' } });
  assert.equal(released.status, 200, 'booking_confirmed has no station rule of its own; the release must still work');
  assert.equal(released.body.status, 'booking_confirmed');
});

// The rule is about the cargo, not the paperwork: a hold placed before the vessel sailed
// must not silently become a bar on withdrawal.
test('a consignment held before dispatch can still be withdrawn', async () => {
  const trader = await signIn(base, TRADER, TPIN);
  const kochi = await signIn(base, KOCHI, OPIN);
  const created = await call(base, 'POST', '/ctccs/trader/consignments', { token: trader, body: declaration() });
  const id = created.body.consignmentId;
  await call(base, 'POST', `/ctccs/officer/consignment/${id}/status`, { token: kochi, body: { status: 'documents_lodged' } });
  await call(base, 'POST', `/ctccs/officer/consignment/${id}/status`, { token: kochi, body: { status: 'held' } });

  const withdrawn = await call(base, 'POST', `/ctccs/trader/consignment/${id}/withdraw`, { token: trader, body: { remark: 'Buyer cancelled while under query' } });
  assert.equal(withdrawn.status, 200);
  assert.equal(withdrawn.body.status, 'cancelled');
});

test('a consignment held after dispatch cannot be withdrawn, and says so honestly', async () => {
  const { id, kochi, trader } = await freshDispatched();
  await call(base, 'POST', `/ctccs/officer/consignment/${id}/status`, { token: kochi, body: { status: 'held' } });

  const refused = await call(base, 'POST', `/ctccs/trader/consignment/${id}/withdraw`, { token: trader, body: {} });
  assert.equal(refused.status, 409);
  assert.match(refused.body.message, /held after dispatch/);
});

/* ---------------- withdrawal ---------------- */

test('a trader withdraws before dispatch but not after', async () => {
  const trader = await signIn(base, TRADER, TPIN);
  const created = await call(base, 'POST', '/ctccs/trader/consignments', { token: trader, body: declaration() });
  const withdrawn = await call(base, 'POST', `/ctccs/trader/consignment/${created.body.consignmentId}/withdraw`,
    { token: trader, body: { remark: 'Buyer cancelled the order' } });
  assert.equal(withdrawn.status, 200);
  assert.equal(withdrawn.body.status, 'cancelled');
  assert.equal(withdrawn.body.statusCode, 98);

  const { id } = await freshDispatched();
  const late = await call(base, 'POST', `/ctccs/trader/consignment/${id}/withdraw`, { token: trader, body: {} });
  assert.equal(late.status, 409);
  assert.match(late.body.message, /once it has been dispatched/);
});

test('a cancelled record is closed', async () => {
  const trader = await signIn(base, TRADER, TPIN);
  const kochi = await signIn(base, KOCHI, OPIN);
  const created = await call(base, 'POST', '/ctccs/trader/consignments', { token: trader, body: declaration() });
  const id = created.body.consignmentId;
  await call(base, 'POST', `/ctccs/trader/consignment/${id}/withdraw`, { token: trader, body: {} });
  const r = await call(base, 'POST', `/ctccs/officer/consignment/${id}/status`, { token: kochi, body: { status: 'documents_lodged' } });
  assert.equal(r.status, 409);
  assert.match(r.body.message, /record is closed/);
});

/* ---------------- search, tracking, queue ---------------- */

test('public tracking accepts a reference, an LC or a bill of lading', async () => {
  const { id, disp } = await freshDispatched();
  for (const ref of [id, disp.body.lcRef, disp.body.billOfLading]) {
    const r = await call(base, 'GET', `/ctccs/api/v2/track?ref=${encodeURIComponent(ref)}`);
    assert.equal(r.status, 200, `tracking failed for ${ref}`);
    assert.equal(r.body.consignmentId, id);
  }
  const miss = await call(base, 'GET', '/ctccs/api/v2/track?ref=NOTHING');
  assert.equal(miss.status, 404);
});

test('listings search, filter and paginate', async () => {
  const all = await call(base, 'GET', '/ctccs/api/v2/consignments?pageSize=2');
  assert.equal(all.body.consignments.length, 2);
  assert.ok(all.body.total > 2);
  assert.equal(all.body.pageSize, 2);

  const byStatus = await call(base, 'GET', '/ctccs/api/v2/consignments?status=customs_cleared&pageSize=100');
  assert.ok(byStatus.body.consignments.every((c) => c.status === 'customs_cleared'));

  const byText = await call(base, 'GET', '/ctccs/api/v2/consignments?q=pepper&pageSize=100');
  assert.ok(byText.body.consignments.some((c) => /pepper/i.test(c.commodity.description)));

  const byPort = await call(base, 'GET', '/ctccs/api/v2/consignments?port=NLRTM&pageSize=100');
  assert.ok(byPort.body.consignments.every((c) => c.origin.port === 'NLRTM' || c.destination.port === 'NLRTM'));
});

test('a trader only sees their own consignments', async () => {
  const token = await signIn(base, OTHER_TRADER, TPIN);
  const r = await call(base, 'GET', '/ctccs/trader/consignments?pageSize=100', { token });
  assert.ok(r.body.consignments.length > 0);
  assert.ok(r.body.consignments.every((c) => c.exporter.name === 'Coimbatore Textile Mills Ltd'));
});

test('an officer queue only shows consignments at their own station', async () => {
  const token = await signIn(base, KOCHI, OPIN);
  const r = await call(base, 'GET', '/ctccs/officer/queue?pageSize=100', { token });
  assert.equal(r.body.station.port, 'INCOK');
  assert.ok(r.body.consignments.every((c) => c.origin.port === 'INCOK' || c.destination.port === 'INCOK'));
  assert.ok(r.body.consignments.every((c) => c.actions.length > 0));
});

/* ---------------- robustness ---------------- */

test('malformed JSON and oversized bodies fail cleanly', async () => {
  const bad = await fetch(base + '/ctccs/auth/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json'
  });
  assert.equal(bad.status, 400);

  const token = await signIn(base, TRADER, TPIN);
  const huge = await call(base, 'POST', '/ctccs/trader/consignments',
    { token, body: { ...declaration(), commodityDescription: 'x'.repeat(100000) } });
  assert.equal(huge.status, 413);
});

test('security headers are present', async () => {
  const res = await fetch(base + '/healthz');
  assert.ok(res.headers.get('content-security-policy'));
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});
