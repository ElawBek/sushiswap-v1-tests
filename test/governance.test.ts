import { expect } from "chai";
import { ethers, network } from "hardhat";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { constants, BigNumber } from "ethers";
import { parseEther, AbiCoder } from "ethers/lib/utils";

import {
  WETH,
  WETH__factory,
  UniswapV2Factory,
  UniswapV2Factory__factory,
  GovernorAlpha,
  GovernorAlpha__factory,
  MasterChef,
  MasterChef__factory,
  UniswapV2Pair,
  UniswapV2Pair__factory,
  UniswapV2Router02,
  UniswapV2Router02__factory,
  SushiToken,
  SushiToken__factory,
  MockERC20,
  MockERC20__factory,
  Timelock,
  Timelock__factory,
} from "../typechain-types";

describe("Governance", () => {
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let weth: WETH;

  let tokenOne: MockERC20;
  let tokenTwo: MockERC20;

  let factory: UniswapV2Factory;
  let router: UniswapV2Router02;

  let sushi: SushiToken;
  let chef: MasterChef;

  let governor: GovernorAlpha;
  let timelock: Timelock;

  let tkn1ToTkn2Pair: UniswapV2Pair;
  let tkn1ToWethPair: UniswapV2Pair;
  let tkn2ToWethPair: UniswapV2Pair;

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();

    // deploy local weth
    weth = await new WETH__factory(owner).deploy();

    // deploy test tokens
    tokenOne = await new MockERC20__factory(owner).deploy("tokenOne", "TKN1");
    tokenTwo = await new MockERC20__factory(owner).deploy("tokenTwo", "TKN2");

    // mint some tokens fot liquidity
    await tokenOne.mint(alice.address, parseEther("1000"));
    await tokenTwo.mint(alice.address, parseEther("1000"));
    await tokenOne.mint(bob.address, parseEther("1000"));
    await tokenTwo.mint(bob.address, parseEther("1000"));

    // deploy sushiswap's contracts
    factory = await new UniswapV2Factory__factory(owner).deploy(owner.address);

    router = await new UniswapV2Router02__factory(owner).deploy(
      factory.address,
      weth.address
    );

    sushi = await new SushiToken__factory(owner).deploy();

    await sushi.mint(bob.address, parseEther("100"));
    await sushi.mint(alice.address, parseEther("100"));

    chef = await new MasterChef__factory(owner).deploy(
      sushi.address,
      owner.address,
      parseEther("10"),
      10,
      150
    );

    await sushi.transferOwnership(chef.address);

    timelock = await new Timelock__factory(owner).deploy(
      owner.address, // admin
      BigNumber.from(172800) // delay 2 days
    );
    governor = await new GovernorAlpha__factory(owner).deploy(
      timelock.address,
      sushi.address,
      owner.address
    );

    // change admin timelock => governor
    await timelock.setPendingAdmin(governor.address);
    await governor.__acceptAdmin();
  });

  describe("MasterChef", () => {
    beforeEach(async () => {
      const deadline =
        (await ethers.provider.getBlock("latest")).timestamp + 1000;

      // change owner MasterChef --> Timelock contract
      await chef.transferOwnership(timelock.address);

      // add three pair
      await tokenOne.connect(alice).approve(router.address, parseEther("1000"));
      await tokenTwo.connect(alice).approve(router.address, parseEther("1000"));
      await tokenOne.connect(bob).approve(router.address, parseEther("1000"));
      await tokenTwo.connect(bob).approve(router.address, parseEther("1000"));

      // create TKN1-TKN2 pair
      await router
        .connect(alice)
        .addLiquidity(
          tokenOne.address,
          tokenTwo.address,
          parseEther("500"),
          parseEther("500"),
          constants.Zero,
          constants.Zero,
          alice.address,
          deadline
        );

      // add liquidity to TKN1-TKN2 pair
      await router
        .connect(bob)
        .addLiquidity(
          tokenOne.address,
          tokenTwo.address,
          parseEther("500"),
          parseEther("500"),
          constants.Zero,
          constants.Zero,
          bob.address,
          deadline
        );

      // do TKN1-TKN2 pair callable
      let createdPair = await factory.getPair(
        tokenOne.address,
        tokenTwo.address
      );
      tkn1ToTkn2Pair = new UniswapV2Pair__factory(owner).attach(createdPair);

      // create TKN1-WETH pair
      await router
        .connect(alice)
        .addLiquidityETH(
          tokenOne.address,
          parseEther("250"),
          constants.Zero,
          constants.Zero,
          alice.address,
          deadline,
          { value: parseEther("25") }
        );

      // add liquidity to TKN1-WETH pair
      await router
        .connect(bob)
        .addLiquidityETH(
          tokenOne.address,
          parseEther("250"),
          constants.Zero,
          constants.Zero,
          bob.address,
          deadline,
          { value: parseEther("25") }
        );

      // do TKN1-WETH pair callable
      createdPair = await factory.getPair(tokenOne.address, weth.address);
      tkn1ToWethPair = new UniswapV2Pair__factory(owner).attach(createdPair);

      // create TKN2-WETH pair
      await router
        .connect(alice)
        .addLiquidityETH(
          tokenTwo.address,
          parseEther("250"),
          constants.Zero,
          constants.Zero,
          alice.address,
          deadline,
          { value: parseEther("25") }
        );

      // add liquidity to TKN2-WETH pair
      await router
        .connect(bob)
        .addLiquidityETH(
          tokenTwo.address,
          parseEther("250"),
          constants.Zero,
          constants.Zero,
          bob.address,
          deadline,
          { value: parseEther("25") }
        );

      // do TKN2-WETH pair callable
      createdPair = await factory.getPair(tokenTwo.address, weth.address);
      tkn2ToWethPair = new UniswapV2Pair__factory(owner).attach(createdPair);
    });

    it("Add pools to chef", async () => {
      // Not owner can't execute this function
      await expect(
        chef.add(parseEther("1"), tkn1ToTkn2Pair.address, false)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await sushi.connect(bob).delegate(bob.address);
      await sushi.connect(alice).delegate(bob.address);

      await network.provider.send("hardhat_mine", ["0x2"]);

      const encode = new AbiCoder();

      const data1 = encode.encode(
        ["uint256", "address", "bool"],
        [parseEther("1"), tkn1ToTkn2Pair.address, false]
      );
      const data2 = encode.encode(
        ["uint256", "address", "bool"],
        [parseEther("2"), tkn1ToWethPair.address, false]
      );
      const data3 = encode.encode(
        ["uint256", "address", "bool"],
        [parseEther("2"), tkn2ToWethPair.address, false]
      );

      const targets = [chef.address, chef.address, chef.address];
      const values = [0, 0, 0];
      const signatures = [
        "add(uint256,IERC20,bool)",
        "add(uint256,IERC20,bool)",
        "add(uint256,IERC20,bool)",
      ];
      const callDatas = [data1, data2, data3];

      await governor
        .connect(bob)
        .propose(
          targets,
          values,
          signatures,
          callDatas,
          "Add three pools to the chef"
        );

      console.log(await governor.proposals(0));
    });
  });
});
