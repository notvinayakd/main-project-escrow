import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

const ONE_DAY = 24 * 60 * 60;
const SHIP_AMOUNT = ethers.parseEther("1"); // 1 POL shipment value
const FEE = (SHIP_AMOUNT * 200n) / 10000n;  // 2%, matches FEE_BPS in the contract
const FUND_VALUE = SHIP_AMOUNT + FEE;       // what deposit() actually requires

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
  // escrow is now State.Funded (2)

  return { escrow, importer, exporter, a1, a2, a3, arbitrator, feeRecipient };
}

const RECORD_HASH = ethers.keccak256(ethers.toUtf8Bytes("SHP-88214-dispatched"));
const RECORD_HASH_CLEARED = ethers.keccak256(ethers.toUtf8Bytes("SHP-88214-cleared"));

describe("Escrow — Attestation (attest())", function () {
  it("rejects a caller who isn't one of the 3 attestors", async function () {
    const { escrow, importer } = await deployFundedEscrow();

    await expect(
      escrow.connect(importer).attest(3, RECORD_HASH), // importer is not an attestor
    ).to.be.revertedWith("Only an attestor may attest");
  });

  it("rejects a statusCode that doesn't make sense for the current state", async function () {
    const { escrow, a1 } = await deployFundedEscrow();

    // state is Funded, so 4 (CustomsCleared) is not a valid claim yet
    await expect(
      escrow.connect(a1).attest(4, RECORD_HASH),
    ).to.be.revertedWith("Unexpected statusCode for Funded");
  });

  it("does NOT advance state on a single vote (no quorum yet)", async function () {
    const { escrow, a1 } = await deployFundedEscrow();

    await expect(escrow.connect(a1).attest(3, RECORD_HASH))
      .to.emit(escrow, "StatusAttested")
      .withArgs(a1.address, 3);

    expect(await escrow.state()).to.equal(2n); // still Funded
  });

  it("rejects the same attestor voting twice for the same claim", async function () {
    const { escrow, a1 } = await deployFundedEscrow();

    await escrow.connect(a1).attest(3, RECORD_HASH);

    await expect(
      escrow.connect(a1).attest(3, RECORD_HASH),
    ).to.be.revertedWith("Already attested to this");
  });

  it("advances Funded -> Shipped on the 2nd matching vote, sets clearanceDeadline", async function () {
    const { escrow, a1, a2 } = await deployFundedEscrow();

    await escrow.connect(a1).attest(3, RECORD_HASH);

    await expect(escrow.connect(a2).attest(3, RECORD_HASH))
      .to.emit(escrow, "EscrowShipped");

    expect(await escrow.state()).to.equal(3n); // Shipped
    expect(await escrow.clearanceDeadline()).to.be.greaterThan(0n);
  });

  it("does NOT advance if two attestors vote but disagree on recordHash", async function () {
    const { escrow, a1, a2 } = await deployFundedEscrow();

    const differentHash = ethers.keccak256(ethers.toUtf8Bytes("something-else"));

    await escrow.connect(a1).attest(3, RECORD_HASH);
    await escrow.connect(a2).attest(3, differentHash); // same statusCode, different hash

    // Neither key reached 2 votes - this is the "stalemate" case, expected
    // to stay stuck until Aleena's timeout logic exists.
    expect(await escrow.state()).to.equal(2n); // still Funded
  });

  it("goes all the way Funded -> Shipped -> CustomsCleared with 2 different quorums", async function () {
    const { escrow, a1, a2, a3 } = await deployFundedEscrow();

    await escrow.connect(a1).attest(3, RECORD_HASH);
    await escrow.connect(a2).attest(3, RECORD_HASH);
    expect(await escrow.state()).to.equal(3n); // Shipped

    await escrow.connect(a2).attest(4, RECORD_HASH_CLEARED);
    await escrow.connect(a3).attest(4, RECORD_HASH_CLEARED);
    expect(await escrow.state()).to.equal(4n); // CustomsCleared
  });

  it("moves to Disputed on 2-of-3 agreeing statusCode 99 (held)", async function () {
    const { escrow, a1, a2 } = await deployFundedEscrow();

    const heldHash = ethers.keccak256(ethers.toUtf8Bytes("held-for-inspection"));

    await escrow.connect(a1).attest(99, heldHash);
    await expect(escrow.connect(a2).attest(99, heldHash))
      .to.emit(escrow, "EscrowDisputed");

    expect(await escrow.state()).to.equal(7n); // Disputed
  });

  it("does NOT let a single attestor trigger Disputed alone", async function () {
    const { escrow, a1 } = await deployFundedEscrow();

    const heldHash = ethers.keccak256(ethers.toUtf8Bytes("held-for-inspection"));

    await escrow.connect(a1).attest(99, heldHash);

    expect(await escrow.state()).to.equal(2n); // still Funded - one vote is not quorum
  });

  it("rejects further attestation once Disputed", async function () {
    const { escrow, a1, a2, a3 } = await deployFundedEscrow();

    const heldHash = ethers.keccak256(ethers.toUtf8Bytes("held-for-inspection"));
    await escrow.connect(a1).attest(99, heldHash);
    await escrow.connect(a2).attest(99, heldHash);

    // 3rd attestor's vote, arriving after quorum already resolved it
    await expect(
      escrow.connect(a3).attest(99, heldHash),
    ).to.be.revertedWith("Not awaiting attestation");
  });
});
