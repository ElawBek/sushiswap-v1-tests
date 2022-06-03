import { expect } from "chai";
import { ethers } from "hardhat";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { BigNumber, constants } from "ethers";
import { parseEther } from "ethers/lib/utils";

import {
  WETH,
  WETH__factory,
  MockERC20,
  MockERC20__factory,
  UniswapV2Factory,
  UniswapV2Factory__factory,
  UniswapV2Router02,
  UniswapV2Router02__factory,
  UniswapV2Pair,
  UniswapV2Pair__factory,
  SushiToken,
  SushiToken__factory,
  MasterChef,
  MasterChef__factory,
  SushiBar,
  SushiBar__factory,
  SushiMaker,
  SushiMaker__factory,
} from "../typechain-types";

describe("app", () => {
  // Signers
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let weth: WETH;

  // tokens for tests
  let tokenOne: MockERC20;
  let tokenTwo: MockERC20;

  // sushi factory
  let factory: UniswapV2Factory;

  // sushi router
  let router: UniswapV2Router02;

  let sushi: SushiToken;

  let chef: MasterChef;

  let bar: SushiBar;

  let maker: SushiMaker;

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();

    // deploy local weth
    weth = await new WETH__factory(owner).deploy();

    tokenOne = await new MockERC20__factory(owner).deploy("One", "TKN1");
    tokenTwo = await new MockERC20__factory(owner).deploy("Two", "TKN2");

    // mint 10000 TKN1 and TKN2 for users
    await tokenOne.mint(alice.address, parseEther("10000"));
    await tokenTwo.mint(alice.address, parseEther("10000"));

    await tokenOne.mint(bob.address, parseEther("10000"));
    await tokenTwo.mint(bob.address, parseEther("10000"));

    factory = await new UniswapV2Factory__factory(owner).deploy(owner.address);

    router = await new UniswapV2Router02__factory(owner).deploy(
      factory.address,
      weth.address
    );

    // sushiswap
    sushi = await new SushiToken__factory(owner).deploy();
    // just first test, args - random
    chef = await new MasterChef__factory(owner).deploy(
      sushi.address,
      owner.address, // devaddr
      parseEther("10"), // Sushi per block
      0, // start block
      2 // end bonus block
    );

    // owner of sushiToken -> MasterChef
    await sushi.transferOwnership(chef.address);

    bar = await new SushiBar__factory(owner).deploy(sushi.address);

    maker = await new SushiMaker__factory(owner).deploy(
      factory.address,
      bar.address,
      sushi.address,
      weth.address
    );

    // Fee receiver -> SushiMaker
    await factory.setFeeTo(maker.address);
  });
});
