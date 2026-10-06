// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.34;

interface IEscrowResolve {
    function resolveDispute(bool releaseToExporter) external;
}

/// @title ReentrantArbitrator
/// @notice TEST-ONLY mock. An arbitrator that is a contract and tries to call
///         resolveDispute() again while it is being paid its fee. Used to prove
///         that Escrow.resolveDispute() cannot be re-entered.
contract ReentrantArbitrator {
    IEscrowResolve public escrow;

    // Re-entry attempts that SUCCEEDED (must stay 0 on a safe Escrow).
    uint256 public reentries;
    // Re-entry attempts that were REJECTED by the Escrow.
    uint256 public blockedReentries;

    function attack(address escrowAddress, bool releaseToExporter) external {
        escrow = IEscrowResolve(escrowAddress);
        escrow.resolveDispute(releaseToExporter);
    }

    receive() external payable {
        try escrow.resolveDispute(true) {
            reentries++;
        } catch {
            blockedReentries++;
        }
    }
}
