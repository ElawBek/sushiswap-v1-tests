// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./uniswapv2/interfaces/IUniswapV2Pair.sol";
import "./uniswapv2/interfaces/IUniswapV2Factory.sol";

// Migrate lp token to another lp contract
contract Migrator {
  // masterChef
  address public chef;
  // old uniV2 factory
  address public oldFactory;
  // new uniV2 factory
  IUniswapV2Factory public factory;
  // timeblock for migrate
  uint256 public notBeforeBlock;
  // approve for all
  uint256 public desiredLiquidity = uint256(-1);

  constructor(
    address _chef,
    address _oldFactory,
    IUniswapV2Factory _factory,
    uint256 _notBeforeBlock
  ) public {
    chef = _chef;
    oldFactory = _oldFactory;
    factory = _factory;
    notBeforeBlock = _notBeforeBlock;
  }

  function migrate(IUniswapV2Pair orig) public returns (IUniswapV2Pair) {
    require(msg.sender == chef, "not from master chef");

    require(block.number >= notBeforeBlock, "too early to migrate");

    require(orig.factory() == oldFactory, "not from old factory");

    address token0 = orig.token0();
    address token1 = orig.token1();

    // found exists pair
    IUniswapV2Pair pair = IUniswapV2Pair(factory.getPair(token0, token1));

    // if pair not exists => create new
    if (pair == IUniswapV2Pair(address(0))) {
      pair = IUniswapV2Pair(factory.createPair(token0, token1));
    }

    // msg.sender = MasterChef contract
    uint256 lp = orig.balanceOf(msg.sender);

    if (lp == 0) return pair;

    // migrate all allows assets
    desiredLiquidity = lp;

    // swap lp
    orig.transferFrom(msg.sender, address(orig), lp);
    orig.burn(address(pair));
    pair.mint(msg.sender);

    desiredLiquidity = uint256(-1);

    return pair;
  }
}
