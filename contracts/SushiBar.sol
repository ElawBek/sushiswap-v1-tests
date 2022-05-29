// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

// SushiBar is the coolest bar in town. You come in with some Sushi, and leave with more! The longer you stay, the more Sushi you get.
//
// This contract handles swapping to and from xSushi, SushiSwap's staking token.

// All SUSHI from the SushiMaker are sent here
// over time the bar will accumulate more and more SUSHI
contract SushiBar is ERC20("SushiBar", "xSUSHI") {
  using SafeMath for uint256;

  IERC20 public sushi;

  // Define the Sushi token contract
  constructor(IERC20 _sushi) public {
    sushi = _sushi;
  }

  // Enter the bar. Pay some SUSHIs. Earn some shares.
  // Locks Sushi and mints xSushi
  function enter(uint256 _amount) public {
    // Gets the amount of Sushi locked in the contract
    uint256 totalSushi = sushi.balanceOf(address(this));

    // Gets the amount of xSushi in existence
    uint256 totalShares = totalSupply();

    // If no xSushi exists, mint it 1:1 to the amount put in
    if (totalShares == 0 || totalSushi == 0) {
      _mint(msg.sender, _amount);
    }
    // Calculate and mint the amount of xSushi the Sushi is worth.
    // The ratio will change overtime, as xSushi is burned/minted and Sushi deposited + gained from fees / withdrawn.
    else {
      // your transferred SUSHI * total xSUSHI supply / current balance of SUSHI
      // So if you send 10 SUSHI to the bar which already has 100 SUSHI in it and 200 xSUSHI total supply, you will receive 10 * 200 / 100 = 20 xSUSHI.
      uint256 what = _amount.mul(totalShares).div(totalSushi);

      _mint(msg.sender, what);
    }

    // Lock the Sushi in the contract
    sushi.transferFrom(msg.sender, address(this), _amount);
  }

  // Leave the bar. Claim back your SUSHIs.
  // Unclocks the staked + gained Sushi and burns xSushi

  // This will be at the minimum what you paid in,
  // but considering the bar will accumulate SUSHI over time,
  // it should be more than what you put originally in.
  function leave(uint256 _share) public {
    // Gets the amount of xSushi in existence
    uint256 totalShares = totalSupply();

    // Calculates the amount of Sushi the xSushi is worth
    // your transferred xSUSHI * current balance of SUSHI / total xSUSHI supply
    // So if you send 20 xSUSHI to the bar which has 100 SUSHI in it and 200 xSUSHI total supply, you will receive 20 * 100 / 200 = 10 SUSHI.
    uint256 what = _share.mul(sushi.balanceOf(address(this))).div(totalShares);

    _burn(msg.sender, _share);

    sushi.transfer(msg.sender, what);
  }
}
