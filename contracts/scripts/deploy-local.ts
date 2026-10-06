import { network } from "hardhat";

const { ethers } = await network.connect();

const [importer, exporter, attestor1, attestor2, attestor3, arbitrator, feeRecipient] =
  await ethers.getSigners();

console.log("Importer:      ", importer.address);
console.log("Exporter:      ", exporter.address);
console.log("Attestor 1:    ", attestor1.address);
console.log("Attestor 2:    ", attestor2.address);
console.log("Attestor 3:    ", attestor3.address);
console.log("Arbitrator:    ", arbitrator.address);
console.log("Fee Recipient: ", feeRecipient.address);

const Escrow = await ethers.getContractFactory("Escrow");

const escrowAmount = ethers.parseEther("1");

const setupWindow = 60 * 60;              // 1 hour
const dispatchWindow = 24 * 60 * 60;      // 1 day
const clearanceWindow = 24 * 60 * 60;     // 1 day
const arbitrationWindow = 60 * 60;        // 1 hour

const escrow = await Escrow.deploy(
  exporter.address,
  escrowAmount,
  "SHP-88214",
  setupWindow,
  dispatchWindow,
  clearanceWindow,
  [
    attestor1.address,
    attestor2.address,
    attestor3.address,
  ],
  arbitrator.address,
  feeRecipient.address,
  arbitrationWindow
);

await escrow.waitForDeployment();

console.log("\nTrustLC Escrow deployed successfully!");
console.log("Contract address:", await escrow.getAddress());
console.log("Consignment ID: SHP-88214");
console.log("Escrow amount:  1 POL");