import { expect } from "chai";
import { ethers, network } from "hardhat";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { constants } from "ethers";
import { parseEther } from "ethers/lib/utils";

import { signERC2612Permit } from "eth-permit";

import {
  WETH,
  WETH__factory,
  UniswapV2Factory,
  UniswapV2Factory__factory,
  UniswapV2Pair,
  UniswapV2Pair__factory,
  UniswapV2Router02,
  UniswapV2Router02__factory,
  MockERC20,
  MockERC20__factory,
  SushiToken,
  SushiToken__factory,
  MasterChef,
  MasterChef__factory,
  Migrator,
  Migrator__factory,
  SushiRoll,
  SushiRoll__factory,
} from "../typechain-types";

describe("Migratory", () => {
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let weth: WETH;

  let tokenOne: MockERC20;
  let tokenTwo: MockERC20;

  // uniswap
  let uniFactory: UniswapV2Factory;
  let uniRouter: UniswapV2Router02;

  // sushiswap
  let oldSushiFactory: UniswapV2Factory;
  let oldSushiRouter: UniswapV2Router02;
  let sushiFactory: UniswapV2Factory;
  let sushiRouter: UniswapV2Router02;

  let sushi: SushiToken;

  let chef: MasterChef;

  let migrator: Migrator;

  let roll: SushiRoll;

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();

    // deploy local WETH
    weth = await new WETH__factory(owner).deploy();

    // deploy two tokens for pair create
    tokenOne = await new MockERC20__factory(owner).deploy("TokenOne", "TKN1");
    tokenTwo = await new MockERC20__factory(owner).deploy("TokenTwo", "TKN2");

    // mint 1000 TKN1 and TKN2 for users
    await tokenOne.mint(alice.address, parseEther("1000"));
    await tokenTwo.mint(alice.address, parseEther("1000"));

    await tokenOne.mint(bob.address, parseEther("1000"));
    await tokenTwo.mint(bob.address, parseEther("1000"));

    // deploy uniswap's contracts
    uniFactory = await new UniswapV2Factory__factory(owner).deploy(
      constants.AddressZero
    );
    uniRouter = await new UniswapV2Router02__factory(owner).deploy(
      uniFactory.address,
      weth.address
    );

    // deploy sushiswap's contracts
    oldSushiFactory = await new UniswapV2Factory__factory(owner).deploy(
      owner.address
    );
    oldSushiRouter = await new UniswapV2Router02__factory(owner).deploy(
      oldSushiFactory.address,
      weth.address
    );

    sushiFactory = await new UniswapV2Factory__factory(owner).deploy(
      owner.address
    );
    sushiRouter = await new UniswapV2Router02__factory(owner).deploy(
      sushiFactory.address,
      weth.address
    );

    sushi = await new SushiToken__factory(owner).deploy();

    // mint sushi to owner account for create SUSHI/WETH pair
    await sushi.mint(owner.address, parseEther("1000"));

    chef = await new MasterChef__factory(owner).deploy(
      sushi.address,
      owner.address, // devaddr
      parseEther("10"), // sushiPerBlock
      10, // startBlock
      200 //  bonesEndBlock
    );

    // owner of sushiToken -> MasterChef
    await sushi.transferOwnership(chef.address);

    // deploy migrator contracts
    migrator = await new Migrator__factory(owner).deploy(
      chef.address,
      oldSushiFactory.address,
      sushiFactory.address,
      150
    );

    // set migrator address to chef contract
    await chef.setMigrator(migrator.address);

    // deploy contract for migrate liquidity from uniswap to sushiswap
    roll = await new SushiRoll__factory(owner).deploy(
      uniRouter.address,
      sushiRouter.address
    );
  });

  describe("Migrate sushi lp contracts", () => {
    let oldTkn1ToTkn2Pair: UniswapV2Pair;
    let newTkn1ToTkn2Pair: UniswapV2Pair;

    it("Migrate tkn1ToTkn2Pair LPs between sushi factories", async () => {
      // create TKN1 - TKN2 pair in old factory and add it to chef
      const deadline =
        (await ethers.provider.getBlock("latest")).timestamp + 10000;

      await tokenOne
        .connect(alice)
        .approve(oldSushiRouter.address, parseEther("1000"));
      await tokenTwo
        .connect(alice)
        .approve(oldSushiRouter.address, parseEther("1000"));

      await expect(
        oldSushiRouter
          .connect(alice)
          .addLiquidity(
            tokenOne.address,
            tokenTwo.address,
            parseEther("1000"),
            parseEther("1000"),
            constants.Zero,
            constants.Zero,
            alice.address,
            deadline
          )
      ).to.emit(oldSushiFactory, "PairCreated");

      const oldPairCreated = await oldSushiFactory.getPair(
        tokenOne.address,
        tokenTwo.address
      );

      oldTkn1ToTkn2Pair = new UniswapV2Pair__factory(owner).attach(
        oldPairCreated
      );

      expect(await oldTkn1ToTkn2Pair.balanceOf(alice.address)).to.be.eq(
        parseEther("999.999999999999999000")
      );

      // add TKN1-TKN2 pair to chef
      await chef.add(parseEther("1"), oldTkn1ToTkn2Pair.address, false);

      const aliceLp = parseEther("500");

      await oldTkn1ToTkn2Pair.connect(alice).approve(chef.address, aliceLp);

      await chef.connect(alice).deposit(0, aliceLp);

      // 27 block
      await expect(chef.migrate(0)).to.be.revertedWith("too early to migrate");

      // mine to 150+ block
      await network.provider.send("hardhat_mine", ["0x7d"]);

      await expect(chef.connect(alice).migrate(0)).to.be.revertedWith(
        "migrate: bad"
      );

      // set migrator to the new factory
      await sushiFactory.setMigrator(migrator.address);

      await expect(() => chef.connect(alice).migrate(0)).to.changeTokenBalance(
        oldTkn1ToTkn2Pair,
        chef,
        parseEther("-500")
      );

      const newPairCreated = await sushiFactory.getPair(
        tokenOne.address,
        tokenTwo.address
      );

      newTkn1ToTkn2Pair = new UniswapV2Pair__factory(owner).attach(
        newPairCreated
      );

      expect(await newTkn1ToTkn2Pair.balanceOf(chef.address)).to.be.eq(
        parseEther("500")
      );
    });
  });

  describe("Sushi roll", () => {
    let uniTkn1ToTkn2Pair: UniswapV2Pair;
    let sushiTkn1ToTkn2Pair: UniswapV2Pair;

    it("Migrate uniswap LP to sushiswap LP", async () => {
      const deadline =
        (await ethers.provider.getBlock("latest")).timestamp + 10000;

      // create TKN1-TKN2 pair to uniswap
      await tokenOne
        .connect(bob)
        .approve(uniRouter.address, parseEther("1000"));
      await tokenTwo
        .connect(bob)
        .approve(uniRouter.address, parseEther("1000"));

      await expect(
        uniRouter
          .connect(bob)
          .addLiquidity(
            tokenOne.address,
            tokenTwo.address,
            parseEther("1000"),
            parseEther("1000"),
            constants.Zero,
            constants.Zero,
            bob.address,
            deadline
          )
      ).to.emit(uniFactory, "PairCreated");

      // do created pair contract callable
      const uniCreatedPair = await uniFactory.getPair(
        tokenOne.address,
        tokenTwo.address
      );

      uniTkn1ToTkn2Pair = new UniswapV2Pair__factory(owner).attach(
        uniCreatedPair
      );

      // check Bob's LPs
      expect(await uniTkn1ToTkn2Pair.balanceOf(bob.address)).to.be.eq(
        parseEther("999.999999999999999000")
      );

      // migrate from uni to sushi

      await uniTkn1ToTkn2Pair
        .connect(bob)
        .approve(roll.address, parseEther("500"));

      await roll
        .connect(bob)
        .migrate(
          tokenOne.address,
          tokenTwo.address,
          parseEther("500"),
          constants.Zero,
          constants.Zero,
          deadline
        );

      // do created after migrate pair contract callable
      const sushiCreatedPair = await sushiFactory.getPair(
        tokenOne.address,
        tokenTwo.address
      );

      sushiTkn1ToTkn2Pair = new UniswapV2Pair__factory(owner).attach(
        sushiCreatedPair
      );

      expect(await uniTkn1ToTkn2Pair.balanceOf(bob.address)).to.be.eq(
        parseEther("499.999999999999999000")
      );

      // Creating a new pair takes 1000 to address zero
      expect(await sushiTkn1ToTkn2Pair.balanceOf(bob.address)).to.be.eq(
        parseEther("499.999999999999999000")
      );

      // Migrate with permit
      const signature = await signERC2612Permit(
        bob,
        uniTkn1ToTkn2Pair.address,
        bob.address,
        roll.address,
        parseEther("250").toString(),
        deadline
      );

      await roll
        .connect(bob)
        .migrateWithPermit(
          tokenOne.address,
          tokenTwo.address,
          parseEther("250"),
          constants.Zero,
          constants.Zero,
          signature.deadline,
          signature.v,
          signature.r,
          signature.s
        );

      expect(await uniTkn1ToTkn2Pair.balanceOf(bob.address)).to.be.eq(
        parseEther("249.999999999999999000")
      );

      expect(await sushiTkn1ToTkn2Pair.balanceOf(bob.address)).to.be.eq(
        parseEther("749.999999999999999000")
      );
    });
  });
});
