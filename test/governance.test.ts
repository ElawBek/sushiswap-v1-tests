import { expect } from "chai";
import { ethers, network } from "hardhat";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { constants, BigNumber } from "ethers";
import { parseEther, AbiCoder } from "ethers/lib/utils";

import { splitSignatureToRSV, getEIP712Domain } from "./utils/EIP-712";

import { deploy } from "./utils/deploy";

import {
  WETH,
  MockERC20,
  UniswapV2Factory,
  UniswapV2Router02,
  SushiToken,
  MasterChef,
  UniswapV2Pair,
  UniswapV2Pair__factory,
  GovernorAlpha,
  GovernorAlpha__factory,
  Timelock,
  Timelock__factory,
} from "../typechain-types";

const proposalState = {
  Pending: 0,
  Active: 1,
  Canceled: 2,
  Defeated: 3,
  Succeeded: 4,
  Queued: 5,
  Expired: 6,
  Executed: 7,
};

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
    const deployed = await deploy();
    owner = deployed.owner;
    alice = deployed.alice;
    bob = deployed.bob;
    weth = deployed.weth;
    tokenOne = deployed.tokenOne;
    tokenTwo = deployed.tokenTwo;
    factory = deployed.factory;
    router = deployed.router;
    sushi = deployed.sushi;
    chef = deployed.chef;

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
      // change owner MasterChef --> Timelock contract
      await chef.transferOwnership(timelock.address);

      // Not owner can't execute this function
      await expect(
        chef.add(parseEther("1"), tkn1ToTkn2Pair.address, false)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      // do user's sushis votable
      await sushi.connect(bob).delegate(bob.address);
      await sushi.connect(alice).delegate(alice.address);

      await network.provider.send("hardhat_mine", ["0x1"]);

      const encoder = new AbiCoder();

      // encode datas for add pools to chef
      const data1 = encoder.encode(
        ["uint256", "address", "bool"],
        [parseEther("1"), tkn1ToTkn2Pair.address, false]
      );
      const data2 = encoder.encode(
        ["uint256", "address", "bool"],
        [parseEther("2"), tkn1ToWethPair.address, false]
      );
      const data3 = encoder.encode(
        ["uint256", "address", "bool"],
        [parseEther("2"), tkn2ToWethPair.address, false]
      );

      const targets = [chef.address, chef.address, chef.address];
      const values = [0, 0, 0];
      const signatures = [
        "add(uint256,address,bool)",
        "add(uint256,address,bool)",
        "add(uint256,address,bool)",
      ];
      const callDatas = [data1, data2, data3];

      // create propose
      await expect(
        governor
          .connect(bob)
          .propose(
            targets,
            values,
            signatures,
            callDatas,
            "Add three pools to the chef"
          )
      ).to.emit(governor, "ProposalCreated");
      // .withArgs(
      //   1, // id
      //   bob.address, // msg.sender
      //   targets,
      //   values,
      //   signatures,
      //   callDatas,
      //   34, // startBlock
      //   17314, // endBlock
      //   "Add three pools to the chef" // description
      // );

      // check propose's status
      expect(await governor.state(1)).to.be.eq(proposalState.Pending);

      await network.provider.send("hardhat_mine", ["0x2"]);

      expect(await governor.state(1)).to.be.eq(proposalState.Active);

      // vote for
      await governor.connect(bob).castVote(1, true);

      // can't repeat vote
      await expect(governor.connect(bob).castVote(1, true)).to.be.revertedWith(
        "GovernorAlpha::_castVote: voter already voted"
      );

      // end vote +17281 block
      await network.provider.send("hardhat_mine", ["0x4381"]);

      // check propose's status
      expect(await governor.state(1)).to.be.eq(proposalState.Succeeded);

      // send propose to timelock's queue
      await governor.connect(alice).queue(1);

      expect(await governor.state(1)).to.be.eq(proposalState.Queued);

      // can't execute before end timelock
      await expect(governor.connect(alice).execute(1)).to.be.revertedWith(
        "Timelock::executeTransaction: Transaction hasn't surpassed time lock."
      );

      // +3 days
      await network.provider.send("evm_increaseTime", [259200]);
      await network.provider.send("evm_mine");

      // execute propose
      await governor.connect(alice).execute(1);

      // status
      expect(await governor.state(1)).to.be.eq(proposalState.Executed);

      // check execution's result
      expect(await chef.poolLength()).to.be.eq(3);
    });

    it("Change alloc point in an existing pool", async () => {
      // add pool to chef
      await chef.add(parseEther("11"), tkn1ToTkn2Pair.address, false);

      expect((await chef.poolInfo(0)).allocPoint).to.be.eq(parseEther("11"));

      // change owner MasterChef --> Timelock contract
      await chef.transferOwnership(timelock.address);

      // do user's sushis votable
      await sushi.connect(bob).delegate(bob.address);
      await sushi.connect(alice).delegate(alice.address);

      await network.provider.send("hardhat_mine", ["0x1"]);

      const encoder = new AbiCoder();

      // encode datas for set alloc point
      const data = encoder.encode(
        ["uint256", "uint256", "bool"],
        [0, parseEther("10"), false]
      );

      const targets = [chef.address];
      const values = [0];
      const signatures = ["set(uint256,uint256,bool)"];
      const callDatas = [data];

      // create propose
      await expect(
        governor
          .connect(alice)
          .propose(targets, values, signatures, callDatas, "Set alloc point")
      ).to.emit(governor, "ProposalCreated");
      // .withArgs(
      //   1, // id
      //   alice.address, // msg.sender
      //   targets,
      //   values,
      //   signatures,
      //   callDatas,
      //   17355, // startBlock
      //   34635, // endBlock
      //   "Set alloc point" // description
      // );

      // check propose's status
      expect(await governor.state(1)).to.be.eq(proposalState.Pending);

      await network.provider.send("hardhat_mine", ["0x2"]);

      expect(await governor.state(1)).to.be.eq(proposalState.Active);

      // vote for
      await governor.connect(bob).castVote(1, true);
      await governor.connect(alice).castVote(1, true);

      // end vote +17281 block
      await network.provider.send("hardhat_mine", ["0x4381"]);

      // check propose's status
      expect(await governor.state(1)).to.be.eq(proposalState.Succeeded);

      // send propose to timelock's queue
      await governor.connect(alice).queue(1);

      expect(await governor.state(1)).to.be.eq(proposalState.Queued);

      // +3 days
      await network.provider.send("evm_increaseTime", [259200]);
      await network.provider.send("evm_mine");

      // execute propose
      await governor.connect(alice).execute(1);

      // status
      expect(await governor.state(1)).to.be.eq(proposalState.Executed);

      // check execution result
      expect((await chef.poolInfo(0)).allocPoint).to.be.eq(parseEther("10"));
    });
  });

  describe("Timelock", () => {
    beforeEach(async () => {
      // do user's sushis votable
      await sushi.connect(bob).delegate(bob.address);
      await sushi.connect(alice).delegate(alice.address);

      const encoder = new AbiCoder();

      // encode datas for set new delay
      const data = encoder.encode(["uint256"], [259200]);

      const targets = [timelock.address];
      const values = [0];
      const signatures = ["setDelay(uint256)"];
      const callDatas = [data];

      // bob create a propose
      await governor
        .connect(bob)
        .propose(targets, values, signatures, callDatas, "Set timelock delay");

      await network.provider.send("hardhat_mine", ["0x2"]);
    });

    it("Cancel vote", async () => {
      expect(await governor.state(1)).to.be.eq(proposalState.Active);

      await expect(governor.connect(bob).cancel(1)).to.be.revertedWith(
        "GovernorAlpha::cancel: proposer above threshold"
      );

      // Bob - original proposer - looses the required amount of COMP tokens
      await sushi.connect(bob).delegate(alice.address);

      await expect(governor.connect(alice).cancel(1))
        .to.emit(governor, "ProposalCanceled")
        .withArgs(1);

      expect(await governor.state(1)).to.be.eq(proposalState.Canceled);
    });

    it("Defeat propose", async () => {
      expect(await governor.state(1)).to.be.eq(proposalState.Active);

      // Users against vote
      await governor.connect(alice).castVote(1, false);
      await governor.connect(bob).castVote(1, false);

      // end vote +17281 block
      await network.provider.send("hardhat_mine", ["0x4381"]);

      // check propose's status
      expect(await governor.state(1)).to.be.eq(proposalState.Defeated);

      await expect(governor.connect(bob).queue(1)).to.be.revertedWith(
        "GovernorAlpha::queue: proposal can only be queued if it is succeeded"
      );
    });

    it("Expired propose", async () => {
      expect(await governor.state(1)).to.be.eq(proposalState.Active);

      // Users against vote
      await governor.connect(alice).castVote(1, true);
      await governor.connect(bob).castVote(1, true);

      // end vote +17281 block
      await network.provider.send("hardhat_mine", ["0x4381"]);

      await governor.connect(bob).queue(1);

      // delay == 2 days
      // GRACE_PERIOD == 14 days
      // + 16 days
      await network.provider.send("evm_increaseTime", [1382400]);
      await network.provider.send("evm_mine");

      await expect(governor.connect(bob).execute(1)).to.be.revertedWith(
        "GovernorAlpha::execute: proposal can only be executed if it is queued"
      );

      expect(await governor.state(1)).to.be.eq(proposalState.Expired);
    });

    it("Change timelock delay", async () => {
      // Not timelock can't execute
      await expect(
        timelock.setDelay(BigNumber.from(259200))
      ).to.be.revertedWith("Timelock::setDelay: Call must come from Timelock.");

      expect(await governor.state(1)).to.be.eq(proposalState.Active);

      // Users against vote
      await governor.connect(alice).castVote(1, true);
      await governor.connect(bob).castVote(1, true);

      // end vote +17281 block
      await network.provider.send("hardhat_mine", ["0x4381"]);

      await governor.connect(bob).queue(1);

      // delay == 2 days
      await network.provider.send("evm_increaseTime", [172801]);
      await network.provider.send("evm_mine");

      await governor.connect(bob).execute(1);

      expect(await governor.state(1)).to.be.eq(proposalState.Executed);

      expect(await timelock.delay()).to.be.eq(BigNumber.from(259200));
    });

    it("delegate by sig", async () => {
      const expiry =
        (await ethers.provider.getBlock("latest")).timestamp + 10000;

      const domain = await getEIP712Domain(sushi, alice);

      const types = {
        Delegation: [
          { name: "delegatee", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "expiry", type: "uint256" },
        ],
      };

      const value = {
        delegatee: bob.address,
        nonce: await sushi.nonces(alice.address),
        expiry,
      };

      const signature = await alice._signTypedData(domain, types, value);

      const { r, s, v } = splitSignatureToRSV(signature);

      expect(await sushi.delegates(alice.address)).to.eq(alice.address);
      expect(await sushi.getCurrentVotes(bob.address)).to.eq(parseEther("500"));

      await sushi.delegateBySig(
        bob.address,
        await sushi.nonces(alice.address),
        expiry,
        v,
        r,
        s
      );

      expect(await sushi.delegates(alice.address)).to.eq(bob.address);
      expect(await sushi.getCurrentVotes(bob.address)).to.eq(
        parseEther("1000")
      );
    });

    it("cast vote by sig", async () => {
      const domain = await getEIP712Domain(governor, alice);

      const types = {
        Ballot: [
          { name: "proposalId", type: "uint256" },
          { name: "support", type: "bool" },
        ],
      };

      const value = {
        proposalId: 1,
        support: true,
      };

      const signature = await alice._signTypedData(domain, types, value);

      const { r, s, v } = splitSignatureToRSV(signature);

      expect((await governor.proposals(1)).forVotes).to.eq(constants.Zero);

      await governor.castVoteBySig(1, true, v, r, s);

      expect((await governor.proposals(1)).forVotes).to.eq(
        await sushi.getCurrentVotes(alice.address)
      );
    });
  });
});
