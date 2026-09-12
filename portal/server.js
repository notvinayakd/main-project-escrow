// National Trade Documentation Gateway (NTG)
// Consignment Tracking & Customs Clearance System (CTCCS) v2.4.1
//
// A mock government portal built for the TrustLC capstone (CSD415). It is the real-world
// data source the zkTLS attestation layer proves against: an attestor makes a genuine
// HTTPS request to /ctccs/api/v2/consignment/:id, TLSNotary witnesses the reply, and the
// escrow contract advances on the strength of that proof rather than on anyone's word.
//
// PORTAL_SPEC.md is the contract. Read it before changing any response body.

const { createApp } = require('./app');
const { config, validate } = require('./config');

const { problems, warnings } = validate();
for (const w of warnings) console.warn(`[config] WARNING: ${w}`);
if (problems.length) {
  console.error('[config] refusing to start:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const server = createApp().listen(config.port, () => {
  console.log(`NTG · CTCCS v2.4.1 (${config.env}) listening on http://localhost:${config.port}`);
  console.log(`  Portal:             http://localhost:${config.port}/`);
  console.log(`  Attestation target: http://localhost:${config.port}/ctccs/api/v2/consignment/SHP-88214`);
});

// Render sends SIGTERM on redeploy. Finish in-flight requests rather than cutting them off.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`[ctccs] ${signal} received, shutting down.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
