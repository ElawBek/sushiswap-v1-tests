import { expect } from "chai";
import { ethers } from "hardhat";

describe("app", () => {
  it("do smth", async () => {
    const amount = ethers.BigNumber.from(100);

    console.log(amount.mul(-1));
  });
});
