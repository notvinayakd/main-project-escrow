// Wipes data/consignments.json back to the canonical seed. Run with: npm run seed
const { resetStore } = require('../lib/store');

const list = resetStore();
console.log(`Reset data/consignments.json to ${list.length} seed consignments:`);
for (const c of list) {
  console.log(`  ${c.consignmentId}  ${c.status.padEnd(18)} ${c.origin.port} -> ${c.destination.port}`);
}
