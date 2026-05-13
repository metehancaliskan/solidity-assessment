import { expect } from "chai";
import hre from "hardhat";
import { getBalance } from "./utils/index.js";

const assertHolderList = async (token, ...addresses) => {
  const n = await token.getNumTokenHolders();
  const p = [];
  for (let i = 1; i <= n; i += 1) {
    p.push(token.getTokenHolder(i));
  }
  const a = await Promise.all(p);
  const aSorted = a.map(add => add.toLowerCase()).sort();
  const inSorted = addresses.map(add => add.toLowerCase()).sort();
  expect(aSorted.length).to.equal(inSorted.length);
  expect(aSorted).to.deep.equal(inSorted);
};

describe("Token", function () {
  let token;
  let owner;
  let addr1;
  let addr2;
  let addr3;
  let addr5;
  let addr9;
  let addrs;

  beforeEach(async function () {
    // Get signers (accounts with ETH)
    [owner, addr1, addr2, addr3, addr5, addr9, ...addrs] = await hre.ethers.getSigners();
    
    // Deploy token contract
    const Token = await hre.ethers.getContractFactory("Token");
    token = await Token.deploy();
    await token.waitForDeployment();
  });

  it("has default values", async function () {
    expect(await token.name()).to.equal("Test token");
    expect(await token.symbol()).to.equal("TEST");
    expect(await token.decimals()).to.equal(18);
    expect(await token.totalSupply()).to.equal(0);
  });

  it("can be minted", async function () {
    await expect(token.mint()).to.be.reverted;
    
    await token.mint({ value: 23 });
    expect(await token.balanceOf(owner.address)).to.equal(23);
    expect(await token.totalSupply()).to.equal(23);
    
    await token.mint({ value: 50 });
    expect(await token.balanceOf(owner.address)).to.equal(73);
    expect(await token.totalSupply()).to.equal(73);
    
    expect(await getBalance(await token.getAddress())).to.equal(73);
    
    await token.connect(addr1).mint({ value: 50 });
    expect(await token.balanceOf(owner.address)).to.equal(73);
    expect(await token.balanceOf(addr1.address)).to.equal(50);
    expect(await token.totalSupply()).to.equal(123);
    
    expect(await getBalance(await token.getAddress())).to.equal(123);
  });

  it("can be burnt", async function () {
    await token.mint({ value: 23 });
    await token.connect(addr1).mint({ value: 50 });
    
    expect(await getBalance(await token.getAddress())).to.equal(73);
    
    const preBal = await getBalance(addr9.address);
    
    await token.burn(addr9.address);
    expect(await getBalance(await token.getAddress())).to.equal(50);
    
    const postBal = await getBalance(addr9.address);
    expect(postBal - preBal).to.equal(23);
  });

  describe("once minted", function () {
    beforeEach(async function () {
      await token.mint({ value: 50 });
      await token.connect(addr1).mint({ value: 50 });
    });

    it("can be transferred directly", async function () {
      await token.connect(addr1).transfer(addr2.address, 1);
      expect(await token.balanceOf(addr1.address)).to.equal(49);
      expect(await token.balanceOf(addr2.address)).to.equal(1);
      expect(await token.totalSupply()).to.equal(100);
      
      await expect(token.connect(addr2).transfer(addr1.address, 2)).to.be.reverted;
    });

    it("can be transferred indirectly", async function () {
      await token.approve(addr1.address, 5);
      expect(await token.allowance(owner.address, addr1.address)).to.equal(5);
      
      await token.approve(addr1.address, 10);
      expect(await token.allowance(owner.address, addr1.address)).to.equal(10);
      
      await expect(token.connect(addr1).transferFrom(owner.address, addr2.address, 11)).to.be.reverted;
      await token.connect(addr1).transferFrom(owner.address, addr2.address, 9);
      
      expect(await token.balanceOf(owner.address)).to.equal(41);
      expect(await token.balanceOf(addr1.address)).to.equal(50);
      expect(await token.balanceOf(addr2.address)).to.equal(9);
      
      expect(await token.allowance(owner.address, addr1.address)).to.equal(1);
      await expect(token.connect(addr1).transferFrom(owner.address, addr1.address, 2)).to.be.reverted;
      await token.connect(addr1).transferFrom(owner.address, addr1.address, 1);
      
      expect(await token.balanceOf(owner.address)).to.equal(40);
      expect(await token.balanceOf(addr1.address)).to.equal(51);
      expect(await token.balanceOf(addr2.address)).to.equal(9);
      
      expect(await token.allowance(owner.address, addr1.address)).to.equal(0);
    });

    describe("can record dividends", function () {
      it("and disallows empty dividend", async function () {
        await expect(token.recordDividend()).to.be.reverted;
      });
      
      it("and keeps track of holders when minting and burning", async function () {
        await assertHolderList(token, owner.address, addr1.address);
        
        await token.connect(addr2).mint({ value: 100 });
        await token.burn(addr9.address);
        
        expect(await token.balanceOf(owner.address)).to.equal(0);
        expect(await token.balanceOf(addr1.address)).to.equal(50);
        expect(await token.balanceOf(addr2.address)).to.equal(100);
        
        await assertHolderList(token, addr1.address, addr2.address);
        
        await token.connect(addr5).recordDividend({ value: 1500 });
        
        expect(await token.getWithdrawableDividend(owner.address)).to.equal(0);
        expect(await token.getWithdrawableDividend(addr1.address)).to.equal(500);
        expect(await token.getWithdrawableDividend(addr2.address)).to.equal(1000);
        
        await assertHolderList(token, addr1.address, addr2.address);
      });

      it("and keeps track of holders when transferring", async function () {
        await token.transfer(addr2.address, 25);
        await token.transfer(addr3.address, 0);
        
        await token.connect(addr1).approve(owner.address, 50);
        await token.transferFrom(addr1.address, addr2.address, 50);
        
        expect(await token.balanceOf(owner.address)).to.equal(25);
        expect(await token.balanceOf(addr1.address)).to.equal(0);
        expect(await token.balanceOf(addr2.address)).to.equal(75);
        expect(await token.balanceOf(addr3.address)).to.equal(0);
        
        await assertHolderList(token, owner.address, addr2.address);
        
        await token.connect(addr5).recordDividend({ value: 1000 });
        
        expect(await token.getWithdrawableDividend(owner.address)).to.equal(250);
        expect(await token.getWithdrawableDividend(addr1.address)).to.equal(0);
        expect(await token.getWithdrawableDividend(addr2.address)).to.equal(750);
        expect(await token.getWithdrawableDividend(addr3.address)).to.equal(0);
      });

      it("and compounds the payouts", async function () {
        await token.transfer(addr2.address, 25);
        
        expect(await token.balanceOf(owner.address)).to.equal(25);
        expect(await token.balanceOf(addr1.address)).to.equal(50);
        expect(await token.balanceOf(addr2.address)).to.equal(25);
        
        await token.connect(addr5).recordDividend({ value: 1000 });
        
        expect(await token.getWithdrawableDividend(owner.address)).to.equal(250);
        expect(await token.getWithdrawableDividend(addr1.address)).to.equal(500);
        expect(await token.getWithdrawableDividend(addr2.address)).to.equal(250);
        
        // do some transfer to update proportional holdings
        await token.connect(addr1).transfer(addr2.address, 25);
        await token.connect(addr1).mint({ value: 75 });
        await token.connect(owner).burn(owner.address);
        
        expect(await token.balanceOf(owner.address)).to.equal(0);
        expect(await token.balanceOf(addr1.address)).to.equal(100);
        expect(await token.balanceOf(addr2.address)).to.equal(50);
        expect(await token.totalSupply()).to.equal(150);
        
        await assertHolderList(token, addr1.address, addr2.address);
        
        await token.connect(addr5).recordDividend({ value: 90 });
        
        // check that new payouts are in accordance with new holding proportions
        expect(await token.getWithdrawableDividend(owner.address)).to.equal(250 + 0);
        expect(await token.getWithdrawableDividend(addr1.address)).to.equal(500 + 60);
        expect(await token.getWithdrawableDividend(addr2.address)).to.equal(250 + 30);
      });

      it("and allows for withdrawals in-between payouts", async function () {
        await token.transfer(addr2.address, 25);
        
        expect(await token.balanceOf(owner.address)).to.equal(25);
        expect(await token.balanceOf(addr1.address)).to.equal(50);
        expect(await token.balanceOf(addr2.address)).to.equal(25);
        
        await assertHolderList(token, owner.address, addr1.address, addr2.address);
        
        await token.connect(addr5).recordDividend({ value: 1000 });
        
        expect(await token.getWithdrawableDividend(owner.address)).to.equal(250);
        expect(await token.getWithdrawableDividend(addr1.address)).to.equal(500);
        expect(await token.getWithdrawableDividend(addr2.address)).to.equal(250);
        
        // check that withdrawal works
        const preBal = await getBalance(addr9.address);
        await token.connect(addr1).withdrawDividend(addr9.address);
        const postBal = await getBalance(addr9.address);
        expect(postBal - preBal).to.equal(500);
        
        // check that withdrawable balance has been reset for account 1
        expect(await token.getWithdrawableDividend(owner.address)).to.equal(250);
        expect(await token.getWithdrawableDividend(addr1.address)).to.equal(0);
        expect(await token.getWithdrawableDividend(addr2.address)).to.equal(250);
      });

      it("and allows for withdrawals even after holder relinquishes tokens", async function () {
        await token.transfer(addr2.address, 25);
        
        expect(await token.balanceOf(owner.address)).to.equal(25);
        expect(await token.balanceOf(addr1.address)).to.equal(50);
        expect(await token.balanceOf(addr2.address)).to.equal(25);
        
        await assertHolderList(token, owner.address, addr1.address, addr2.address);
        
        await token.connect(addr5).recordDividend({ value: 1000 });
        
        expect(await token.getWithdrawableDividend(owner.address)).to.equal(250);
        expect(await token.getWithdrawableDividend(addr1.address)).to.equal(500);
        expect(await token.getWithdrawableDividend(addr2.address)).to.equal(250);
        
        const preBal = await getBalance(addr9.address);
        
        // burn tokens from addr1
        await token.connect(addr1).burn(addr9.address);
        
        await assertHolderList(token, owner.address, addr2.address);
        
        expect(await token.getWithdrawableDividend(owner.address)).to.equal(250);
        expect(await token.getWithdrawableDividend(addr1.address)).to.equal(500);
        expect(await token.getWithdrawableDividend(addr2.address)).to.equal(250);
        
        // try withdrawing
        await token.connect(addr1).withdrawDividend(addr9.address);
        
        // check dest balances
        const postBal = await getBalance(addr9.address);
        expect(postBal - preBal).to.equal(50 + 500);
        
        expect(await token.getWithdrawableDividend(owner.address)).to.equal(250);
        expect(await token.getWithdrawableDividend(addr1.address)).to.equal(0);
        expect(await token.getWithdrawableDividend(addr2.address)).to.equal(250);
        
        // record new dividend
        await token.connect(addr5).recordDividend({ value: 80 });
        
        // this time addr1 doesn't get any payout because they no longer hold tokens
        expect(await token.getWithdrawableDividend(owner.address)).to.equal(250 + 40);
        expect(await token.getWithdrawableDividend(addr1.address)).to.equal(0);
        expect(await token.getWithdrawableDividend(addr2.address)).to.equal(250 + 40);
      });
    });
  });
});