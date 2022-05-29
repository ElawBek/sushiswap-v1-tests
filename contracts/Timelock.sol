// SPDX-License-Identifier: MIT

// XXX: pragma solidity ^0.5.16;
pragma solidity 0.6.12;

// XXX: import "./SafeMath.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

contract Timelock {
  using SafeMath for uint256;

  // Change admin
  event NewAdmin(address indexed newAdmin);

  // Change pending admin
  event NewPendingAdmin(address indexed newPendingAdmin);

  // Change delay
  event NewDelay(uint256 indexed newDelay);

  event CancelTransaction(
    bytes32 indexed txHash,
    address indexed target,
    uint256 value,
    string signature,
    bytes data,
    uint256 eta
  );

  event ExecuteTransaction(
    bytes32 indexed txHash,
    address indexed target,
    uint256 value,
    string signature,
    bytes data,
    uint256 eta
  );

  event QueueTransaction(
    bytes32 indexed txHash,
    address indexed target,
    uint256 value,
    string signature,
    bytes data,
    uint256 eta
  );

  // grace period: The time after which an accepted proposal cannot be executed anymore
  // constantly set to 14 days.
  uint256 public constant GRACE_PERIOD = 14 days;
  uint256 public constant MINIMUM_DELAY = 2 days;
  uint256 public constant MAXIMUM_DELAY = 30 days;

  address public admin;
  address public pendingAdmin;

  // delay: How many days one has to wait between a proposal being accepted
  // until it can be executed.
  // Can be changed by the governance to anywhere from two to 30 days.
  uint256 public delay;
  bool public admin_initialized;

  mapping(bytes32 => bool) public queuedTransactions;

  constructor(address admin_, uint256 delay_) public {
    require(
      delay_ >= MINIMUM_DELAY,
      "Timelock::constructor: Delay must exceed minimum delay."
    );

    require(
      delay_ <= MAXIMUM_DELAY,
      "Timelock::constructor: Delay must not exceed maximum delay."
    );

    // admin = GovernorAlpha address
    admin = admin_;
    // 2 days
    delay = delay_;
    admin_initialized = false;
  }

  // XXX: function() external payable { }
  receive() external payable {}

  function setDelay(uint256 delay_) public {
    require(
      msg.sender == address(this),
      "Timelock::setDelay: Call must come from Timelock."
    );

    require(
      delay_ >= MINIMUM_DELAY,
      "Timelock::setDelay: Delay must exceed minimum delay."
    );

    require(
      delay_ <= MAXIMUM_DELAY,
      "Timelock::setDelay: Delay must not exceed maximum delay."
    );

    delay = delay_;

    emit NewDelay(delay);
  }

  // pendingAdmin confirms yourself to admin
  function acceptAdmin() public {
    require(
      msg.sender == pendingAdmin,
      "Timelock::acceptAdmin: Call must come from pendingAdmin."
    );

    admin = msg.sender;
    pendingAdmin = address(0);

    emit NewAdmin(admin);
  }

  // only current admin can assign new admin
  function setPendingAdmin(address pendingAdmin_) public {
    // allows one time setting of admin for deployment purposes
    if (admin_initialized) {
      require(
        msg.sender == address(this),
        "Timelock::setPendingAdmin: Call must come from Timelock."
      );
    } else {
      require(
        msg.sender == admin,
        "Timelock::setPendingAdmin: First call must come from admin."
      );
      admin_initialized = true;
    }

    pendingAdmin = pendingAdmin_;

    emit NewPendingAdmin(pendingAdmin);
  }

  function queueTransaction(
    address target,
    uint256 value,
    string memory signature,
    bytes memory data,
    uint256 eta
  ) public returns (bytes32) {
    // admin = GovernorAlpha
    require(
      msg.sender == admin,
      "Timelock::queueTransaction: Call must come from admin."
    );

    require(
      eta >= getBlockTimestamp().add(delay),
      "Timelock::queueTransaction: Estimated execution block must satisfy delay."
    );

    // saving hash of tx
    bytes32 txHash = keccak256(abi.encode(target, value, signature, data, eta));
    queuedTransactions[txHash] = true;

    emit QueueTransaction(txHash, target, value, signature, data, eta);
    return txHash;
  }

  function cancelTransaction(
    address target,
    uint256 value,
    string memory signature,
    bytes memory data,
    uint256 eta
  ) public {
    require(
      msg.sender == admin,
      "Timelock::cancelTransaction: Call must come from admin."
    );

    bytes32 txHash = keccak256(abi.encode(target, value, signature, data, eta));
    queuedTransactions[txHash] = false;

    emit CancelTransaction(txHash, target, value, signature, data, eta);
  }

  function executeTransaction(
    address target,
    uint256 value,
    string memory signature,
    bytes memory data,
    uint256 eta
  ) public payable returns (bytes memory) {
    // admin = GovernorAlpha
    require(
      msg.sender == admin,
      "Timelock::executeTransaction: Call must come from admin."
    );

    bytes32 txHash = keccak256(abi.encode(target, value, signature, data, eta));
    require(
      queuedTransactions[txHash],
      "Timelock::executeTransaction: Transaction hasn't been queued."
    );

    // only after timelock
    require(
      getBlockTimestamp() >= eta,
      "Timelock::executeTransaction: Transaction hasn't surpassed time lock."
    );

    // if tx not stale
    require(
      getBlockTimestamp() <= eta.add(GRACE_PERIOD),
      "Timelock::executeTransaction: Transaction is stale."
    );

    // remove from queue
    queuedTransactions[txHash] = false;

    bytes memory callData;

    if (bytes(signature).length == 0) {
      callData = data;
    } else {
      // encode data with function signature
      callData = abi.encodePacked(bytes4(keccak256(bytes(signature))), data);
    }

    // execute tx
    (bool success, bytes memory returnData) = target.call.value(value)(
      callData
    );

    require(
      success,
      "Timelock::executeTransaction: Transaction execution reverted."
    );

    emit ExecuteTransaction(txHash, target, value, signature, data, eta);

    return returnData;
  }

  function getBlockTimestamp() internal view returns (uint256) {
    // solium-disable-next-line security/no-block-members
    return block.timestamp;
  }
}
