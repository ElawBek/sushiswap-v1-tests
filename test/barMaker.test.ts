import { expect } from "chai";
import { ethers } from "hardhat";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { constants } from "ethers";
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

const timestamp = ethers.BigNumber.from(1852640309);

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

    // mint 10000 TKN1 and TKN2 to owner for create WETH/TKN1 and WETH/TKN2 pairs
    await tokenOne.mint(owner.address, parseEther("10000"));
    await tokenTwo.mint(owner.address, parseEther("10000"));

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

    // mint sushi to owner account for create SUSHI/WETH pair
    await sushi.mint(owner.address, parseEther("1000"));

    // mint initial supply of sushi to users
    await sushi.mint(alice.address, parseEther("50"));
    await sushi.mint(bob.address, parseEther("50"));

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

    // Fee receiver on factory -> SushiMaker
    await factory.setFeeTo(maker.address);
  });

  describe("Stake", () => {
    let ercToErcPair: UniswapV2Pair;

    let sushiToWethPair: UniswapV2Pair;

    beforeEach(async () => {
      // allow router to use owner's tokens for create pairs
      await sushi.approve(router.address, parseEther("1000"));
      await tokenOne.approve(router.address, constants.MaxUint256);
      await tokenTwo.approve(router.address, constants.MaxUint256);

      // create pair 4 SUSHI = 1 ETHER
      await router.addLiquidityETH(
        sushi.address,
        parseEther("1000"),
        constants.Zero,
        constants.Zero,
        owner.address,
        timestamp,
        { value: parseEther("250") }
      );

      // create pair 100 TKN1 = 1 ETH
      await router.addLiquidityETH(
        tokenOne.address,
        parseEther("1000"),
        constants.Zero,
        constants.Zero,
        owner.address,
        timestamp,
        { value: parseEther("10") }
      );

      // create pair 100 TKN2 = 1 ETH
      await router.addLiquidityETH(
        tokenTwo.address,
        parseEther("1000"),
        constants.Zero,
        constants.Zero,
        owner.address,
        timestamp,
        { value: parseEther("10") }
      );

      // do sushi-weth pair contract callable (It can be useful)
      const createdSushiToWethPairAddress = await router.getPairAddress(
        sushi.address,
        weth.address
      );

      sushiToWethPair = new UniswapV2Pair__factory(owner).attach(
        createdSushiToWethPairAddress
      );

      // add initial liquidity to TKN1-TKN2 pair
      await tokenOne
        .connect(alice)
        .approve(router.address, constants.MaxUint256);

      await tokenTwo
        .connect(alice)
        .approve(router.address, constants.MaxUint256);

      await router
        .connect(alice)
        .addLiquidity(
          tokenOne.address,
          tokenTwo.address,
          parseEther("100"),
          parseEther("100"),
          constants.Zero,
          constants.Zero,
          alice.address,
          timestamp
        );

      // do TKN1-TKN2 pair contract callable
      const createdPair = await router.getPairAddress(
        tokenOne.address,
        tokenTwo.address
      );

      ercToErcPair = new UniswapV2Pair__factory(owner).attach(createdPair);
    });

    it("Simple enter and leave", async () => {
      // allow the SushiBar contract to use the Alice's and Bob's sushiToken
      await sushi.connect(alice).approve(bar.address, parseEther("50"));
      await sushi.connect(bob).approve(bar.address, parseEther("30"));

      // stake sushis in bar contract
      // received xSushi (first deposit) === deposited sushi

      expect(await bar.totalSupply()).to.be.eq(constants.Zero);
      expect(await sushi.balanceOf(bar.address)).to.be.eq(constants.Zero);

      await expect(() =>
        bar.connect(alice).enter(parseEther("50"))
      ).to.changeTokenBalance(bar, alice, parseEther("50"));

      // addition sushi to exists pool in bar contract
      // received xSushi === 30e18 * 50e18 / 50e18 = 30e18
      await expect(() =>
        bar.connect(bob).enter(parseEther("30"))
      ).to.changeTokenBalance(bar, bob, parseEther("30"));

      // Alice leave with half of own share
      // because users don't swaps and add/remove liquidity from pair,
      // leave Sushi === leave xSushi share
      await expect(() =>
        bar.connect(alice).leave(parseEther("25"))
      ).to.changeTokenBalance(sushi, alice, parseEther("25"));

      // Bob leave with all own share
      await expect(() =>
        bar.connect(bob).leave(parseEther("30"))
      ).to.changeTokenBalance(bar, bob, parseEther("-30"));
    });

    it("Leave from bar after any actions with pair", async () => {
      // allow the SushiBar contract to use the Alice's and Bob's sushiToken
      await sushi.connect(alice).approve(bar.address, parseEther("50"));
      await sushi.connect(bob).approve(bar.address, parseEther("30"));

      // stake sushis in bar contract
      // received xSushi === deposited sushi
      await expect(() =>
        bar.connect(alice).enter(parseEther("50"))
      ).to.changeTokenBalance(bar, alice, parseEther("50"));

      await expect(() =>
        bar.connect(bob).enter(parseEther("30"))
      ).to.changeTokenBalance(bar, bob, parseEther("30"));

      // Bob swap TKN2 to TKN1
      await tokenTwo.connect(bob).approve(router.address, parseEther("35"));

      // (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
      // (35e18 * 997 * 100e18) / (100e18 * 1000 + 35e18 * 997) =
      // 25.868267912079765743
      await expect(() =>
        router
          .connect(bob)
          .swapExactTokensForTokens(
            parseEther("35"),
            parseEther("10"),
            [tokenTwo.address, tokenOne.address],
            bob.address,
            timestamp
          )
      ).to.changeTokenBalance(
        tokenOne,
        bob,
        parseEther("25.868267912079765743")
      );

      await ercToErcPair
        .connect(alice)
        .approve(router.address, parseEther("5"));

      // after swap add some liquidity. Maker contract receive some fee
      await router
        .connect(alice)
        .addLiquidity(
          tokenOne.address,
          tokenTwo.address,
          parseEther("44"),
          parseEther("80"),
          constants.Zero,
          constants.Zero,
          alice.address,
          timestamp
        );

      // check fee
      // 0.006483162546615916
      // console.log(
      // `pairToken: ${await ercToErcPair.balanceOf(maker.address)}, `
      // );

      // 80.000000000000000000
      // console.log(`Sushi before: ${await sushi.balanceOf(bar.address)}`);

      // convert LP token on maker contract to SUSHI and transfer to bar
      await maker.connect(alice).convert(tokenOne.address, tokenTwo.address);

      // 80.000539045692336681
      // console.log(`Sushi after: ${await sushi.balanceOf(bar.address)}`);

      // Alice after leave from bar should receive more sushis
      // share * sushi balance of bar / total xSushi
      // 50e18 * 80.000539045692336681e18 / 80e18 = 50.000336903557710425e18
      await expect(() =>
        bar.connect(alice).leave(parseEther("50"))
      ).to.changeTokenBalance(
        sushi,
        alice,
        parseEther("50.000336903557710425")
      );
    });
  });
});
