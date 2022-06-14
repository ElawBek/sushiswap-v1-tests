import { ethers } from "hardhat";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

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
  SushiToken,
  SushiToken__factory,
  MasterChef,
  MasterChef__factory,
} from "../../typechain-types";

export type Deployed = {
  owner: SignerWithAddress;
  alice: SignerWithAddress;
  bob: SignerWithAddress;
  weth: WETH;
  tokenOne: MockERC20;
  tokenTwo: MockERC20;
  factory: UniswapV2Factory;
  router: UniswapV2Router02;
  sushi: SushiToken;
  chef: MasterChef;
};

export const deploy = async (): Promise<Deployed> => {
  const [owner, alice, bob] = await ethers.getSigners();

  // deploy local weth
  const weth = await new WETH__factory(owner).deploy();

  const tokenOne = await new MockERC20__factory(owner).deploy(
    "TokenOne",
    "TKN1"
  );
  const tokenTwo = await new MockERC20__factory(owner).deploy(
    "TokenTwo",
    "TKN2"
  );

  const factory = await new UniswapV2Factory__factory(owner).deploy(
    owner.address
  );

  const router = await new UniswapV2Router02__factory(owner).deploy(
    factory.address,
    weth.address
  );

  const sushi = await new SushiToken__factory(owner).deploy();

  // mint sushi to owner account for create SUSHI/WETH pair
  await sushi.mint(owner.address, parseEther("1000"));

  // mint initial supply of sushi to users for add liquidity to SUSHI/WETH pair
  await sushi.mint(alice.address, parseEther("500"));
  await sushi.mint(bob.address, parseEther("500"));

  // mint 10000 TKN1 and TKN2 to owner
  await tokenOne.mint(owner.address, parseEther("10000"));
  await tokenTwo.mint(owner.address, parseEther("10000"));

  // mint 10000 TKN1 and TKN2 for users
  await tokenOne.mint(alice.address, parseEther("10000"));
  await tokenTwo.mint(alice.address, parseEther("10000"));

  await tokenOne.mint(bob.address, parseEther("10000"));
  await tokenTwo.mint(bob.address, parseEther("10000"));

  const chef = await new MasterChef__factory(owner).deploy(
    sushi.address,
    owner.address, // devaddr
    parseEther("10"), // Sushi per block
    0, // start block
    250 // end bonus block
  );

  // owner of sushiToken -> MasterChef
  await sushi.transferOwnership(chef.address);

  return {
    owner,
    alice,
    bob,
    weth,
    tokenOne,
    tokenTwo,
    factory,
    router,
    sushi,
    chef,
  };
};
