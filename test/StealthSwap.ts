import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import {
  StealthSwap,
  StealthSwap__factory,
  fakeUSDT,
  fakeUSDT__factory,
  fakeZama,
  fakeZama__factory,
} from "../types";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

async function deployFixture() {
  const usdtFactory = (await ethers.getContractFactory("fakeUSDT")) as fakeUSDT__factory;
  const zamaFactory = (await ethers.getContractFactory("fakeZama")) as fakeZama__factory;
  const swapFactory = (await ethers.getContractFactory("StealthSwap")) as StealthSwap__factory;

  const usdt = (await usdtFactory.deploy()) as fakeUSDT;
  const zama = (await zamaFactory.deploy()) as fakeZama;
  const swap = (await swapFactory.deploy(await usdt.getAddress(), await zama.getAddress())) as StealthSwap;

  return { usdt, zama, swap };
}

async function setOperator(token: fakeUSDT | fakeZama, owner: HardhatEthersSigner, operator: string) {
  const block = await ethers.provider.getBlock("latest");
  if (!block) {
    throw new Error("Missing block");
  }
  const until = BigInt(block.timestamp) + 30n * 24n * 60n * 60n;
  await token.connect(owner).setOperator(operator, until);
}

async function decryptBalance(
  token: fakeUSDT | fakeZama,
  tokenAddress: string,
  owner: HardhatEthersSigner,
) {
  const encrypted = await token.confidentialBalanceOf(owner.address);
  return fhevm.userDecryptEuint(FhevmType.euint64, encrypted, tokenAddress, owner);
}

describe("StealthSwap", function () {
  let signers: Signers;
  let usdt: fakeUSDT;
  let zama: fakeZama;
  let swap: StealthSwap;

  before(async function () {
    const ethSigners = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("This test suite requires the FHEVM mock environment.");
      this.skip();
    }

    ({ usdt, zama, swap } = await deployFixture());
  });

  it("enforces the initial 2:1 price ratio", async function () {
    await usdt.mint(signers.alice.address, 1_000_000);
    await zama.mint(signers.alice.address, 1_000_000);

    await setOperator(usdt, signers.alice, await swap.getAddress());
    await setOperator(zama, signers.alice, await swap.getAddress());

    await expect(swap.connect(signers.alice).addLiquidity(1_000_000, 1_000_000)).to.be.revertedWith(
      "Initial ratio must be 2:1",
    );
  });

  it("adds liquidity and swaps fUSDT for fZama", async function () {
    await usdt.mint(signers.alice.address, 2_000_000);
    await zama.mint(signers.alice.address, 1_000_000);

    await setOperator(usdt, signers.alice, await swap.getAddress());
    await setOperator(zama, signers.alice, await swap.getAddress());

    await swap.connect(signers.alice).addLiquidity(2_000_000, 1_000_000);

    const reservesAfterAdd = await swap.getReserves();
    expect(reservesAfterAdd[0]).to.equal(2_000_000n);
    expect(reservesAfterAdd[1]).to.equal(1_000_000n);

    await usdt.mint(signers.bob.address, 1_000_000);
    await setOperator(usdt, signers.bob, await swap.getAddress());

    const expectedZamaOut = await swap.getAmountOut(500_000, true);
    await swap.connect(signers.bob).swapExactUsdtForZama(500_000, 0);

    const reservesAfterSwap = await swap.getReserves();
    expect(reservesAfterSwap[0]).to.equal(2_500_000n);
    expect(reservesAfterSwap[1]).to.equal(1_000_000n - expectedZamaOut);

    const bobZama = await decryptBalance(zama, await zama.getAddress(), signers.bob);
    expect(bobZama).to.equal(expectedZamaOut);
  });
});
