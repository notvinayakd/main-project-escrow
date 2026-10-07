import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

const ONE_DAY = 24 * 60 * 60;
const AMOUNT = ethers.parseEther("1");
const FEE = (AMOUNT * 200n) / 10000n;
const STAKE = ethers.parseEther("1");
const SLASH = (STAKE * 2000n) / 10000n;

const RECORD_HASH = ethers.keccak256(
  ethers.toUtf8Bytes("SHP-TIMEOUT-dispatched"),
);

// Fee recipient is a contract that accepts payments during setup
// (the deposit fee) and can then be switched to reject everything.
async function setup() {
  const [importer, exporter, a1, a2, a3, arbitrator, stranger] =
    await ethers.getSigners();

  const receiver = await ethers.deployContract("ToggleReceiver");

  const escrow = await ethers.deployContract("Escrow", [
    exporter.address,
    AMOUNT,
    "SHP-TIMEOUT",
    ONE_DAY,
    ONE_DAY * 30,
    ONE_DAY * 60,
    [a1.address, a2.address, a3.address],
    arbitrator.address,
    await receiver.getAddress(),
    ONE_DAY,
  ]);

  await escrow.connect(exporter).accept();
  await escrow.connect(importer).deposit({ value: AMOUNT + FEE });

  for (const a of [a1, a2, a3]) {
    await escrow.connect(a).stakeAsAttestor({ value: STAKE });
  }

  await escrow.connect(a1).attest(3, RECORD_HASH);
  await escrow.connect(a2).attest(3, RECORD_HASH);

  await ethers.provider.send("evm_increaseTime", [ONE_DAY * 60 + 1]);
  await ethers.provider.send("evm_mine");

  return { escrow, receiver, stranger, arbitrator, importer };
}

describe("Escrow — checkTimeout() cannot be blocked", function () {
  it("still moves to Disputed when the fee recipient rejects payments", async function () {
    const { escrow, receiver } = await setup();

    await receiver.setReject(true);

    await escrow.checkTimeout();

    expect(await escrow.state()).to.equal(7n); // Disputed
    expect(await escrow.slashedPool()).to.equal(SLASH * 3n);
  });

  it("claimSlashed() fails while the recipient rejects, and works once it accepts", async function () {
    const { escrow, receiver, stranger } = await setup();

    await receiver.setReject(true);
    await escrow.checkTimeout();

    await expect(
      escrow.connect(stranger).claimSlashed(),
    ).to.be.revertedWith("Claim transfer failed");

    // The failed claim must not lose the money.
    expect(await escrow.slashedPool()).to.equal(SLASH * 3n);

    await receiver.setReject(false);
    await escrow.connect(stranger).claimSlashed();

    expect(
      await ethers.provider.getBalance(await receiver.getAddress()),
    ).to.equal(FEE + SLASH * 3n);
    expect(await escrow.slashedPool()).to.equal(0n);
  });

  it("claimSlashed() reverts when there is nothing to claim", async function () {
    const { escrow } = await setup();

    await expect(escrow.claimSlashed()).to.be.revertedWith(
      "Nothing to claim",
    );
  });

  it("a rejecting fee recipient cannot stop the arbitrator resolving the dispute", async function () {
    const { escrow, receiver, arbitrator } = await setup();

    await receiver.setReject(true);
    await escrow.checkTimeout();

    await escrow.connect(arbitrator).resolveDispute(false);

    expect(await escrow.state()).to.equal(6n); // Refunded
  });
});
