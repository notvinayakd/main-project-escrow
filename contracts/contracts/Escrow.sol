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
        Ready,            // 1 - exporter accepted, importer hasn't funded yet
        Funded,           // 2 - importer's POL is locked in the contract
        Shipped,          // 3 - 2-of-3 attestors confirmed dispatch
        CustomsCleared,  // 4 - 2-of-3 attestors confirmed clearance
        Released,        // 5 - exporter withdrew. Terminal.
        Refunded,        // 6 - importer repaid. Terminal.
        Disputed         // 7 - quorum failed or timeout hit. Arbitrator decides.
    }

    // ---- Storage: parties, money, timing ------------------------------------
    address public immutable importer;
    address public immutable exporter;
    uint256 public immutable amount;           // POL, in wei units
    string public consignmentId;

    State public state;
    uint256 public setupDeadline;              // Proposed & Ready share this one clock
    uint256 public dispatchDeadline;           // Funded must reach Shipped by this time
    uint256 public clearanceDeadline;          // Shipped must reach CustomsCleared by this time
    uint256 public dispatchWindowSeconds;      // remembered from constructor, used by deposit()
    uint256 public clearanceWindowSeconds;     // remembered from constructor, used by attest()

    // ---- Storage: attestors + arbitrator (PERSON B & D territory) ----------
    address[3] public attestors;
    address public arbitrator;

    // ---- Storage: convenience fee (NEW — flag to team before merging) -----
    address public immutable feeRecipient;
    uint256 public constant FEE_BPS = 200; // 2% = 200 basis points out of 10,000

    // ---- Events -------------------------------------------------------------
    event EscrowAccepted(address indexed exporter);
    event EscrowFunded(uint256 amount);
    event StatusAttested(address indexed attestor, uint8 statusCode);
    event EscrowShipped();
    event EscrowCustomsCleared();
    event EscrowReleased(address indexed to, uint256 amount);
    event EscrowRefunded(address indexed to, uint256 amount);
    event EscrowDisputed();
    event DisputeResolved(State outcome);

    // ---- PERSON A: constructor + handshake + funding -----------------------
    constructor(
        address _exporter,
        uint256 _amount,
        string memory _consignmentId,
        uint256 _setupWindowSeconds,
        uint256 _dispatchWindowSeconds,
        uint256 _clearanceWindowSeconds,
        address[3] memory _attestors,
        address _arbitrator,
        address _feeRecipient
    ) {
        require(_exporter != address(0), "Invalid exporter");
        require(_exporter != msg.sender, "Exporter cannot be importer");
        require(_amount > 0, "Amount must be greater than zero");
        require(bytes(_consignmentId).length > 0, "Empty consignmentId");
        require(_setupWindowSeconds > 0, "Invalid setup window");
        require(_dispatchWindowSeconds > 0, "Invalid dispatch window");
        require(_clearanceWindowSeconds > 0, "Invalid clearance window");
        require(_arbitrator != address(0), "Invalid arbitrator");
        require(_feeRecipient != address(0), "Invalid feeRecipient");

        for (uint256 i = 0; i < 3; i++) {
            require(_attestors[i] != address(0), "Invalid attestor");
        }

        require(_attestors[0] != _attestors[1], "Duplicate attestor");
        require(_attestors[0] != _attestors[2], "Duplicate attestor");
        require(_attestors[1] != _attestors[2], "Duplicate attestor");

        importer = msg.sender;
        exporter = _exporter;
        amount = _amount;
        consignmentId = _consignmentId;

        state = State.Proposed;
        setupDeadline = block.timestamp + _setupWindowSeconds;

        dispatchWindowSeconds = _dispatchWindowSeconds;
        clearanceWindowSeconds = _clearanceWindowSeconds;

        attestors = _attestors;
        arbitrator = _arbitrator;
        feeRecipient = _feeRecipient;
    }

    function accept() external {
        require(msg.sender == exporter, "Only exporter");
        require(state == State.Proposed, "Not proposed");
        require(block.timestamp <= setupDeadline, "Setup expired");

        state = State.Ready;
        emit EscrowAccepted(exporter);
    }

    // ---- deposit(): buyer pays `amount` into escrow + 2% fee on top ---------
    function deposit() external payable {
        require(msg.sender == importer, "Only importer");
        require(state == State.Ready, "Not ready");
        require(block.timestamp <= setupDeadline, "Setup expired");

        uint256 fee = (amount * FEE_BPS) / 10000;
        require(msg.value == amount + fee, "Incorrect amount");

        state = State.Funded;
        dispatchDeadline = block.timestamp + dispatchWindowSeconds;

        (bool sent, ) = feeRecipient.call{value: fee}("");
        require(sent, "Fee transfer failed");

        emit EscrowFunded(amount);
    }

    // ---- PERSON B: attestation ---------------------------------------------
    function attest(uint8 statusCode, bytes32 recordHash) external {
        // TODO (Person B): only from one of the 3 attestors, only in Funded
        // (expecting statusCode 3/Shipped) or Shipped (expecting statusCode
        // 4/CustomsCleared) state. Track votes per (state, statusCode,
        // recordHash) triple. On reaching 2-of-3 matching votes, advance
        // state (Funded->Shipped or Shipped->CustomsCleared) and set
        // clearanceDeadline when entering Shipped. Emit StatusAttested and
        // EscrowShipped/EscrowCustomsCleared.
    }

    // ---- PERSON C: release, refund, incentives -----------------------------

    function withdraw() external {
        require(
            msg.sender == exporter,
            "Only exporter can withdraw"
        );

        require(
            state == State.CustomsCleared,
            "Escrow not cleared"
        );

        // Mark the escrow as released before transferring funds.
        state = State.Released;

        // Transfer the full escrow amount to the exporter.
        // The 2% fee was already paid separately during deposit().
        (bool success, ) = payable(exporter).call{value: amount}("");

        require(
            success,
            "Transfer failed"
        );

        emit EscrowReleased(exporter, amount);
    }

    function refund() external {
        require(
            msg.sender == importer,
            "Only importer can refund"
        );

        require(
            state == State.Funded,
            "Refund not available"
        );

        require(
            block.timestamp > dispatchDeadline,
            "Dispatch deadline not passed"
        );

        // Mark the escrow as refunded before transferring funds.
        state = State.Refunded;

        // Return the full escrow amount to the importer.
        // The 2% fee was already paid separately during deposit().
        (bool success, ) = payable(importer).call{value: amount}("");

        require(
            success,
            "Transfer failed"
        );

        emit EscrowRefunded(importer, amount);
    }

    // ---- PERSON D: disputes + arbitrator ----------------------------------

    function resolveDispute(bool releaseToExporter) external {
        // TODO (Person D): only arbitrator, only from Disputed. Pays out to
        // whichever side, moves to Released or Refunded. Emit DisputeResolved.
    }

    // TODO (Person D): a way to ENTER Disputed - e.g. anyone can call
    // checkTimeout() and if clearanceDeadline has passed while still
    // Shipped, move to Disputed. Coordinate with Person B since attest()
    // also needs to know about this deadline.
}

