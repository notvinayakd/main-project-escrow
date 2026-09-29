// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.34;

/// @title TrustLC Escrow
/// @notice Blockchain-based Letter of Credit escrow with
///         attestation, staking, dispute resolution and timeout backstops.
contract Escrow {
    enum State {
        Proposed,
        Ready,
        Funded,
        Shipped,
        CustomsCleared,
        Released,
        Refunded,
        Disputed
    }

    address public immutable importer;
    address public immutable exporter;
    uint256 public immutable amount;
    string public consignmentId;

    State public state;

    uint256 public setupDeadline;
    uint256 public dispatchDeadline;
    uint256 public clearanceDeadline;
    uint256 public arbitrationDeadline;

    uint256 public dispatchWindowSeconds;
    uint256 public clearanceWindowSeconds;
    uint256 public arbitrationWindowSeconds;

    address[3] public attestors;
    address public arbitrator;

    mapping(bytes32 => uint8) public voteCounts;
    mapping(bytes32 => mapping(address => bool)) public hasVoted;

    address public immutable feeRecipient;

    // Platform fee = 2%
    uint256 public constant FEE_BPS = 200;

    // Arbitrator fee = 2% of the escrow amount
    uint256 public constant ARBITRATOR_FEE_BPS = 200;

    // Each attestor must stake 1 POL
    uint256 public constant REQUIRED_STAKE = 1 ether;

    // 20% of stake is slashed if the shipment times out
    uint256 public constant SLASH_BPS = 2000;

    // Each attestor can support an escrow worth at most
    // twice the required stake.
    uint256 public constant STAKE_TO_ESCROW_MULTIPLIER = 2;

    mapping(address => uint256) public attestorStake;

    event EscrowAccepted(address indexed exporter);
    event EscrowFunded(uint256 amount);

    event StatusAttested(
        address indexed attestor,
        uint8 statusCode
    );

    event EscrowShipped();
    event EscrowCustomsCleared();

    event EscrowReleased(
        address indexed to,
        uint256 amount
    );

    event EscrowRefunded(
        address indexed to,
        uint256 amount
    );

    event EscrowDisputed();

    event DisputeResolved(State outcome);

    event AttestorStaked(
        address indexed attestor,
        uint256 amount
    );

    event AttestorSlashed(
        address indexed attestor,
        uint256 amount
    );

    event AttestorStakeWithdrawn(
        address indexed attestor,
        uint256 amount
    );

    event ForcedDisputeResolution(
        State outcome
    );

    constructor(
        address _exporter,
        uint256 _amount,
        string memory _consignmentId,
        uint256 _setupWindowSeconds,
        uint256 _dispatchWindowSeconds,
        uint256 _clearanceWindowSeconds,
        address[3] memory _attestors,
        address _arbitrator,
        address _feeRecipient,
        uint256 _arbitrationWindowSeconds
    ) {
        require(
            _exporter != address(0),
            "Invalid exporter"
        );

        require(
            _exporter != msg.sender,
            "Exporter cannot be importer"
        );

        require(
            _amount > 0,
            "Amount must be greater than zero"
        );

        require(
            _amount <= REQUIRED_STAKE * STAKE_TO_ESCROW_MULTIPLIER,
            "Escrow exceeds stake cap"
        );

        require(
            bytes(_consignmentId).length > 0,
            "Empty consignmentId"
        );

        require(
            _setupWindowSeconds > 0,
            "Invalid setup window"
        );

        require(
            _dispatchWindowSeconds > 0,
            "Invalid dispatch window"
        );

        require(
            _clearanceWindowSeconds > 0,
            "Invalid clearance window"
        );

        require(
            _arbitrationWindowSeconds > 0,
            "Invalid arbitration window"
        );

        require(
            _arbitrator != address(0),
            "Invalid arbitrator"
        );

        require(
            _feeRecipient != address(0),
            "Invalid feeRecipient"
        );

        for (uint256 i = 0; i < 3; i++) {
            require(
                _attestors[i] != address(0),
                "Invalid attestor"
            );
        }

        require(
            _attestors[0] != _attestors[1],
            "Duplicate attestor"
        );

        require(
            _attestors[0] != _attestors[2],
            "Duplicate attestor"
        );

        require(
            _attestors[1] != _attestors[2],
            "Duplicate attestor"
        );

        importer = msg.sender;
        exporter = _exporter;
        amount = _amount;
        consignmentId = _consignmentId;

        state = State.Proposed;

        setupDeadline =
            block.timestamp +
            _setupWindowSeconds;

        dispatchWindowSeconds =
            _dispatchWindowSeconds;

        clearanceWindowSeconds =
            _clearanceWindowSeconds;

        arbitrationWindowSeconds =
            _arbitrationWindowSeconds;

        attestors = _attestors;

        arbitrator = _arbitrator;

        feeRecipient = _feeRecipient;
    }

    // =============================================================
    //                    ATTESTOR STAKING
    // =============================================================

    function stakeAsAttestor() external payable {
        require(
            msg.sender == attestors[0] ||
            msg.sender == attestors[1] ||
            msg.sender == attestors[2],
            "Only an attestor may stake"
        );

        require(
            attestorStake[msg.sender] == 0,
            "Already staked"
        );

        require(
            msg.value == REQUIRED_STAKE,
            "Incorrect stake amount"
        );

        attestorStake[msg.sender] = msg.value;

        emit AttestorStaked(
            msg.sender,
            msg.value
        );
    }

    function withdrawStake() external {
        require(
            msg.sender == attestors[0] ||
            msg.sender == attestors[1] ||
            msg.sender == attestors[2],
            "Only an attestor"
        );

        require(
            state == State.Released ||
            state == State.Refunded,
            "Escrow not finished"
        );

        uint256 stake = attestorStake[msg.sender];

        require(
            stake > 0,
            "No stake"
        );

        attestorStake[msg.sender] = 0;

        (bool success, ) =
            payable(msg.sender).call{value: stake}("");

        require(
            success,
            "Stake transfer failed"
        );

        emit AttestorStakeWithdrawn(
            msg.sender,
            stake
        );
    }

    // =============================================================
    //                       ESCROW FLOW
    // =============================================================

    function accept() external {
        require(
            msg.sender == exporter,
            "Only exporter"
        );

        require(
            state == State.Proposed,
            "Not proposed"
        );

        require(
            block.timestamp <= setupDeadline,
            "Setup expired"
        );

        state = State.Ready;

        emit EscrowAccepted(exporter);
    }

    function deposit() external payable {
        require(
            msg.sender == importer,
            "Only importer"
        );

        require(
            state == State.Ready,
            "Not ready"
        );

        require(
            block.timestamp <= setupDeadline,
            "Setup expired"
        );

        uint256 fee =
            (amount * FEE_BPS) /
            10000;

        require(
            msg.value == amount + fee,
            "Incorrect amount"
        );

        state = State.Funded;

        dispatchDeadline =
            block.timestamp +
            dispatchWindowSeconds;

        (bool sent, ) =
            feeRecipient.call{value: fee}("");

        require(
            sent,
            "Fee transfer failed"
        );

        emit EscrowFunded(amount);
    }

    // =============================================================
    //                       ATTESTATION
    // =============================================================

    function attest(
        uint8 statusCode,
        bytes32 recordHash
    ) external {
        require(
            msg.sender == attestors[0] ||
            msg.sender == attestors[1] ||
            msg.sender == attestors[2],
            "Only an attestor may attest"
        );

        require(
            attestorStake[msg.sender] >= REQUIRED_STAKE,
            "Attestor stake required"
        );

        require(
            state == State.Funded ||
            state == State.Shipped,
            "Not awaiting attestation"
        );

        if (state == State.Funded) {
            require(
                statusCode == 3 ||
                statusCode == 99,
                "Unexpected statusCode for Funded"
            );
        } else {
            require(
                statusCode == 4 ||
                statusCode == 99,
                "Unexpected statusCode for Shipped"
            );
        }

        bytes32 key =
            keccak256(
                abi.encodePacked(
                    state,
                    statusCode,
                    recordHash
                )
            );

        require(
            !hasVoted[key][msg.sender],
            "Already attested to this"
        );

        hasVoted[key][msg.sender] = true;

        voteCounts[key] += 1;

        emit StatusAttested(
            msg.sender,
            statusCode
        );

        if (voteCounts[key] < 2) {
            return;
        }

        if (statusCode == 99) {
            state = State.Disputed;

            arbitrationDeadline =
                block.timestamp +
                arbitrationWindowSeconds;

            emit EscrowDisputed();
        }
        else if (state == State.Funded) {
            state = State.Shipped;

            clearanceDeadline =
                block.timestamp +
                clearanceWindowSeconds;

            emit EscrowShipped();
        }
        else {
            state = State.CustomsCleared;

            emit EscrowCustomsCleared();
        }
    }

    // =============================================================
    //                         PAYOUT
    // =============================================================

    function withdraw() external {
        require(
            msg.sender == exporter,
            "Only exporter can withdraw"
        );

        // UCP 600 payout:
        // exporter may receive payment once shipment is confirmed.
        require(
            state == State.Shipped ||
            state == State.CustomsCleared,
            "Escrow not shipped"
        );

        state = State.Released;

        (bool success, ) =
            payable(exporter).call{value: amount}("");

        require(
            success,
            "Transfer failed"
        );

        emit EscrowReleased(
            exporter,
            amount
        );
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

        state = State.Refunded;

        (bool success, ) =
            payable(importer).call{value: amount}("");

        require(
            success,
            "Transfer failed"
        );

        emit EscrowRefunded(
            importer,
            amount
        );
    }

    // =============================================================
    //                       DISPUTE RESOLUTION
    // =============================================================

    function resolveDispute(
        bool releaseToExporter
    ) external {
        require(
            msg.sender == arbitrator,
            "Only arbitrator"
        );

        require(
            state == State.Disputed,
            "Not disputed"
        );

        uint256 arbitratorFee =
            (amount * ARBITRATOR_FEE_BPS) /
            10000;

        uint256 payout =
            amount - arbitratorFee;

        // Pay arbitrator fee first.
        if (arbitratorFee > 0) {
            (bool feeSent, ) =
                payable(arbitrator).call{
                    value: arbitratorFee
                }("");

            require(
                feeSent,
                "Arbitrator fee transfer failed"
            );
        }

        if (releaseToExporter) {
            state = State.Released;

            (bool success, ) =
                payable(exporter).call{
                    value: payout
                }("");

            require(
                success,
                "Transfer failed"
            );

            emit EscrowReleased(
                exporter,
                payout
            );
        }
        else {
            state = State.Refunded;

            (bool success, ) =
                payable(importer).call{
                    value: payout
                }("");

            require(
                success,
                "Transfer failed"
            );

            emit EscrowRefunded(
                importer,
                payout
            );
        }

        emit DisputeResolved(state);
    }

    // =============================================================
    //                 ARBITRATOR NEVER ACTS BACKSTOP
    // =============================================================

    function forceResolveDispute() external {
        require(
            state == State.Disputed,
            "Not disputed"
        );

        require(
            block.timestamp > arbitrationDeadline,
            "Arbitration deadline not passed"
        );

        // If the arbitrator does nothing,
        // the importer gets the escrow amount back.
        state = State.Refunded;

        (bool success, ) =
            payable(importer).call{value: amount}("");

        require(
            success,
            "Transfer failed"
        );

        emit EscrowRefunded(
            importer,
            amount
        );

        emit ForcedDisputeResolution(
            State.Refunded
        );
    }

    // =============================================================
    //                         TIMEOUT
    // =============================================================

    function checkTimeout() external {
        require(
            state == State.Shipped,
            "Not shipped"
        );

        require(
            block.timestamp > clearanceDeadline,
            "Clearance deadline not passed"
        );

        state = State.Disputed;

        arbitrationDeadline =
            block.timestamp +
            arbitrationWindowSeconds;

        // Slash every registered attestor because
        // the attestation process failed to produce
        // a completed shipment outcome before timeout.
        for (uint256 i = 0; i < 3; i++) {
            address attestor = attestors[i];

            uint256 stake =
                attestorStake[attestor];

            if (stake > 0) {
                uint256 slashAmount =
                    (stake * SLASH_BPS) /
                    10000;

                attestorStake[attestor] =
                    stake - slashAmount;

                if (slashAmount > 0) {
                    (bool sent, ) =
                        payable(feeRecipient).call{
                            value: slashAmount
                        }("");

                    require(
                        sent,
                        "Slash transfer failed"
                    );

                    emit AttestorSlashed(
                        attestor,
                        slashAmount
                    );
                }
            }
        }

        emit EscrowDisputed();
    }
}