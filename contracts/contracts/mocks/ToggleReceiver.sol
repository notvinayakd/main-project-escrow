// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.34;

/// @dev Test helper. Accepts payments until `reject` is switched on, then
///      refuses every payment. Used to prove a hostile or broken fee
///      recipient cannot freeze an escrow.
contract ToggleReceiver {
    bool public reject;

    function setReject(bool value) external {
        reject = value;
    }

    receive() external payable {
        require(!reject, "ToggleReceiver: rejecting");
    }
}
