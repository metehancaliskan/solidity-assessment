pragma solidity 0.7.0;

import "./IERC20.sol";
import "./IMintableToken.sol";
import "./IDividends.sol";
import "./SafeMath.sol";

contract Token is IERC20, IMintableToken, IDividends {
  // ------------------------------------------ //
  // ----- BEGIN: DO NOT EDIT THIS SECTION ---- //
  // ------------------------------------------ //
  using SafeMath for uint256;
  uint256 public totalSupply;
  uint256 public decimals = 18;
  string public name = "Test token";
  string public symbol = "TEST";
  mapping (address => uint256) public balanceOf;
  // ------------------------------------------ //
  // ----- END: DO NOT EDIT THIS SECTION ------ //
  // ------------------------------------------ //

  mapping(address => mapping(address => uint256)) public override allowance;

  address[] private _holders;
  mapping(address => uint256) private _holderIndex;

  uint256 private constant SCALE = 1e18;
  uint256 private _dividendPerToken;
  mapping(address => uint256) private _lastDividendPerToken;
  mapping(address => uint256) private _withdrawable;

  function _settle(address user) internal {
    uint256 delta = _dividendPerToken.sub(_lastDividendPerToken[user]);
    if (delta > 0) {
      uint256 pending = balanceOf[user].mul(delta) / SCALE;
      _withdrawable[user] = _withdrawable[user].add(pending);
      _lastDividendPerToken[user] = _dividendPerToken;
    }
  }

  function _addHolder(address user) internal {
    if (_holderIndex[user] == 0) {
      _holders.push(user);
      _holderIndex[user] = _holders.length;
    }
  }

  function _removeHolder(address user) internal {
    uint256 idx = _holderIndex[user];
    if (idx == 0) return;

    uint256 lastIdx = _holders.length;
    if (idx != lastIdx) {
      address lastAddr = _holders[lastIdx - 1];
      _holders[idx - 1] = lastAddr;
      _holderIndex[lastAddr] = idx;
    }
    _holders.pop();
    delete _holderIndex[user];
  }

  function _move(address from, address to, uint256 value) internal {
    _settle(from);
    _settle(to);

    balanceOf[from] = balanceOf[from].sub(value);
    balanceOf[to] = balanceOf[to].add(value);

    if (balanceOf[from] == 0) {
      _removeHolder(from);
    }
    if (balanceOf[to] > 0) {
      _addHolder(to);
    }
  }

  // IERC20

  function transfer(address to, uint256 value) external override returns (bool) {
    _move(msg.sender, to, value);
    return true;
  }

  function approve(address spender, uint256 value) external override returns (bool) {
    allowance[msg.sender][spender] = value;
    return true;
  }

  function transferFrom(address from, address to, uint256 value) external override returns (bool) {
    allowance[from][msg.sender] = allowance[from][msg.sender].sub(value);
    _move(from, to, value);
    return true;
  }

  // IMintableToken

  function mint() external payable override {
    require(msg.value > 0, "no ETH sent");
    _settle(msg.sender);
    totalSupply = totalSupply.add(msg.value);
    balanceOf[msg.sender] = balanceOf[msg.sender].add(msg.value);
    _addHolder(msg.sender);
  }

  function burn(address payable dest) external override {
    uint256 amount = balanceOf[msg.sender];
    require(amount > 0, "no balance");
    _settle(msg.sender);
    balanceOf[msg.sender] = 0;
    totalSupply = totalSupply.sub(amount);
    _removeHolder(msg.sender);
    dest.transfer(amount);
  }

  // IDividends

  function getNumTokenHolders() external view override returns (uint256) {
    return _holders.length;
  }

  function getTokenHolder(uint256 index) external view override returns (address) {
    if (index == 0 || index > _holders.length) return address(0);
    return _holders[index - 1];
  }

  function recordDividend() external payable override {
    require(msg.value > 0, "no ETH sent");
    require(totalSupply > 0, "no supply");
    _dividendPerToken = _dividendPerToken.add(msg.value.mul(SCALE) / totalSupply);
  }

  function getWithdrawableDividend(address payee) external view override returns (uint256) {
    uint256 delta = _dividendPerToken.sub(_lastDividendPerToken[payee]);
    uint256 pending = balanceOf[payee].mul(delta) / SCALE;
    return _withdrawable[payee].add(pending);
  }

  function withdrawDividend(address payable dest) external override {
    _settle(msg.sender);
    uint256 amount = _withdrawable[msg.sender];
    _withdrawable[msg.sender] = 0;
    if (amount > 0) {
      dest.transfer(amount);
    }
  }
}
