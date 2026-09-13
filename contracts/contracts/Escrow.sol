// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.34;

/// @title TrustLC Escrow — shared skeleton
/// @notice Agreed as a group 2026-09-13. States and function SHAPES only.
///         Each TODO below is owned by one person — see the team's task split.
///         Do not add new state variables or change these signatures without
///         telling the rest of the team, since everyone's branch depends on them.
contract Escrow {
    // ---- State machine (full list, agreed) ---------------------------------
    enum State {
        Proposed,        // 0 - importer created it, exporter hasn't responded
        Ready,           // 1 - exporter accepted, importer hasn't funded yet
        Funded,          // 2 - importer's POL is locked in the contract
        Shipped,         // 3 - 2-of-3 attestors confirmed dispatch
        CustomsCleared,  // 4 - 2-of-3 attestors confirmed clearance
        Released,        // 5 - exporter withdrew. Terminal.
        Refunded,        // 6 - importer repaid. Terminal.
        Disputed         // 7 - quorum failed or timeout hit. Arbitrator decides.
    }

    // ---- Storage: parties, money, timing ------------------------------------
    address public immutable importer;
    address public immutable exporter;
    uint256 public immutable amount;           // POL, in wei units
    string  public consignmentId;

    State   public state;
    uint256 public setupDeadline;              // Proposed & Ready share this one clock
    uint256 public dispatchDeadline;           // Funded must reach Shipped by this time
    uint256 public clearanceDeadline;          // Shipped must reach CustomsCleared by this time

    // ---- Storage: attestors + arbitrator (PERSON B & D territory) -----------
    address[3] public attestors;
    address public arbitrator;

    // ---- Events ---------------------------------------------------------------
    event EscrowAccepted(address indexed exporter);
    event EscrowFunded(uint256 amount);
    event StatusAttested(address indexed attestor, uint8 statusCode);
    event EscrowShipped();
    event EscrowCustomsCleared();
    event EscrowReleased(address indexed to, uint256 amount);
    event EscrowRefunded(address indexed to, uint256 amount);
    event EscrowDisputed();
    event DisputeResolved(State outcome);

    // ---- PERSON A: constructor + handshake + funding -------------------------
    constructor(
        address _exporter,
        uint256 _amount,
        string memory _consignmentId,
        uint256 _setupWindowSeconds,
        uint256 _dispatchWindowSeconds,
        uint256 _clearanceWindowSeconds,
        address[3] memory _attestors,
        address _arbitrator
    ) {
        // TODO (Person A): validate inputs, set importer/exporter/amount/
        // consignmentId, set state = Proposed, set setupDeadline.
        // Also store attestors/arbitrator/dispatchWindow/clearanceWindow for
        // later use by Persons B/C/D (don't compute their deadlines yet -
        // those start counting from Funded/Shipped, not from deployment).
    }

    function accept() external {
        // TODO (Person A): Proposed -> Ready. Only exporter, only before
        // setupDeadline. Emit EscrowAccepted.
    }

    function deposit() external payable {
        // TODO (Person A): Ready -> Funded. Only importer, msg.value must
        // equal `amount`, only before setupDeadline. Emit EscrowFunded.
        // This is also where dispatchDeadline should actually start
        // counting (block.timestamp + dispatchWindowSeconds at this moment).
    }

    // ---- PERSON B: attestation ------------------------------------------------
    function attest(uint8 statusCode, bytes32 recordHash) external {
        // TODO (Person B): only from one of the 3 attestors, only in Funded
        // (expecting statusCode 3/Shipped) or Shipped (expecting statusCode
        // 4/CustomsCleared) state. Track votes per (state, statusCode,
        // recordHash) triple. On reaching 2-of-3 matching votes, advance
        // state (Funded->Shipped or Shipped->CustomsCleared) and set
        // clearanceDeadline when entering Shipped. Emit StatusAttested and
        // EscrowShipped/EscrowCustomsCleared.
    }

    // ---- PERSON C: release, refund, incentives --------------------------------
    function withdraw() external {
        // TODO (Person C): only exporter, only from CustomsCleared.
        // Pay out `amount` (minus any attestor reward - decide with Person B
        // whether reward comes from a separate pool or off the top here).
        // Move to Released. Emit EscrowReleased.
    }

    function refund() external {
        // TODO (Person C): timeout paths only - Funded past dispatchDeadline,
        // or setupDeadline passed while still Proposed/Ready (nothing to
        // refund there, just let it go inert - see design notes on why an
        // unfunded expiry needs no transaction at all).
        // Emit EscrowRefunded.
    }

    // ---- PERSON D: disputes + arbitrator ---------------------------------------
    function resolveDispute(bool releaseToExporter) external {
        // TODO (Person D): only arbitrator, only from Disputed. Pays out to
        // whichever side, moves to Released or Refunded. Emit DisputeResolved.
    }

    // TODO (Person D): a way to ENTER Disputed - e.g. anyone can call
    // checkTimeout() and if clearanceDeadline has passed while still
    // Shipped, move to Disputed. Coordinate with Person B since attest()
    // also needs to know about this deadline.
}
