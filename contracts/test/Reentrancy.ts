import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

const ONE_DAY = 24 * 60 * 60;

const AMOUNT = ethers.parseEther("1");
const FEE = (AMOUNT * 200n) / 10000n;
const REQUIRED_STAKE = ethers.parseEther("1");
const ARBITRATOR_FEE = (AMOUNT * 200n) / 10000n;

const RECORD_HASH = ethers.keccak256(
  ethers.toUtf8Bytes("SHP-REENTRANCY-held"),
);

// Escrow whose ARBITRATOR is a malicious contract, already in Disputed.
async function deployDisputedWithAttacker() {
  const [importer, exporter, a1, a2, a3, feeRecipient] =
    await ethers.getSigners();

  const attacker = await ethers.deployContract("ReentrantArbitrator");

  const escrow = await ethers.deployContract("Escrow", [
    exporter.address,
    AMOUNT,
    "SHP-REENTRANCY",
    ONE_DAY,
    ONE_DAY * 30,
    ONE_DAY * 60,
    [a1.address, a2.address, a3.address],
    await attacker.getAddress(),
    feeRecipient.address,
    ONE_DAY,
  ]);

  await escrow.connect(exporter).accept();
  await escrow.connect(importer).deposit({ value: AMOUNT + FEE });

  for (const a of [a1, a2, a3]) {
    await escrow.connect(a).stakeAsAttestor({ value: REQUIRED_STAKE });
  }

  // Two attestors agree on code 99 (held): Funded -> Disputed.
  await escrow.connect(a1).attest(99, RECORD_HASH);
  await escrow.connect(a2).attest(99, RECORD_HASH);

  return { escrow, attacker, exporter, importer };
}

describe("Escrow — resolveDispute() reentrancy", function () {
  it("does not let a contract arbitrator be paid twice by re-entering (release)", async function () {
    const { escrow, attacker, exporter } = await deployDisputedWithAttacker();

    expect(await escrow.state()).to.equal(7n); // Disputed

    const escrowAddress = await escrow.getAddress();
    const attackerAddress = await attacker.getAddress();
    const exporterBefore = await ethers.provider.getBalance(exporter.address);

    await attacker.attack(escrowAddress, true);

    // The re-entry attempt happened and was rejected.
    expect(await attacker.reentries()).to.equal(0n);
    expect(await attacker.blockedReentries()).to.equal(1n);

    // The arbitrator was paid exactly one fee.
    expect(await ethers.provider.getBalance(attackerAddress)).to.equal(
      ARBITRATOR_FEE,
    );

    // The exporter received exactly the payout.
    const exporterAfter = await ethers.provider.getBalance(exporter.address);
    expect(exporterAfter - exporterBefore).to.equal(AMOUNT - ARBITRATOR_FEE);

    // Only the three attestor stakes are left in the contract.
    expect(await ethers.provider.getBalance(escrowAddress)).to.equal(
      REQUIRED_STAKE * 3n,
    );

    expect(await escrow.state()).to.equal(5n); // Released
  });

  it("does not let a contract arbitrator be paid twice by re-entering (refund)", async function () {
    const { escrow, attacker, importer } = await deployDisputedWithAttacker();

    const escrowAddress = await escrow.getAddress();
    const attackerAddress = await attacker.getAddress();
    const importerBefore = await ethers.provider.getBalance(importer.address);

    // `attack` is sent by the importer (first signer), so account for its gas.
    const tx = await attacker.attack(escrowAddress, false);
    const receipt = await tx.wait();
    const gasCost = receipt!.gasUsed * receipt!.gasPrice;

    expect(await attacker.reentries()).to.equal(0n);
    expect(await attacker.blockedReentries()).to.equal(1n);

    expect(await ethers.provider.getBalance(attackerAddress)).to.equal(
      ARBITRATOR_FEE,
    );

    const importerAfter = await ethers.provider.getBalance(importer.address);
    expect(importerAfter - importerBefore + gasCost).to.equal(
      AMOUNT - ARBITRATOR_FEE,
    );

    expect(await ethers.provider.getBalance(escrowAddress)).to.equal(
      REQUIRED_STAKE * 3n,
    );

    expect(await escrow.state()).to.equal(6n); // Refunded
  });
});
