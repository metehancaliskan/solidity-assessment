# Implementation Notes

## Scope of changes

`Token.sol` is the only contract file I modified, as instructed. I also had to apply a minimal fix to `test/utils/index.js` to get the test runner working — see "Test utility fix" below.

## Dividend distribution: pull-based accumulator

A naive implementation of `recordDividend()` would iterate over every token holder and assign each their proportional share. That's O(n) per call, and gas usage grows linearly with the number of holders. With a few thousand holders, a single dividend call could exhaust the block gas limit.

I used the **pull-based accumulator** pattern (sometimes called "dividend-per-token" or the MasterChef reward pattern). The idea is to track a single global counter representing "how much dividend each token has earned since contract deployment", and let each holder claim their share lazily when their balance changes or when they query/withdraw.

### State

```solidity
uint256 private _dividendPerToken;                       // global cumulative dividend per token (scaled by 1e18)
mapping(address => uint256) private _lastDividendPerToken; // user's snapshot of the global at last settlement
mapping(address => uint256) private _withdrawable;         // user's locked-in claimable amount
```

### Mechanics

- **`recordDividend()`** is now O(1): it just updates the global counter.
  ```
  _dividendPerToken += (msg.value * 1e18) / totalSupply
  ```

- **`_settle(user)`** is called before any balance change (mint, burn, transfer, transferFrom). It locks in the user's accrued share using their current balance and the delta since their last snapshot:
  ```
  pending = balanceOf[user] * (_dividendPerToken - _lastDividendPerToken[user]) / 1e18
  _withdrawable[user] += pending
  _lastDividendPerToken[user] = _dividendPerToken
  ```

- **`getWithdrawableDividend(payee)`** computes the current claimable amount on the fly: stored `_withdrawable[payee]` plus unsettled pending from the user's current balance.

This satisfies the requirement that holders retain their right to dividends accrued *while* they held tokens, even after transferring or burning them: the settlement happens before the balance change, so the historical share is locked in.

## Holder list: swap-and-pop

The `IDividends` interface still requires `getNumTokenHolders()` and `getTokenHolder(index)`, so I maintain a list of active holders even though dividend distribution doesn't iterate over it.

```solidity
address[] private _holders;
mapping(address => uint256) private _holderIndex; // 1-based; 0 means "not a holder"
```

- **Add** (`_addHolder`): push to the array, store the 1-based index. O(1).
- **Remove** (`_removeHolder`): swap-and-pop. Move the last element into the removed slot, update its index, then pop. O(1).

The 1-based indexing lets `_holderIndex[user] == 0` act as a clean "not present" sentinel. The interface specifies 1-based indexing for `getTokenHolder` as well, so the convention is consistent.

Holder list updates happen inside `mint`, `burn`, and the internal `_move` helper (used by `transfer` and `transferFrom`). A holder is added when their balance transitions from 0 to positive, and removed when it transitions back to 0.

## Test utility fix

The boilerplate `test/utils/index.js` relied on a global `web3` variable, which is provided by the legacy `@nomiclabs/hardhat-web3` plugin. The installed `@nomicfoundation/hardhat-toolbox` v5 no longer bundles that plugin, so running the tests as-is produced `ReferenceError: web3 is not defined`.

I made two minimal changes:

1. **`getBalance` now uses ethers** (already available via `hardhat-toolbox`):
   ```js
   export const getBalance = async addr => hre.ethers.provider.getBalance(addr)
   ```

2. **Added a tiny chai patch** to handle BigInt/Number comparisons in `.equal()`. Ethers returns balances as native `BigInt`, and `expect(BigInt(23)).to.equal(23)` would otherwise fail chai's strict equality. The patch coerces BigInt to Number when comparing against a Number. Safe here because the test assertions only check small values (under 2000 wei) where Number precision is not a concern.

`Token.sol` itself was untouched by this fix; this is purely test infrastructure.

## Notes on Solidity 0.7.0

- `unchecked` blocks aren't available (those are 0.8+), so `SafeMath` is used throughout for arithmetic.
- The `allowance` public mapping is declared with `override` so its auto-generated getter satisfies the `IERC20.allowance` interface function.
