import { expect } from "chai";
import { network } from "hardhat";

const { ethers, provider } = await network.create();

const ONE_DAY = 24 * 60 * 60;
const SHIP_AMOUNT = ethers.parseEther("1");
const FEE = (SHIP_AMOUNT * 200n) / 10000n;
const FUND_VALUE = SHIP_AMOUNT + FEE;

const RECORD_HASH_DISPATCHED = ethers.keccak256(ethers.toUtf8Bytes("SHP-88214-dispatched"));
const RECORD_HASH_CLEARED = ethers.keccak256(ethers.toUtf8Bytes("SHP-88214-cleared"));

async function deployFundedEscrow(dispatchWindowSeconds = ONE_DAY * 30) {
  const [importer, exporter, a1, a2, a3, arbitrator, feeRecipient] =
    await ethers.getSigners();

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
  ]);

  await escrow.connect(exporter).accept();
  await escrow.connect(importer).deposit({ value: FUND_VALUE });

  return { escrow, importer, exporter, a1, a2, a3, arbitrator, feeRecipient };
}

async function deployClearedEscrow() {
  const ctx = await deployFundedEscrow();
  const { escrow, a1, a2, a3 } = ctx;

  await escrow.connect(a1).attest(3, RECORD_HASH_DISPATCHED);
  await escrow.connect(a2).attest(3, RECORD_HASH_DISPATCHED); // -> Shipped

  await escrow.connect(a2).attest(4, RECORD_HASH_CLEARED);
  await escrow.connect(a3).attest(4, RECORD_HASH_CLEARED); // -> CustomsCleared

  return ctx;
}

describe("Escrow — withdraw()", function () {
  it("rejects withdraw() before CustomsCleared", async function () {
    const { escrow, exporter } = await deployFundedEscrow();

    await expect(
      escrow.connect(exporter).withdraw(),
    ).to.be.revertedWith("Escrow not cleared");
  });

  it("rejects withdraw() from anyone but the exporter", async function () {
    const { escrow, importer } = await deployClearedEscrow();

    await expect(
      escrow.connect(importer).withdraw(),
    ).to.be.revertedWith("Only exporter can withdraw");
  });

  it("pays the full shipment amount to the exporter and moves to Released", async function () {
    const { escrow, exporter } = await deployClearedEscrow();

    const before = await ethers.provider.getBalance(exporter.address);

    const tx = await escrow.connect(exporter).withdraw();
    const receipt = await tx.wait();
    const gasCost = receipt!.gasUsed * receipt!.gasPrice;

    const after = await ethers.provider.getBalance(exporter.address);

    // exporter's balance should go up by exactly SHIP_AMOUNT, minus what
    // they spent on gas calling withdraw() themselves
    expect(after - before + gasCost).to.equal(SHIP_AMOUNT);

    expect(await escrow.state()).to.equal(5n); // Released
  });

  it("emits EscrowReleased with the exporter and amount", async function () {
    const { escrow, exporter } = await deployClearedEscrow();

    await expect(escrow.connect(exporter).withdraw())
      .to.emit(escrow, "EscrowReleased")
      .withArgs(exporter.address, SHIP_AMOUNT);
  });

  it("rejects a second withdraw() once already Released", async function () {
    const { escrow, exporter } = await deployClearedEscrow();

    await escrow.connect(exporter).withdraw();

    await expect(
      escrow.connect(exporter).withdraw(),
    ).to.be.revertedWith("Escrow not cleared");
  });
});

describe("Escrow — refund()", function () {
  it("rejects refund() before the dispatch deadline has passed", async function () {
    const { escrow, importer } = await deployFundedEscrow();

    await expect(
      escrow.connect(importer).refund(),
    ).to.be.revertedWith("Dispatch deadline not passed");
  });

  it("rejects refund() from anyone but the importer", async function () {
    const shortWindow = 60; // 1 minute, so the test doesn't wait 30 days
    const { escrow, exporter } = await deployFundedEscrow(shortWindow);

    await provider.send("evm_increaseTime", [shortWindow + 1]);
    await provider.send("evm_mine");

    await expect(
      escrow.connect(exporter).refund(),
    ).to.be.revertedWith("Only importer can refund");
  });

  it("rejects refund() once past Funded (e.g. already Shipped)", async function () {
    const shortWindow = 60;
    const { escrow, importer, a1, a2 } = await deployFundedEscrow(shortWindow);

    await escrow.connect(a1).attest(3, RECORD_HASH_DISPATCHED);
    await escrow.connect(a2).attest(3, RECORD_HASH_DISPATCHED); // -> Shipped

    await provider.send("evm_increaseTime", [shortWindow + 1]);
    await provider.send("evm_mine");

    await expect(
      escrow.connect(importer).refund(),
    ).to.be.revertedWith("Refund not available");
  });

  it("returns the full shipment amount to the importer and moves to Refunded, after the deadline passes", async function () {
    const shortWindow = 60;
    const { escrow, importer } = await deployFundedEscrow(shortWindow);

    await provider.send("evm_increaseTime", [shortWindow + 1]);
    await provider.send("evm_mine");

    const before = await ethers.provider.getBalance(importer.address);

    const tx = await escrow.connect(importer).refund();
    const receipt = await tx.wait();
    const gasCost = receipt!.gasUsed * receipt!.gasPrice;

    const after = await ethers.provider.getBalance(importer.address);

    expect(after - before + gasCost).to.equal(SHIP_AMOUNT);
    expect(await escrow.state()).to.equal(6n); // Refunded
  });

  it("emits EscrowRefunded with the importer and amount", async function () {
    const shortWindow = 60;
    const { escrow, importer } = await deployFundedEscrow(shortWindow);

    await provider.send("evm_increaseTime", [shortWindow + 1]);
    await provider.send("evm_mine");

    await expect(escrow.connect(importer).refund())
      .to.emit(escrow, "EscrowRefunded")
      .withArgs(importer.address, SHIP_AMOUNT);
  });
});
