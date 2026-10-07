// DEV ONLY. Fast-forwards the local Hardhat node's clock so you can demo
// deadlines (dispatch refund, clearance timeout, arbitration backstop)
// without waiting. It only works against a local Hardhat node; a real
// network (Amoy, mainnet) does not offer these methods.
//
// Usage (from the contracts folder, with `npx hardhat node` running):
//   node scripts/skip-time.mjs 90        -> jump forward 90 minutes
//   node scripts/skip-time.mjs 2d        -> jump forward 2 days
//   node scripts/skip-time.mjs 3h        -> jump forward 3 hours
// Units: m = minutes (default), h = hours, d = days.

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";

function parse(arg) {
  const m = /^(\d+)([mhd]?)$/.exec(arg ?? "");
  if (!m) {
    console.error('Give an amount like "90", "3h" or "2d".');
    process.exit(1);
  }
  const unit = { m: 60, h: 3600, d: 86400 }[m[2] || "m"];
  return Number(m[1]) * unit;
}

async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

const seconds = parse(process.argv[2]);

try {
  const chain = Number(await rpc("eth_chainId"));
  if (chain !== 31337) {
    console.error(`Refusing: chain id ${chain} is not a local Hardhat node (31337).`);
    process.exit(1);
  }
  await rpc("evm_increaseTime", [seconds]);
  await rpc("evm_mine");
  const block = await rpc("eth_getBlockByNumber", ["latest", false]);
  const when = new Date(Number(block.timestamp) * 1000);
  console.log(`Skipped ${seconds}s. Chain time is now ${when.toLocaleString()}.`);
} catch (e) {
  console.error("Could not reach the local node. Is `npx hardhat node` running?");
  console.error(String(e.message ?? e));
  process.exit(1);
}
