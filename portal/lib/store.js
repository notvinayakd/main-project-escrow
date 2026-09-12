// JSON-file store with two properties the first version lacked:
//
//   1. ATOMIC WRITES. Write to a temp file, fsync, then rename. A rename is atomic on
//      every mainstream filesystem, so a crash mid-write can never leave a half-written
//      file -- the old one simply survives.
//   2. SERIALISED MUTATIONS. Every change runs through one promise chain, so two officers
//      submitting at the same moment cannot read-modify-write over each other. Node is
//      single-threaded but `await` yields, which is exactly where a lost update hides.
//
// Still not a database, and deliberately so: on-chain state is TrustLC's source of truth.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { SEED } = require('../scripts/seed-data');
const { computeRecordHash } = require('./record');
const { config } = require('../config');

const DATA_FILE = config.dataFile;
const DATA_DIR = path.dirname(DATA_FILE);
const TMP_FILE = DATA_FILE + '.tmp';

function buildSeed() {
  const consignments = SEED.map((c) => {
    const copy = structuredClone(c);
    copy.recordHash = computeRecordHash(copy);
    return copy;
  });
  const highest = consignments.reduce(
    (max, c) => Math.max(max, Number(c.consignmentId.split('-')[1]) || 0), 0);
  return { nextConsignmentSeq: highest + 1, consignments };
}

function readSync() {
  if (!fs.existsSync(DATA_FILE)) {
    const seeded = buildSeed();
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(seeded, null, 2) + '\n', 'utf8');
    return seeded;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!parsed || !Array.isArray(parsed.consignments)) throw new Error('malformed');
    return parsed;
  } catch (err) {
    console.warn(`[store] ${path.basename(DATA_FILE)} unreadable (${err.message}) - reseeding.`);
    const seeded = buildSeed();
    fs.writeFileSync(DATA_FILE, JSON.stringify(seeded, null, 2) + '\n', 'utf8');
    return seeded;
  }
}

async function writeAtomic(db) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const handle = await fsp.open(TMP_FILE, 'w');
  try {
    await handle.writeFile(JSON.stringify(db, null, 2) + '\n', 'utf8');
    await handle.sync();               // flush to disk before the rename
  } finally {
    await handle.close();
  }
  await fsp.rename(TMP_FILE, DATA_FILE);
}

// One chain, so mutations queue rather than interleave.
let queue = Promise.resolve();

/**
 * Runs `mutator(db)` with exclusive access, persists the result atomically, and resolves
 * with whatever the mutator returned. Any throw leaves the stored file untouched.
 */
function transaction(mutator) {
  const run = queue.then(async () => {
    const db = readSync();
    const result = await mutator(db);
    await writeAtomic(db);
    return result;
  });
  // Keep the chain alive even when a caller's transaction rejects.
  queue = run.then(() => undefined, () => undefined);
  return run;
}

const readAll = () => readSync().consignments;

function findConsignment(id) {
  const wanted = String(id || '').trim().toUpperCase();
  return readAll().find((c) => c.consignmentId.toUpperCase() === wanted) || null;
}

/** Look up by consignment reference OR bill of lading -- what a public tracking box accepts. */
function findByReference(ref) {
  const wanted = String(ref || '').trim().toUpperCase();
  if (!wanted) return null;
  return readAll().find(
    (c) => c.consignmentId.toUpperCase() === wanted ||
           (c.billOfLading && c.billOfLading.toUpperCase() === wanted) ||
           c.lcRef.toUpperCase() === wanted) || null;
}

async function resetStore() {
  return transaction((db) => {
    const seeded = buildSeed();
    db.consignments = seeded.consignments;
    db.nextConsignmentSeq = seeded.nextConsignmentSeq;
    return db.consignments;
  });
}

module.exports = { transaction, readAll, findConsignment, findByReference, resetStore, DATA_FILE };
