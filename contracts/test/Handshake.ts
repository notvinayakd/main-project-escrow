import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

const ONE_DAY = 24 * 60 * 60;
const SHIP_AMOUNT = ethers.parseEther("1");
const FEE = (SHIP_AMOUNT * 200n) / 10000n;
const FUND_VALUE = SHIP_AMOUNT + FEE;

describe("Escrow — Handshake (accept/deposit)", function () {
  it("deploys into Proposed with correct fields", async function () {
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

    expect(await escrow.importer()).to.equal(
      importer.address,
    );

    expect(await escrow.exporter()).to.equal(
      exporter.address,
    );

    expect(await escrow.amount()).to.equal(
      SHIP_AMOUNT,
    );

    expect(await escrow.state()).to.equal(0n);

    expect(
      await escrow.arbitrationWindowSeconds(),
    ).to.equal(BigInt(ONE_DAY));
  });

  it("moves Proposed -> Ready -> Funded, taking the 2% fee out of the contract", async function () {
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

    expect(await escrow.state()).to.equal(2n);

    const balance =
      await ethers.provider.getBalance(
        await escrow.getAddress(),
      );

    expect(balance).to.equal(
      SHIP_AMOUNT,
    );
  });

  it("rejects deposit() with the wrong value", async function () {
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

    await expect(
      escrow.connect(importer).deposit({
        value: SHIP_AMOUNT,
      }),
    ).to.be.revertedWith(
      "Incorrect amount",
    );
  });
});