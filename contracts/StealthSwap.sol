// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract StealthSwap is ERC20, ZamaEthereumConfig, ReentrancyGuard {
    IERC7984 public immutable usdt;
    IERC7984 public immutable zama;

    uint64 private _reserveUsdt;
    uint64 private _reserveZama;

    uint256 public constant FEE_DENOMINATOR = 1000;
    uint256 public constant FEE_NUMERATOR = 997;

    event LiquidityAdded(address indexed provider, uint64 usdtAmount, uint64 zamaAmount, uint256 liquidity);
    event LiquidityRemoved(address indexed provider, uint64 usdtAmount, uint64 zamaAmount, uint256 liquidity);
    event Swap(
        address indexed trader,
        address indexed tokenIn,
        uint64 amountIn,
        address indexed tokenOut,
        uint64 amountOut
    );

    constructor(address usdtAddress, address zamaAddress) ERC20("StealthSwap LP", "SSLP") {
        require(usdtAddress != address(0) && zamaAddress != address(0), "Zero token address");
        require(usdtAddress != zamaAddress, "Token addresses must differ");
        usdt = IERC7984(usdtAddress);
        zama = IERC7984(zamaAddress);
    }

    function getReserves() external view returns (uint64 reserveUsdt, uint64 reserveZama) {
        return (_reserveUsdt, _reserveZama);
    }

    function getAmountOut(uint64 amountIn, bool usdtToZama) external view returns (uint64 amountOut) {
        if (usdtToZama) {
            return _getAmountOut(amountIn, _reserveUsdt, _reserveZama);
        }
        return _getAmountOut(amountIn, _reserveZama, _reserveUsdt);
    }

    function addLiquidity(uint64 usdtAmount, uint64 zamaAmount) external nonReentrant returns (uint256 liquidity) {
        require(usdtAmount > 0 && zamaAmount > 0, "Zero amount");

        if (_reserveUsdt == 0 && _reserveZama == 0) {
            require(uint256(usdtAmount) == uint256(zamaAmount) * 2, "Initial ratio must be 2:1");
            liquidity = Math.sqrt(uint256(usdtAmount) * uint256(zamaAmount));
        } else {
            require(
                uint256(usdtAmount) * uint256(_reserveZama) == uint256(zamaAmount) * uint256(_reserveUsdt),
                "Invalid ratio"
            );
            uint256 supply = totalSupply();
            uint256 liquidityUsdt = (uint256(usdtAmount) * supply) / _reserveUsdt;
            uint256 liquidityZama = (uint256(zamaAmount) * supply) / _reserveZama;
            liquidity = Math.min(liquidityUsdt, liquidityZama);
        }

        require(liquidity > 0, "Insufficient liquidity minted");

        _pullToken(usdt, msg.sender, usdtAmount);
        _pullToken(zama, msg.sender, zamaAmount);

        _reserveUsdt = _safeAdd(_reserveUsdt, usdtAmount);
        _reserveZama = _safeAdd(_reserveZama, zamaAmount);

        _mint(msg.sender, liquidity);
        emit LiquidityAdded(msg.sender, usdtAmount, zamaAmount, liquidity);
    }

    function removeLiquidity(uint256 liquidity) external nonReentrant returns (uint64 usdtAmount, uint64 zamaAmount) {
        require(liquidity > 0, "Zero liquidity");
        uint256 supply = totalSupply();
        require(supply > 0, "No liquidity");

        usdtAmount = _toUint64((uint256(_reserveUsdt) * liquidity) / supply);
        zamaAmount = _toUint64((uint256(_reserveZama) * liquidity) / supply);
        require(usdtAmount > 0 && zamaAmount > 0, "Zero output");

        _burn(msg.sender, liquidity);

        _reserveUsdt -= usdtAmount;
        _reserveZama -= zamaAmount;

        _pushToken(usdt, msg.sender, usdtAmount);
        _pushToken(zama, msg.sender, zamaAmount);

        emit LiquidityRemoved(msg.sender, usdtAmount, zamaAmount, liquidity);
    }

    function swapExactUsdtForZama(
        uint64 usdtAmountIn,
        uint64 minZamaOut
    ) external nonReentrant returns (uint64 zamaOut) {
        require(usdtAmountIn > 0, "Zero amount in");
        require(_reserveUsdt > 0 && _reserveZama > 0, "Pool empty");

        zamaOut = _getAmountOut(usdtAmountIn, _reserveUsdt, _reserveZama);
        require(zamaOut >= minZamaOut, "Slippage exceeded");

        _pullToken(usdt, msg.sender, usdtAmountIn);
        _pushToken(zama, msg.sender, zamaOut);

        _reserveUsdt = _safeAdd(_reserveUsdt, usdtAmountIn);
        _reserveZama -= zamaOut;

        emit Swap(msg.sender, address(usdt), usdtAmountIn, address(zama), zamaOut);
    }

    function swapExactZamaForUsdt(
        uint64 zamaAmountIn,
        uint64 minUsdtOut
    ) external nonReentrant returns (uint64 usdtOut) {
        require(zamaAmountIn > 0, "Zero amount in");
        require(_reserveUsdt > 0 && _reserveZama > 0, "Pool empty");

        usdtOut = _getAmountOut(zamaAmountIn, _reserveZama, _reserveUsdt);
        require(usdtOut >= minUsdtOut, "Slippage exceeded");

        _pullToken(zama, msg.sender, zamaAmountIn);
        _pushToken(usdt, msg.sender, usdtOut);

        _reserveZama = _safeAdd(_reserveZama, zamaAmountIn);
        _reserveUsdt -= usdtOut;

        emit Swap(msg.sender, address(zama), zamaAmountIn, address(usdt), usdtOut);
    }

    function _getAmountOut(uint64 amountIn, uint64 reserveIn, uint64 reserveOut) internal pure returns (uint64) {
        require(amountIn > 0, "Zero amount in");
        require(reserveIn > 0 && reserveOut > 0, "Insufficient liquidity");

        uint256 amountInWithFee = uint256(amountIn) * FEE_NUMERATOR;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = uint256(reserveIn) * FEE_DENOMINATOR + amountInWithFee;
        uint256 amountOut = numerator / denominator;
        require(amountOut > 0, "Insufficient output");
        return _toUint64(amountOut);
    }

    function _pullToken(IERC7984 token, address from, uint64 amount) internal {
        euint64 encryptedAmount = FHE.asEuint64(amount);
        FHE.allowThis(encryptedAmount);
        FHE.allow(encryptedAmount, address(token));
        token.confidentialTransferFrom(from, address(this), encryptedAmount);
    }

    function _pushToken(IERC7984 token, address to, uint64 amount) internal {
        euint64 encryptedAmount = FHE.asEuint64(amount);
        FHE.allowThis(encryptedAmount);
        FHE.allow(encryptedAmount, address(token));
        token.confidentialTransfer(to, encryptedAmount);
    }

    function _safeAdd(uint64 currentValue, uint64 amount) internal pure returns (uint64) {
        uint256 sum = uint256(currentValue) + uint256(amount);
        require(sum <= type(uint64).max, "Reserve overflow");
        return uint64(sum);
    }

    function _toUint64(uint256 value) internal pure returns (uint64) {
        require(value <= type(uint64).max, "Amount overflow");
        return uint64(value);
    }
}
