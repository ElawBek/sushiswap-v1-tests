// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./uniswapv2/interfaces/IUniswapV2ERC20.sol";
import "./uniswapv2/interfaces/IUniswapV2Pair.sol";
import "./uniswapv2/interfaces/IUniswapV2Factory.sol";

// SushiMaker is MasterChef's left hand and kinda a wizard. He can cook up Sushi from pretty much anything!
//
// This contract handles "serving up" rewards for xSushi holders by trading tokens collected from fees for Sushi.

contract SushiMaker {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  IUniswapV2Factory public factory;
  address public bar;
  address public sushi;
  address public weth;

  constructor(
    IUniswapV2Factory _factory,
    address _bar,
    address _sushi,
    address _weth
  ) public {
    factory = _factory;
    sushi = _sushi;
    bar = _bar;
    weth = _weth;
  }

  function convert(address token0, address token1) public {
    // At least we try to make front-running harder to do.
    require(msg.sender == tx.origin, "do not convert from contract");
    IUniswapV2Pair pair = IUniswapV2Pair(factory.getPair(token0, token1));
    pair.transfer(address(pair), pair.balanceOf(address(this)));
    pair.burn(address(this));
    // First we convert everything to WETH
    uint256 wethAmount = _toWETH(token0) + _toWETH(token1);
    // Then we convert the WETH to Sushi
    _toSUSHI(wethAmount);
  }

  // Converts token passed as an argument to WETH
  function _toWETH(address token) internal returns (uint256) {
    // If the passed token is Sushi, don't convert anything
    if (token == sushi) {
      uint256 amount = IERC20(token).balanceOf(address(this));
      _safeTransfer(token, bar, amount);
      return 0;
    }
    // If the passed token is WETH, don't convert anything
    if (token == weth) {
      uint256 amount = IERC20(token).balanceOf(address(this));
      _safeTransfer(token, factory.getPair(weth, sushi), amount);
      return amount;
    }
    // If the target pair doesn't exist, don't convert anything
    IUniswapV2Pair pair = IUniswapV2Pair(factory.getPair(token, weth));
    if (address(pair) == address(0)) {
      return 0;
    }
    // Choose the correct reserve to swap from
    (uint256 reserve0, uint256 reserve1, ) = pair.getReserves();
    address token0 = pair.token0();
    (uint256 reserveIn, uint256 reserveOut) = token0 == token
      ? (reserve0, reserve1)
      : (reserve1, reserve0);
    // Calculate information required to swap
    uint256 amountIn = IERC20(token).balanceOf(address(this));
    uint256 amountInWithFee = amountIn.mul(997);
    uint256 numerator = amountInWithFee.mul(reserveOut);
    uint256 denominator = reserveIn.mul(1000).add(amountInWithFee);
    uint256 amountOut = numerator / denominator;
    (uint256 amount0Out, uint256 amount1Out) = token0 == token
      ? (uint256(0), amountOut)
      : (amountOut, uint256(0));
    // Swap the token for WETH
    _safeTransfer(token, address(pair), amountIn);
    pair.swap(
      amount0Out,
      amount1Out,
      factory.getPair(weth, sushi),
      new bytes(0)
    );
    return amountOut;
  }

  // Converts WETH to Sushi
  function _toSUSHI(uint256 amountIn) internal {
    IUniswapV2Pair pair = IUniswapV2Pair(factory.getPair(weth, sushi));
    // Choose WETH as input token
    (uint256 reserve0, uint256 reserve1, ) = pair.getReserves();
    address token0 = pair.token0();
    (uint256 reserveIn, uint256 reserveOut) = token0 == weth
      ? (reserve0, reserve1)
      : (reserve1, reserve0);
    // Calculate information required to swap
    uint256 amountInWithFee = amountIn.mul(997);
    uint256 numerator = amountInWithFee.mul(reserveOut);
    uint256 denominator = reserveIn.mul(1000).add(amountInWithFee);
    uint256 amountOut = numerator / denominator;
    (uint256 amount0Out, uint256 amount1Out) = token0 == weth
      ? (uint256(0), amountOut)
      : (amountOut, uint256(0));
    // Swap WETH for Sushi
    pair.swap(amount0Out, amount1Out, bar, new bytes(0));
  }

  // Wrapper for safeTransfer
  function _safeTransfer(
    address token,
    address to,
    uint256 amount
  ) internal {
    IERC20(token).safeTransfer(to, amount);
  }
}
