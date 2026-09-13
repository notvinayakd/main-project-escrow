import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

// One-day setup window used across most tests — mirrors the "proposal must
// complete within N days" default discussed in the design.
const ONE_DAY = 24 * 60 * 60;
const AMOUNT = ethers.parseEther("1"); // 1 POL, arbitrary test value

describe("Escrow — Proposed -> Ready", function () {
  it("deploys into Proposed, with importer/exporter/amount set correctly", async function () {
    const [importerSigner, exporterSigner] = await ethers.getSigners();

    const escrow = await ethers.deployContract("Escrow", [
      exporterSigner.address,
      AMOUNT,
      "SHP-88214",
      ONE_DAY,
    ]);

    expect(await escrow.importer()).to.equal(importerSigner.address);
    expect(await escrow.exporter()).to.equal(exporterSigner.address);
    expect(await escrow.amount()).to.equal(AMOUNT);
    expect(await escrow.consignmentId()).to.equal("SHP-88214");
    expect(await escrow.state()).to.equal(0n); // State.Proposed
  });

  it("rejects a zero exporter address", async function () {
    await expect(
      ethers.deployContract("Escrow", [
        ethers.ZeroAddress,
        AMOUNT,
        "SHP-88214",
        ONE_DAY,
      ]),
    ).to.be.revertedWith("exporter address is zero");
  });

  it("rejects importer and exporter being the same address", async function () {
    const [importerSigner] = await ethers.getSigners();

    await expect(
      ethers.deployContract("Escrow", [
        importerSigner.address, // same as deployer/importer
        AMOUNT,
        "SHP-88214",
        ONE_DAY,
      ]),
    ).to.be.revertedWith("importer and exporter must differ");
  });

  it("rejects a zero amount", async function () {
    const [, exporterSigner] = await ethers.getSigners();

    await expect(
      ethers.deployContract("Escrow", [
        exporterSigner.address,
        0n,
        "SHP-88214",
        ONE_DAY,
      ]),
    ).to.be.revertedWith("amount must be positive");
  });

  it("lets the named exporter accept, moving Proposed -> Ready", async function () {
    const [, exporterSigner] = await ethers.getSigners();

    const escrow = await ethers.deployContract("Escrow", [
      exporterSigner.address,
      AMOUNT,
      "SHP-88214",
      ONE_DAY,
    ]);

    await expect(escrow.connect(exporterSigner).accept())
      .to.emit(escrow, "EscrowAccepted")
      .withArgs(exporterSigner.address);

    expect(await escrow.state()).to.equal(1n); // State.Ready
  });

  it("rejects accept() from anyone other than the named exporter", async function () {
    const [, exporterSigner, randomSigner] = await ethers.getSigners();

    const escrow = await ethers.deployContract("Escrow", [
      exporterSigner.address,
      AMOUNT,
      "SHP-88214",
      ONE_DAY,
    ]);

    await expect(
      escrow.connect(randomSigner).accept(),
    ).to.be.revertedWith("only the named exporter can accept");
  });

  it("rejects a second accept() once already Ready", async function () {
    const [, exporterSigner] = await ethers.getSigners();

    const escrow = await ethers.deployContract("Escrow", [
      exporterSigner.address,
      AMOUNT,
      "SHP-88214",
      ONE_DAY,
    ]);

    await escrow.connect(exporterSigner).accept();

    await expect(
      escrow.connect(exporterSigner).accept(),
    ).to.be.revertedWith("not awaiting acceptance");
  });

  it("rejects accept() after the setup deadline has passed", async function () {
    const [, exporterSigner] = await ethers.getSigners();

    const escrow = await ethers.deployContract("Escrow", [
      exporterSigner.address,
      AMOUNT,
      "SHP-88214",
      ONE_DAY,
    ]);

    // Move the chain's clock forward past the deadline — see the project's
    // earlier note: this is why short real-world deadlines don't need to be
    // "waited out" in tests, only in a live demo.
    await network.provider.send("evm_increaseTime", [ONE_DAY + 1]);
    await network.provider.send("evm_mine");

    await expect(
      escrow.connect(exporterSigner).accept(),
    ).to.be.revertedWith("proposal window has expired");
  });
});
