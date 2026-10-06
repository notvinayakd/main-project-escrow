import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

const ONE_DAY = 24 * 60 * 60;

const SHIP_AMOUNT = ethers.parseEther("1");
const FEE = (SHIP_AMOUNT * 200n) / 10000n;
const FUND_VALUE = SHIP_AMOUNT + FEE;

const REQUIRED_STAKE = ethers.parseEther("1");

async function deployFundedEscrow() {
  const [importer, exporter, a1, a2, a3, arbitrator, feeRecipient] =
    await ethers.getSigners();

  const escrow = await ethers.deployContract("Escrow", [
    exporter.address,
    SHIP_AMOUNT,
    "SHP-88214",
    ONE_DAY,
    ONE_DAY * 30,
    ONE_DAY * 60,
    [a1.address, a2.address, a3.address],
    arbitrator.address,
    feeRecipient.address,
    ONE_DAY, // arbitration window
  ]);

  await escrow.connect(exporter).accept();

  await escrow.connect(importer).deposit({
    value: FUND_VALUE,
  });

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

async function stakeAllAttestors(
  escrow: any,
  a1: any,
  a2: any,
  a3: any,
) {
  await escrow.connect(a1).stakeAsAttestor({
    value: REQUIRED_STAKE,
  });

  await escrow.connect(a2).stakeAsAttestor({
    value: REQUIRED_STAKE,
  });

  await escrow.connect(a3).stakeAsAttestor({
    value: REQUIRED_STAKE,
  });
}

const RECORD_HASH = ethers.keccak256(
  ethers.toUtf8Bytes("SHP-88214-dispatched"),
);

const RECORD_HASH_CLEARED = ethers.keccak256(
  ethers.toUtf8Bytes("SHP-88214-cleared"),
);

describe("Escrow — Attestation (attest())", function () {
  it("rejects a caller who isn't one of the 3 attestors", async function () {
    const { escrow, importer } = await deployFundedEscrow();

    await expect(
      escrow.connect(importer).attest(3, RECORD_HASH),
    ).to.be.revertedWith("Only an attestor may attest");
  });

  it("rejects an unstaked attestor", async function () {
    const { escrow, a1 } = await deployFundedEscrow();

    await expect(
      escrow.connect(a1).attest(3, RECORD_HASH),
    ).to.be.revertedWith("Attestor stake required");
  });

  it("rejects a statusCode that doesn't make sense for the current state", async function () {
    const { escrow, a1 } = await deployFundedEscrow();

    await escrow.connect(a1).stakeAsAttestor({
      value: REQUIRED_STAKE,
    });

    await expect(
      escrow.connect(a1).attest(4, RECORD_HASH),
    ).to.be.revertedWith("Unexpected statusCode for Funded");
  });

  it("does NOT advance state on a single vote", async function () {
    const { escrow, a1 } = await deployFundedEscrow();

    await escrow.connect(a1).stakeAsAttestor({
      value: REQUIRED_STAKE,
    });

    await expect(
      escrow.connect(a1).attest(3, RECORD_HASH),
    )
      .to.emit(escrow, "StatusAttested")
      .withArgs(a1.address, 3);

    expect(await escrow.state()).to.equal(2n);
  });

  it("rejects the same attestor voting twice for the same claim", async function () {
    const { escrow, a1 } = await deployFundedEscrow();

    await escrow.connect(a1).stakeAsAttestor({
      value: REQUIRED_STAKE,
    });

    await escrow.connect(a1).attest(3, RECORD_HASH);

    await expect(
      escrow.connect(a1).attest(3, RECORD_HASH),
    ).to.be.revertedWith("Already attested to this");
  });

  it("advances Funded -> Shipped on the 2nd matching vote", async function () {
    const { escrow, a1, a2 } = await deployFundedEscrow();

    await escrow.connect(a1).stakeAsAttestor({
      value: REQUIRED_STAKE,
    });

    await escrow.connect(a2).stakeAsAttestor({
      value: REQUIRED_STAKE,
    });

    await escrow.connect(a1).attest(3, RECORD_HASH);

    await expect(
      escrow.connect(a2).attest(3, RECORD_HASH),
    ).to.emit(escrow, "EscrowShipped");

    expect(await escrow.state()).to.equal(3n);
    expect(await escrow.clearanceDeadline()).to.be.greaterThan(0n);
  });

  it("does NOT advance if two attestors disagree on recordHash", async function () {
    const { escrow, a1, a2 } = await deployFundedEscrow();

    await escrow.connect(a1).stakeAsAttestor({
      value: REQUIRED_STAKE,
    });

    await escrow.connect(a2).stakeAsAttestor({
      value: REQUIRED_STAKE,
    });

    const differentHash = ethers.keccak256(
      ethers.toUtf8Bytes("something-else"),
    );

    await escrow.connect(a1).attest(3, RECORD_HASH);

    await escrow.connect(a2).attest(3, differentHash);

    expect(await escrow.state()).to.equal(2n);
  });

  it("goes Funded -> Shipped -> CustomsCleared", async function () {
    const { escrow, a1, a2, a3 } = await deployFundedEscrow();

    await stakeAllAttestors(
      escrow,
      a1,
      a2,
      a3,
    );

    await escrow.connect(a1).attest(3, RECORD_HASH);
    await escrow.connect(a2).attest(3, RECORD_HASH);

    expect(await escrow.state()).to.equal(3n);

    await escrow
      .connect(a2)
      .attest(4, RECORD_HASH_CLEARED);

    await escrow
      .connect(a3)
      .attest(4, RECORD_HASH_CLEARED);

    expect(await escrow.state()).to.equal(4n);
  });

  it("moves to Disputed on 2-of-3 agreeing statusCode 99", async function () {
    const { escrow, a1, a2 } =
      await deployFundedEscrow();

    await escrow.connect(a1).stakeAsAttestor({
      value: REQUIRED_STAKE,
    });

    await escrow.connect(a2).stakeAsAttestor({
      value: REQUIRED_STAKE,
    });

    const heldHash = ethers.keccak256(
      ethers.toUtf8Bytes("held-for-inspection"),
    );

    await escrow.connect(a1).attest(
      99,
      heldHash,
    );

    await expect(
      escrow.connect(a2).attest(
        99,
        heldHash,
      ),
    ).to.emit(escrow, "EscrowDisputed");

    expect(await escrow.state()).to.equal(7n);

    expect(
      await escrow.arbitrationDeadline(),
    ).to.be.greaterThan(0n);
  });

  it("does NOT let a single attestor trigger Disputed alone", async function () {
    const { escrow, a1 } =
      await deployFundedEscrow();

    await escrow.connect(a1).stakeAsAttestor({
      value: REQUIRED_STAKE,
    });

    const heldHash = ethers.keccak256(
      ethers.toUtf8Bytes("held-for-inspection"),
    );

    await escrow.connect(a1).attest(
      99,
      heldHash,
    );

    expect(await escrow.state()).to.equal(2n);
  });

  it("rejects further attestation once Disputed", async function () {
    const { escrow, a1, a2, a3 } =
      await deployFundedEscrow();

    await stakeAllAttestors(
      escrow,
      a1,
      a2,
      a3,
    );

    const heldHash = ethers.keccak256(
      ethers.toUtf8Bytes("held-for-inspection"),
    );

    await escrow.connect(a1).attest(
      99,
      heldHash,
    );

    await escrow.connect(a2).attest(
      99,
      heldHash,
    );

    await expect(
      escrow.connect(a3).attest(
        99,
        heldHash,
      ),
    ).to.be.revertedWith(
      "Not awaiting attestation",
    );
  });

  it("requires exactly 1 POL to stake", async function () {
    const { escrow, a1 } =
      await deployFundedEscrow();

    await expect(
      escrow.connect(a1).stakeAsAttestor({
        value: ethers.parseEther("0.5"),
      }),
    ).to.be.revertedWith(
      "Incorrect stake amount",
    );
  });

  it("does not allow the same attestor to stake twice", async function () {
    const { escrow, a1 } =
      await deployFundedEscrow();

    await escrow.connect(a1).stakeAsAttestor({
      value: REQUIRED_STAKE,
    });

    await expect(
      escrow.connect(a1).stakeAsAttestor({
        value: REQUIRED_STAKE,
      }),
    ).to.be.revertedWith(
      "Already staked",
    );
  });
});