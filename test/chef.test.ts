import { expect } from "chai";
import { ethers, network } from "hardhat";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { BigNumber, constants } from "ethers";
import { parseEther, formatEther } from "ethers/lib/utils";

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

    // mint initial supply of sushi to users for add to SUSHI/WETH pair
    await sushi.mint(alice.address, parseEther("500"));
    await sushi.mint(bob.address, parseEther("500"));

    chef = await new MasterChef__factory(owner).deploy(
      sushi.address,
      owner.address, // devaddr
      parseEther("10"), // Sushi per block
      0, // start block
      250 // end bonus block
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

  describe("Chef", () => {
    let tkn1ToTkn2Pair: UniswapV2Pair;

    let sushiToWethPair: UniswapV2Pair;

    beforeEach(async () => {
      // allow router to use owner's sushis for create pairs
      await sushi.approve(router.address, parseEther("1000"));

      // allow router to use Alice's and Bob's sushis for add liquidity
      await sushi.connect(alice).approve(router.address, parseEther("500"));
      await sushi.connect(bob).approve(router.address, parseEther("500"));

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

      // Alice's LP = 250
      await router
        .connect(alice)
        .addLiquidityETH(
          sushi.address,
          parseEther("500"),
          constants.Zero,
          constants.Zero,
          alice.address,
          timestamp,
          { value: parseEther("125") }
        );

      // Bob's LP = 250
      await router
        .connect(bob)
        .addLiquidityETH(
          sushi.address,
          parseEther("500"),
          constants.Zero,
          constants.Zero,
          bob.address,
          timestamp,
          { value: parseEther("125") }
        );

      // do sushi-weth pair contract callable (It can be useful)
      const createdSushiToWethPairAddress = await router.getPairAddress(
        sushi.address,
        weth.address
      );

      sushiToWethPair = new UniswapV2Pair__factory(owner).attach(
        createdSushiToWethPairAddress
      );

      // add liquidity to TKN1-TKN2 pair
      // allow for Router to use Alice's TKN1 and TKN2
      await tokenOne
        .connect(alice)
        .approve(router.address, constants.MaxUint256);

      await tokenTwo
        .connect(alice)
        .approve(router.address, constants.MaxUint256);

      // allow for Router to use Bob's TKN1 and TKN2
      await tokenOne.connect(bob).approve(router.address, constants.MaxUint256);

      await tokenTwo.connect(bob).approve(router.address, constants.MaxUint256);

      // Alice's LP-Tokens = 99.999999999999999000
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

      // Bob's Lp-Tokens = 100.000000000000000000
      await router
        .connect(bob)
        .addLiquidity(
          tokenOne.address,
          tokenTwo.address,
          parseEther("100"),
          parseEther("100"),
          constants.Zero,
          constants.Zero,
          bob.address,
          timestamp
        );

      // do TKN1-TKN2 pair contract callable
      const createdPair = await router.getPairAddress(
        tokenOne.address,
        tokenTwo.address
      );

      tkn1ToTkn2Pair = new UniswapV2Pair__factory(owner).attach(createdPair);
    });

    it("Add pools to Chef and change its allocPoint", async () => {
      // not owner can't call this function
      await expect(
        chef.connect(alice).add(parseEther("1"), tkn1ToTkn2Pair.address, false)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      // add TKN1 - TKN2 pool to chef contract
      await chef.add(
        parseEther("1"), //  allocPoint
        tkn1ToTkn2Pair.address, //  lpToken,
        false //  withUpdate
      );

      // check poolInfo with poolId === 0
      let poolInfo = await chef.poolInfo(0);

      expect(poolInfo.lpToken).to.be.eq(tkn1ToTkn2Pair.address);
      expect(poolInfo.allocPoint).to.be.eq(parseEther("1"));
      expect(poolInfo.accSushiPerShare).to.be.eq(constants.Zero);

      // check length of pool array in chef contract
      expect(await chef.poolLength()).to.be.eq(constants.One);

      expect(await chef.totalAllocPoint()).to.be.eq(parseEther("1"));

      // add SUSHI - WETH pool to chef contract
      await chef.add(
        parseEther("4"), //  allocPoint
        sushiToWethPair.address, //  lpToken,
        false //  withUpdate
      );

      // check increase totalAllocPoint after create new pool in chef contract
      expect(await chef.totalAllocPoint()).to.be.eq(parseEther("5"));

      // change allocPoint for TKN1-TKN2 pool to 1.5
      await chef.set(constants.Zero, parseEther("1.5"), false);
      poolInfo = await chef.poolInfo(0);

      expect(poolInfo.allocPoint).to.be.eq(parseEther("1.5"));
      expect(await chef.totalAllocPoint()).to.be.eq(parseEther("5.5"));
    });

    describe("Actions with users", () => {
      beforeEach(async () => {
        // add TKN1 - TKN2 pool to chef contract
        await chef.add(
          parseEther("1"), //  allocPoint
          tkn1ToTkn2Pair.address, //  lpToken,
          false //  withUpdate
        );

        // add SUSHI - WETH pool to chef contract
        await chef.add(
          parseEther("4"), //  allocPoint
          sushiToWethPair.address, //  lpToken,
          false //  withUpdate
        );
      });

      it("Deposit LPs and withdraw rewards", async () => {
        // ALice deposit all own LP TKN1-TKN2 to chef
        const aliceLP = parseEther("99.999999999999999000");

        await tkn1ToTkn2Pair.connect(alice).approve(chef.address, aliceLP);

        await expect(chef.connect(alice).deposit(0, aliceLP))
          .to.emit(chef, "Deposit")
          .withArgs(alice.address, 0, aliceLP);

        // initial deposit
        // accSushiPerShare in TKN1-TKN2 pool === 0
        expect((await chef.poolInfo(0)).accSushiPerShare).to.be.eq(
          constants.Zero
        );

        // Bob deposit all own LP TKN1-TKN2 to chef
        const bobLP = parseEther("100");

        await tkn1ToTkn2Pair.connect(bob).approve(chef.address, bobLP);

        await expect(chef.connect(bob).deposit(0, bobLP))
          .to.emit(chef, "Deposit")
          .withArgs(bob.address, 0, bobLP);

        // second deposit:
        /*
          in function updatePool:
            (before 250 block multiplier exists)
            sushiReward = multiplier * sushiPerBlock * pool.allocPoint / totalAllocPoint
            sushiReward = 20 * 10e18 * 1e18 / 5e18 = 40e18

            pool.accSushiPerShare = (pool.accSushiPerShare + sushiReward) * 1e12 / lpSupply
            pool.accSushiPerShare = (0 + 40e18) * 1e12 / 99.999999999999999000e18 =
            = 400000000000
       */
        expect((await chef.poolInfo(0)).accSushiPerShare).to.be.eq(
          BigNumber.from("400000000000")
        );

        // after 10 blocks
        await network.provider.send("hardhat_mine", ["0xa"]);

        // Alice withdraw own reward:
        /*
        in function updatePool:
          (before 250 block multiplier exists)
          sushiReward = multiplier * sushiPerBlock * pool.allocPoint / totalAllocPoint
          sushiReward = 110 * 10e18 * 1e18 / 5e18 = 220e18

          pool.accSushiPerShare = (pool.accSushiPerShare + sushiReward) * 1e12 / lpSupply
          pool.accSushiPerShare = 400000000000 + (220e18 * 1e12 / 199.999999999999999000e18)
          = 1500000000000

        in function withdraw:
          pending = user.amount * pool.accSushiPerShare / 1e12 - user.rewardDebt
          pending = 99.999999999999999000e18 * 1500000000000 / 1e12 - 0 =
          = 149.999999999999998500
        */

        await expect(() => chef.connect(alice).withdraw(0, 0))
          .to.emit(chef, "Withdraw")
          .to.changeTokenBalance(
            sushi,
            alice,
            parseEther("149.999999999999998500")
          );
      });

      it("With repeated deposit user should claim rewards", async () => {
        // Alice deposit half of own SUSHI-WETH LPs
        const aliceLP = parseEther("125");

        await sushiToWethPair.connect(alice).approve(chef.address, aliceLP);

        await chef.connect(alice).deposit(1, aliceLP);

        // repeat deposit after 10 blocks
        await network.provider.send("hardhat_mine", ["0xa"]);

        // 1 block
        await sushiToWethPair.connect(alice).approve(chef.address, aliceLP);

        // multiplier from lastRewardBlock to currentPendingBlock === 120
        expect(
          await chef.getMultiplier(
            (
              await chef.poolInfo(1)
            ).lastRewardBlock,
            (await ethers.provider.getBlockNumber()) + 1
          )
        ).to.be.eq(120);

        // calculate user's reward from lastRewardBlock to lastMinedBlock
        expect(await chef.pendingSushi(1, alice.address)).to.be.eq(
          parseEther("880")
        );

        /*
        in function updatePool:
          (before 250 block multiplier exists)
          sushiReward = multiplier * sushiPerBlock * pool.allocPoint / totalAllocPoint
          sushiReward = 120 * 10e18 * 4e18 / 5e18 = 960e18

          pool.accSushiPerShare = (pool.accSushiPerShare + sushiReward) * 1e12 / lpSupply
          pool.accSushiPerShare = 0 + (960e18 * 1e12 / 125e18) =
          = 7680000000000

        in function withdraw:
          pending = user.amount * pool.accSushiPerShare / 1e12 - user.rewardDebt
          pending = 125e18 * 7680000000000 / 1e12 - 0 =
          = 960e18
        */
        await expect(() =>
          chef.connect(alice).deposit(1, aliceLP)
        ).to.changeTokenBalance(sushi, alice, parseEther("960"));
      });

      it("Change dev address", async () => {
        await expect(chef.connect(alice).dev(alice.address)).to.be.revertedWith(
          "dev: wut?"
        );

        await chef.dev(alice.address);

        expect(await chef.devaddr()).to.be.eq(alice.address);
      });

      it("Emergency withdraw", async () => {
        // Alice deposit some LP TKN1-TKN2
        await tkn1ToTkn2Pair
          .connect(alice)
          .approve(chef.address, parseEther("50"));

        await chef.connect(alice).deposit(0, parseEther("50"));

        // After 10 blocks Alice emergency withdraw all own liquidity
        await network.provider.send("hardhat_mine", ["0xa"]);

        // user reward === 200 SUSHI
        const sushiBeforeEmergencyWithdraw = await sushi.balanceOf(
          alice.address
        );

        await expect(() => chef.connect(alice).emergencyWithdraw(0))
          .to.emit(chef, "EmergencyWithdraw")
          .withArgs(alice.address, 0, parseEther("50"))
          .to.changeTokenBalance(tkn1ToTkn2Pair, alice, parseEther("50"));

        const sushiAfterEmergencyWithdraw = await sushi.balanceOf(
          alice.address
        );

        // The reward was not withdrawn
        expect(sushiBeforeEmergencyWithdraw).to.be.eq(
          sushiAfterEmergencyWithdraw
        );
      });
    });
  });
});
