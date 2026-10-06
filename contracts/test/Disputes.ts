import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

const ONE_DAY = 24 * 60 * 60;

const SHIP_AMOUNT = ethers.parseEther("1");
const FEE = (SHIP_AMOUNT * 200n) / 10000n;
const FUND_VALUE = SHIP_AMOUNT + FEE;

const REQUIRED_STAKE = ethers.parseEther("1");
const SLASH_BPS = 2000n;
const ARBITRATOR_FEE_BPS = 200n;

const SLASH_AMOUNT =
  (REQUIRED_STAKE * SLASH_BPS) / 10000n;

const ARBITRATOR_FEE =
  (SHIP_AMOUNT * ARBITRATOR_FEE_BPS) / 10000n;

const ARBITRATOR_PAYOUT =
  SHIP_AMOUNT - ARBITRATOR_FEE;

async function deployFundedEscrow() {
  const [
    importer,
    exporter,
    a1,
    a2,
    a3,
    arbitrator,
    feeRecipient,
  ] = await ethers.getSigners();

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
    ONE_DAY,
  ]);

  await escrow.connect(exporter).accept();

  await escrow.connect(importer).deposit({
    value: FUND_VALUE,
  });

  await escrow.connect(a1).stakeAsAttestor({
    value: REQUIRED_STAKE,
  });

  await escrow.connect(a2).stakeAsAttestor({
    value: REQUIRED_STAKE,
  });

  await escrow.connect(a3).stakeAsAttestor({
    value: REQUIRED_STAKE,
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

const RECORD_HASH = ethers.keccak256(
  ethers.toUtf8Bytes("SHP-88214-dispatched"),
);

async function moveToDisputed(
  escrow: any,
  a1: any,
  a2: any,
) {
  await escrow.connect(a1).attest(
    3,
    RECORD_HASH,
  );

  await escrow.connect(a2).attest(
    3,
    RECORD_HASH,
  );

  await ethers.provider.send(
    "evm_increaseTime",
    [ONE_DAY * 60 + 1],
  );

  await ethers.provider.send(
    "evm_mine",
  );

  await escrow.checkTimeout();
}

describe("Escrow — Disputes", function () {

  it("does not allow checkTimeout() before the escrow reaches Shipped", async function () {
    const { escrow } =
      await deployFundedEscrow();

    await expect(
      escrow.checkTimeout(),
    ).to.be.revertedWith(
      "Not shipped",
    );
  });

  it("moves Shipped -> Disputed when clearance deadline passes", async function () {
    const {
      escrow,
      a1,
      a2,
    } = await deployFundedEscrow();

    await escrow.connect(a1).attest(
      3,
      RECORD_HASH,
    );

    await escrow.connect(a2).attest(
      3,
      RECORD_HASH,
    );

    expect(
      await escrow.state(),
    ).to.equal(3n);

    await ethers.provider.send(
      "evm_increaseTime",
      [ONE_DAY * 60 + 1],
    );

    await ethers.provider.send(
      "evm_mine",
    );

    await expect(
      escrow.checkTimeout(),
    ).to.emit(
      escrow,
      "EscrowDisputed",
    );

    expect(
      await escrow.state(),
    ).to.equal(7n);

    expect(
      await escrow.arbitrationDeadline(),
    ).to.be.greaterThan(0n);
  });

  it("does not allow checkTimeout() before clearance deadline", async function () {
    const {
      escrow,
      a1,
      a2,
    } = await deployFundedEscrow();

    await escrow.connect(a1).attest(
      3,
      RECORD_HASH,
    );

    await escrow.connect(a2).attest(
      3,
      RECORD_HASH,
    );

    await expect(
      escrow.checkTimeout(),
    ).to.be.revertedWith(
      "Clearance deadline not passed",
    );

    expect(
      await escrow.state(),
    ).to.equal(3n);
  });

  it("slashes all three attestors when clearance times out", async function () {
    const {
      escrow,
      a1,
      a2,
      a3,
    } = await deployFundedEscrow();

    await escrow.connect(a1).attest(
      3,
      RECORD_HASH,
    );

    await escrow.connect(a2).attest(
      3,
      RECORD_HASH,
    );

    await ethers.provider.send(
      "evm_increaseTime",
      [ONE_DAY * 60 + 1],
    );

    await ethers.provider.send(
      "evm_mine",
    );

    await escrow.checkTimeout();

    const remainingStake =
      REQUIRED_STAKE - SLASH_AMOUNT;

    expect(
      await escrow.attestorStake(a1.address),
    ).to.equal(remainingStake);

    expect(
      await escrow.attestorStake(a2.address),
    ).to.equal(remainingStake);

    expect(
      await escrow.attestorStake(a3.address),
    ).to.equal(remainingStake);
  });

  it("sends the slashed stake to the fee recipient", async function () {
    const {
      escrow,
      a1,
      a2,
      feeRecipient,
    } = await deployFundedEscrow();

    await escrow.connect(a1).attest(
      3,
      RECORD_HASH,
    );

    await escrow.connect(a2).attest(
      3,
      RECORD_HASH,
    );

    const before =
      await ethers.provider.getBalance(
        feeRecipient.address,
      );

    await ethers.provider.send(
      "evm_increaseTime",
      [ONE_DAY * 60 + 1],
    );

    await ethers.provider.send(
      "evm_mine",
    );

    await escrow.checkTimeout();

    const after =
      await ethers.provider.getBalance(
        feeRecipient.address,
      );

    expect(
      after - before,
    ).to.equal(
      SLASH_AMOUNT * 3n,
    );
  });

  it("emits AttestorSlashed for each attestor", async function () {
    const {
      escrow,
      a1,
      a2,
      a3,
    } = await deployFundedEscrow();

    await escrow.connect(a1).attest(
      3,
      RECORD_HASH,
    );

    await escrow.connect(a2).attest(
      3,
      RECORD_HASH,
    );

    await ethers.provider.send(
      "evm_increaseTime",
      [ONE_DAY * 60 + 1],
    );

    await ethers.provider.send(
      "evm_mine",
    );

    const tx =
      await escrow.checkTimeout();

    await expect(tx)
      .to.emit(
        escrow,
        "AttestorSlashed",
      )
      .withArgs(
        a1.address,
        SLASH_AMOUNT,
      );

    await expect(tx)
      .to.emit(
        escrow,
        "AttestorSlashed",
      )
      .withArgs(
        a2.address,
        SLASH_AMOUNT,
      );

    await expect(tx)
      .to.emit(
        escrow,
        "AttestorSlashed",
      )
      .withArgs(
        a3.address,
        SLASH_AMOUNT,
      );
  });

  it("does not allow a non-arbitrator to resolve a dispute", async function () {
    const {
      escrow,
      a1,
      a2,
      importer,
    } = await deployFundedEscrow();

    await moveToDisputed(
      escrow,
      a1,
      a2,
    );

    await expect(
      escrow.connect(importer).resolveDispute(true),
    ).to.be.revertedWith(
      "Only arbitrator",
    );
  });

  it("does not allow resolveDispute() when state is not Disputed", async function () {
    const {
      escrow,
      arbitrator,
    } = await deployFundedEscrow();

    expect(
      await escrow.state(),
    ).to.equal(2n);

    await expect(
      escrow.connect(arbitrator).resolveDispute(true),
    ).to.be.revertedWith(
      "Not disputed",
    );
  });

  it("arbitrator can resolve dispute in favor of exporter", async function () {
    const {
      escrow,
      a1,
      a2,
      arbitrator,
    } = await deployFundedEscrow();

    await moveToDisputed(
      escrow,
      a1,
      a2,
    );

    await expect(
      escrow.connect(arbitrator).resolveDispute(true),
    )
      .to.emit(
        escrow,
        "DisputeResolved",
      )
      .withArgs(5n);

    expect(
      await escrow.state(),
    ).to.equal(5n);
  });

  it("arbitrator can resolve dispute in favor of importer", async function () {
    const {
      escrow,
      a1,
      a2,
      arbitrator,
    } = await deployFundedEscrow();

    await moveToDisputed(
      escrow,
      a1,
      a2,
    );

    await expect(
      escrow.connect(arbitrator).resolveDispute(false),
    )
      .to.emit(
        escrow,
        "DisputeResolved",
      )
      .withArgs(6n);

    expect(
      await escrow.state(),
    ).to.equal(6n);
  });

  it("charges the arbitrator a 2% fee and pays exporter the remaining amount", async function () {
    const {
      escrow,
      a1,
      a2,
      arbitrator,
      exporter,
    } = await deployFundedEscrow();

    await moveToDisputed(
      escrow,
      a1,
      a2,
    );

    const exporterBefore =
      await ethers.provider.getBalance(
        exporter.address,
      );

    const arbitratorBefore =
      await ethers.provider.getBalance(
        arbitrator.address,
      );

    const tx =
      await escrow.connect(arbitrator).resolveDispute(true);

    const receipt =
      await tx.wait();

    const gasCost =
      receipt!.gasUsed *
      receipt!.gasPrice;

    const exporterAfter =
      await ethers.provider.getBalance(
        exporter.address,
      );

    const arbitratorAfter =
      await ethers.provider.getBalance(
        arbitrator.address,
      );

    expect(
      exporterAfter - exporterBefore,
    ).to.equal(
      ARBITRATOR_PAYOUT,
    );

    expect(
      arbitratorAfter -
        arbitratorBefore +
        gasCost,
    ).to.equal(
      ARBITRATOR_FEE,
    );
  });

  it("emits EscrowReleased with the post-fee exporter payout", async function () {
    const {
      escrow,
      a1,
      a2,
      arbitrator,
      exporter,
    } = await deployFundedEscrow();

    await moveToDisputed(
      escrow,
      a1,
      a2,
    );

    await expect(
      escrow.connect(arbitrator).resolveDispute(true),
    )
      .to.emit(
        escrow,
        "EscrowReleased",
      )
      .withArgs(
        exporter.address,
        ARBITRATOR_PAYOUT,
      );
  });

  it("emits EscrowRefunded with the post-fee importer payout", async function () {
    const {
      escrow,
      a1,
      a2,
      arbitrator,
      importer,
    } = await deployFundedEscrow();

    await moveToDisputed(
      escrow,
      a1,
      a2,
    );

    await expect(
      escrow.connect(arbitrator).resolveDispute(false),
    )
      .to.emit(
        escrow,
        "EscrowRefunded",
      )
      .withArgs(
        importer.address,
        ARBITRATOR_PAYOUT,
      );
  });

  it("rejects forceResolveDispute() before the arbitration deadline", async function () {
    const {
      escrow,
      a1,
      a2,
    } = await deployFundedEscrow();

    await moveToDisputed(
      escrow,
      a1,
      a2,
    );

    await expect(
      escrow.forceResolveDispute(),
    ).to.be.revertedWith(
      "Arbitration deadline not passed",
    );
  });

  it("forceResolveDispute() refunds the importer if the arbitrator never acts", async function () {
    const {
      escrow,
      a1,
      a2,
      importer,
    } = await deployFundedEscrow();

    await moveToDisputed(
      escrow,
      a1,
      a2,
    );

    await ethers.provider.send(
      "evm_increaseTime",
      [ONE_DAY + 1],
    );

    await ethers.provider.send(
      "evm_mine",
    );

    await expect(
      escrow.forceResolveDispute(),
    )
      .to.emit(
        escrow,
        "EscrowRefunded",
      )
      .withArgs(
        importer.address,
        SHIP_AMOUNT,
      );

    expect(
      await escrow.state(),
    ).to.equal(6n);
  });

  it("prevents the arbitrator from resolving after forceResolveDispute()", async function () {
    const {
      escrow,
      a1,
      a2,
      arbitrator,
    } = await deployFundedEscrow();

    await moveToDisputed(
      escrow,
      a1,
      a2,
    );

    await ethers.provider.send(
      "evm_increaseTime",
      [ONE_DAY + 1],
    );

    await ethers.provider.send(
      "evm_mine",
    );

    await escrow.forceResolveDispute();

    await expect(
      escrow.connect(arbitrator).resolveDispute(true),
    ).to.be.revertedWith(
      "Not disputed",
    );
  });
});