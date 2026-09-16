import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

const ONE_DAY = 24 * 60 * 60;
const SHIP_AMOUNT = ethers.parseEther("1");
const FEE = (SHIP_AMOUNT * 200n) / 10000n;
const FUND_VALUE = SHIP_AMOUNT + FEE;

async function deployFundedEscrow() {
  const [importer, exporter, a1, a2, a3, arbitrator, feeRecipient] =
    await ethers.getSigners();

  const escrow = await ethers.deployContract("Escrow", [
    exporter.address,
    SHIP_AMOUNT,
    "SHP-88214",
    ONE_DAY,        // setup window
    ONE_DAY * 30,   // dispatch window
    ONE_DAY * 60,   // clearance window
    [a1.address, a2.address, a3.address],
    arbitrator.address,
    feeRecipient.address,
  ]);

  await escrow.connect(exporter).accept();
  await escrow.connect(importer).deposit({ value: FUND_VALUE });

  return {
    escrow,
    importer,
    exporter,
    a1,
    a2,
    a3,
    arbitrator,
    feeRecipient,
  };
}

const RECORD_HASH = ethers.keccak256(
  ethers.toUtf8Bytes("SHP-88214-dispatched")
);

describe("Escrow — Disputes (Aleena)", function () {

  // ---------------------------------------------------------
  // checkTimeout()
  // ---------------------------------------------------------

  it("does not allow checkTimeout() before the escrow reaches Shipped", async function () {
    const { escrow } = await deployFundedEscrow();

    await expect(
      escrow.checkTimeout()
    ).to.be.revertedWith("Not shipped");
  });


  it("moves Shipped -> Disputed when clearance deadline passes", async function () {
    const { escrow, a1, a2 } = await deployFundedEscrow();

    // Funded -> Shipped using 2-of-3 attestation
    await escrow.connect(a1).attest(3, RECORD_HASH);
    await escrow.connect(a2).attest(3, RECORD_HASH);

    expect(await escrow.state()).to.equal(3n); // Shipped

    // Move blockchain time beyond clearanceDeadline
    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY * 60 + 1,
    ]);

    await ethers.provider.send("evm_mine");

    // Anyone can call checkTimeout()
    await expect(
      escrow.checkTimeout()
    ).to.emit(escrow, "EscrowDisputed");

    expect(await escrow.state()).to.equal(7n); // Disputed
  });


  it("does not allow checkTimeout() before clearance deadline", async function () {
    const { escrow, a1, a2 } = await deployFundedEscrow();

    // Funded -> Shipped
    await escrow.connect(a1).attest(3, RECORD_HASH);
    await escrow.connect(a2).attest(3, RECORD_HASH);

    expect(await escrow.state()).to.equal(3n); // Shipped

    // Deadline has NOT passed
    await expect(
      escrow.checkTimeout()
    ).to.be.revertedWith("Clearance deadline not passed");

    expect(await escrow.state()).to.equal(3n); // Still Shipped
  });


  // ---------------------------------------------------------
  // resolveDispute()
  // ---------------------------------------------------------

  it("does not allow a non-arbitrator to resolve a dispute", async function () {
    const { escrow, a1, a2, importer } = await deployFundedEscrow();

    // Funded -> Shipped
    await escrow.connect(a1).attest(3, RECORD_HASH);
    await escrow.connect(a2).attest(3, RECORD_HASH);

    // Move beyond clearance deadline
    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY * 60 + 1,
    ]);

    await ethers.provider.send("evm_mine");

    // Shipped -> Disputed
    await escrow.checkTimeout();

    expect(await escrow.state()).to.equal(7n); // Disputed

    // Importer is NOT the arbitrator
    await expect(
      escrow.connect(importer).resolveDispute(true)
    ).to.be.revertedWith("Only arbitrator");
  });


  it("does not allow resolveDispute() when state is not Disputed", async function () {
    const { escrow, arbitrator } = await deployFundedEscrow();

    // Current state is Funded
    expect(await escrow.state()).to.equal(2n);

    await expect(
      escrow.connect(arbitrator).resolveDispute(true)
    ).to.be.revertedWith("Not disputed");
  });


  it("arbitrator can resolve dispute in favor of exporter", async function () {
    const { escrow, a1, a2, arbitrator, exporter } =
      await deployFundedEscrow();

    // Funded -> Shipped
    await escrow.connect(a1).attest(3, RECORD_HASH);
    await escrow.connect(a2).attest(3, RECORD_HASH);

    expect(await escrow.state()).to.equal(3n); // Shipped

    // Pass clearance deadline
    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY * 60 + 1,
    ]);

    await ethers.provider.send("evm_mine");

    // Shipped -> Disputed
    await escrow.checkTimeout();

    expect(await escrow.state()).to.equal(7n); // Disputed

    // Arbitrator decides exporter should receive the money
    await expect(
      escrow.connect(arbitrator).resolveDispute(true)
    )
      .to.emit(escrow, "DisputeResolved")
      .withArgs(5n); // Released

    expect(await escrow.state()).to.equal(5n); // Released
  });


  it("arbitrator can resolve dispute in favor of importer", async function () {
    const { escrow, a1, a2, arbitrator } =
      await deployFundedEscrow();

    // Funded -> Shipped
    await escrow.connect(a1).attest(3, RECORD_HASH);
    await escrow.connect(a2).attest(3, RECORD_HASH);

    expect(await escrow.state()).to.equal(3n); // Shipped

    // Pass clearance deadline
    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY * 60 + 1,
    ]);

    await ethers.provider.send("evm_mine");

    // Shipped -> Disputed
    await escrow.checkTimeout();

    expect(await escrow.state()).to.equal(7n); // Disputed

    // Arbitrator decides importer should receive refund
    await expect(
      escrow.connect(arbitrator).resolveDispute(false)
    )
      .to.emit(escrow, "DisputeResolved")
      .withArgs(6n); // Refunded

    expect(await escrow.state()).to.equal(6n); // Refunded
  });


  it("emits EscrowReleased when arbitrator releases funds to exporter", async function () {
    const { escrow, a1, a2, arbitrator, exporter } =
      await deployFundedEscrow();

    await escrow.connect(a1).attest(3, RECORD_HASH);
    await escrow.connect(a2).attest(3, RECORD_HASH);

    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY * 60 + 1,
    ]);

    await ethers.provider.send("evm_mine");

    await escrow.checkTimeout();

    await expect(
      escrow.connect(arbitrator).resolveDispute(true)
    )
      .to.emit(escrow, "EscrowReleased")
      .withArgs(exporter.address, SHIP_AMOUNT);
  });


  it("emits EscrowRefunded when arbitrator refunds importer", async function () {
    const { escrow, a1, a2, arbitrator, importer } =
      await deployFundedEscrow();

    await escrow.connect(a1).attest(3, RECORD_HASH);
    await escrow.connect(a2).attest(3, RECORD_HASH);

    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY * 60 + 1,
    ]);

    await ethers.provider.send("evm_mine");

    await escrow.checkTimeout();

    await expect(
      escrow.connect(arbitrator).resolveDispute(false)
    )
      .to.emit(escrow, "EscrowRefunded")
      .withArgs(importer.address, SHIP_AMOUNT);
  });

});