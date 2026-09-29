import { expect } from "chai";
import { network } from "hardhat";

const { ethers, provider } = await network.create();

const ONE_DAY = 24 * 60 * 60;

const SHIP_AMOUNT = ethers.parseEther("1");
const FEE = (SHIP_AMOUNT * 200n) / 10000n;
const FUND_VALUE = SHIP_AMOUNT + FEE;

const REQUIRED_STAKE = ethers.parseEther("1");

const RECORD_HASH_DISPATCHED = ethers.keccak256(
  ethers.toUtf8Bytes("SHP-88214-dispatched"),
);

const RECORD_HASH_CLEARED = ethers.keccak256(
  ethers.toUtf8Bytes("SHP-88214-cleared"),
);

async function deployFundedEscrow(
  dispatchWindowSeconds = ONE_DAY * 30,
) {
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
    dispatchWindowSeconds,
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

async function deployShippedEscrow() {
  const ctx = await deployFundedEscrow();

  const {
    escrow,
    a1,
    a2,
  } = ctx;

  await escrow.connect(a1).attest(
    3,
    RECORD_HASH_DISPATCHED,
  );

  await escrow.connect(a2).attest(
    3,
    RECORD_HASH_DISPATCHED,
  );

  return ctx;
}

async function deployClearedEscrow() {
  const ctx = await deployShippedEscrow();

  const {
    escrow,
    a2,
    a3,
  } = ctx;

  await escrow.connect(a2).attest(
    4,
    RECORD_HASH_CLEARED,
  );

  await escrow.connect(a3).attest(
    4,
    RECORD_HASH_CLEARED,
  );

  return ctx;
}

describe("Escrow — withdraw()", function () {

  it("allows withdraw() once the escrow reaches Shipped", async function () {
    const {
      escrow,
      exporter,
    } = await deployShippedEscrow();

    expect(
      await escrow.state(),
    ).to.equal(3n);

    const before =
      await ethers.provider.getBalance(
        exporter.address,
      );

    const tx =
      await escrow.connect(exporter).withdraw();

    const receipt =
      await tx.wait();

    const gasCost =
      receipt!.gasUsed *
      receipt!.gasPrice;

    const after =
      await ethers.provider.getBalance(
        exporter.address,
      );

    expect(
      after - before + gasCost,
    ).to.equal(
      SHIP_AMOUNT,
    );

    expect(
      await escrow.state(),
    ).to.equal(5n);
  });

  it("allows withdraw() when the escrow reaches CustomsCleared", async function () {
    const {
      escrow,
      exporter,
    } = await deployClearedEscrow();

    expect(
      await escrow.state(),
    ).to.equal(4n);

    await expect(
      escrow.connect(exporter).withdraw(),
    )
      .to.emit(
        escrow,
        "EscrowReleased",
      )
      .withArgs(
        exporter.address,
        SHIP_AMOUNT,
      );

    expect(
      await escrow.state(),
    ).to.equal(5n);
  });

  it("rejects withdraw() from anyone but the exporter", async function () {
    const {
      escrow,
      importer,
    } = await deployShippedEscrow();

    await expect(
      escrow.connect(importer).withdraw(),
    ).to.be.revertedWith(
      "Only exporter can withdraw",
    );
  });

  it("rejects withdraw() before the escrow is shipped", async function () {
    const {
      escrow,
      exporter,
    } = await deployFundedEscrow();

    await expect(
      escrow.connect(exporter).withdraw(),
    ).to.be.revertedWith(
      "Escrow not shipped",
    );
  });

  it("rejects a second withdraw() once already Released", async function () {
    const {
      escrow,
      exporter,
    } = await deployShippedEscrow();

    await escrow.connect(exporter).withdraw();

    await expect(
      escrow.connect(exporter).withdraw(),
    ).to.be.revertedWith(
      "Escrow not shipped",
    );
  });

  it("emits EscrowReleased with the shipment amount", async function () {
    const {
      escrow,
      exporter,
    } = await deployShippedEscrow();

    await expect(
      escrow.connect(exporter).withdraw(),
    )
      .to.emit(
        escrow,
        "EscrowReleased",
      )
      .withArgs(
        exporter.address,
        SHIP_AMOUNT,
      );
  });
});

describe("Escrow — refund()", function () {

  it("rejects refund() before the dispatch deadline has passed", async function () {
    const {
      escrow,
      importer,
    } = await deployFundedEscrow();

    await expect(
      escrow.connect(importer).refund(),
    ).to.be.revertedWith(
      "Dispatch deadline not passed",
    );
  });

  it("rejects refund() from anyone but the importer", async function () {
    const shortWindow = 60;

    const {
      escrow,
      exporter,
    } = await deployFundedEscrow(
      shortWindow,
    );

    await provider.send(
      "evm_increaseTime",
      [shortWindow + 1],
    );

    await provider.send(
      "evm_mine",
    );

    await expect(
      escrow.connect(exporter).refund(),
    ).to.be.revertedWith(
      "Only importer can refund",
    );
  });

  it("rejects refund() once the escrow has shipped", async function () {
    const shortWindow = 60;

    const {
      escrow,
      importer,
    } = await deployFundedEscrow(
      shortWindow,
    );

    const {
      a1,
      a2,
    } = await deployFundedEscrow(
      shortWindow,
    );

    // Silence unused deployment warning by using the first
    // escrow for the actual test.
    await escrow.connect(a1).attest(
      3,
      RECORD_HASH_DISPATCHED,
    );

    await escrow.connect(a2).attest(
      3,
      RECORD_HASH_DISPATCHED,
    );

    await provider.send(
      "evm_increaseTime",
      [shortWindow + 1],
    );

    await provider.send(
      "evm_mine",
    );

    await expect(
      escrow.connect(importer).refund(),
    ).to.be.revertedWith(
      "Refund not available",
    );
  });

  it("returns the full shipment amount to the importer after the dispatch deadline", async function () {
    const shortWindow = 60;

    const {
      escrow,
      importer,
    } = await deployFundedEscrow(
      shortWindow,
    );

    await provider.send(
      "evm_increaseTime",
      [shortWindow + 1],
    );

    await provider.send(
      "evm_mine",
    );

    const before =
      await ethers.provider.getBalance(
        importer.address,
      );

    const tx =
      await escrow.connect(importer).refund();

    const receipt =
      await tx.wait();

    const gasCost =
      receipt!.gasUsed *
      receipt!.gasPrice;

    const after =
      await ethers.provider.getBalance(
        importer.address,
      );

    expect(
      after - before + gasCost,
    ).to.equal(
      SHIP_AMOUNT,
    );

    expect(
      await escrow.state(),
    ).to.equal(6n);
  });

  it("emits EscrowRefunded with the shipment amount", async function () {
    const shortWindow = 60;

    const {
      escrow,
      importer,
    } = await deployFundedEscrow(
      shortWindow,
    );

    await provider.send(
      "evm_increaseTime",
      [shortWindow + 1],
    );

    await provider.send(
      "evm_mine",
    );

    await expect(
      escrow.connect(importer).refund(),
    )
      .to.emit(
        escrow,
        "EscrowRefunded",
      )
      .withArgs(
        importer.address,
        SHIP_AMOUNT,
      );
  });
});