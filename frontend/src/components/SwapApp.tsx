import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { ethers } from 'ethers';
import { isAddress } from 'viem';

import { Header } from './Header';
import { publicClient } from '../config/viem';
import { DEFAULT_CONTRACTS, SWAP_ABI, TOKEN_ABI } from '../config/contracts';
import { useEthersSigner } from '../hooks/useEthersSigner';
import { useZamaInstance } from '../hooks/useZamaInstance';
import '../styles/SwapApp.css';

const DECIMALS = 6;
const LP_DECIMALS = 18;
const MAX_UINT64 = 2n ** 64n - 1n;
const MAX_SLIPPAGE_BPS = 5000;

type ContractAddresses = {
  usdt: string;
  zama: string;
  swap: string;
};

type BalanceState = {
  usdtEncrypted: string;
  zamaEncrypted: string;
  usdtClear: bigint | null;
  zamaClear: bigint | null;
};

const parseTokenAmount = (value: string) => {
  if (!value) {
    return null;
  }
  try {
    const parsed = ethers.parseUnits(value, DECIMALS);
    if (parsed > MAX_UINT64) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const parseLpAmount = (value: string) => {
  if (!value) {
    return null;
  }
  try {
    return ethers.parseUnits(value, LP_DECIMALS);
  } catch {
    return null;
  }
};

const formatToken = (value: bigint | null) => {
  if (value === null) {
    return '--';
  }
  return ethers.formatUnits(value, DECIMALS);
};

const formatLp = (value: bigint | null) => {
  if (value === null) {
    return '--';
  }
  return ethers.formatUnits(value, LP_DECIMALS);
};

export function SwapApp() {
  const { address, isConnected } = useAccount();
  const signerPromise = useEthersSigner();
  const { instance, isLoading: zamaLoading, error: zamaError } = useZamaInstance();

  const [contracts, setContracts] = useState<ContractAddresses>(DEFAULT_CONTRACTS);
  const [balances, setBalances] = useState<BalanceState>({
    usdtEncrypted: '',
    zamaEncrypted: '',
    usdtClear: null,
    zamaClear: null,
  });
  const [reserves, setReserves] = useState<{ usdt: bigint | null; zama: bigint | null }>({
    usdt: null,
    zama: null,
  });
  const [lpBalance, setLpBalance] = useState<bigint | null>(null);
  const [lpSupply, setLpSupply] = useState<bigint | null>(null);
  const [status, setStatus] = useState<string>('');
  const [refreshIndex, setRefreshIndex] = useState(0);

  const [mintUsdt, setMintUsdt] = useState('');
  const [mintZama, setMintZama] = useState('');
  const [liquidityUsdt, setLiquidityUsdt] = useState('');
  const [liquidityZama, setLiquidityZama] = useState('');
  const [lpToRemove, setLpToRemove] = useState('');
  const [swapDirection, setSwapDirection] = useState<'usdtToZama' | 'zamaToUsdt'>('usdtToZama');
  const [swapAmount, setSwapAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState('50');
  const [swapQuote, setSwapQuote] = useState<bigint | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const isConfigured = useMemo(() => {
    return isAddress(contracts.usdt) && isAddress(contracts.zama) && isAddress(contracts.swap);
  }, [contracts]);

  const tokenPrice = useMemo(() => {
    if (!reserves.usdt || !reserves.zama || reserves.zama === 0n) {
      return null;
    }
    return Number(reserves.usdt) / Number(reserves.zama);
  }, [reserves]);

  const refreshData = useCallback(async () => {
    if (!address || !isConfigured) {
      return;
    }
    try {
      const [usdtEncrypted, zamaEncrypted, reserveValues, lpBal, supply] = await Promise.all([
        publicClient.readContract({
          address: contracts.usdt as `0x${string}`,
          abi: TOKEN_ABI,
          functionName: 'confidentialBalanceOf',
          args: [address],
        }),
        publicClient.readContract({
          address: contracts.zama as `0x${string}`,
          abi: TOKEN_ABI,
          functionName: 'confidentialBalanceOf',
          args: [address],
        }),
        publicClient.readContract({
          address: contracts.swap as `0x${string}`,
          abi: SWAP_ABI,
          functionName: 'getReserves',
        }),
        publicClient.readContract({
          address: contracts.swap as `0x${string}`,
          abi: SWAP_ABI,
          functionName: 'balanceOf',
          args: [address],
        }),
        publicClient.readContract({
          address: contracts.swap as `0x${string}`,
          abi: SWAP_ABI,
          functionName: 'totalSupply',
        }),
      ]);

      const [reserveUsdt, reserveZama] = reserveValues as readonly [bigint, bigint];

      setBalances((prev) => ({
        ...prev,
        usdtEncrypted: usdtEncrypted as string,
        zamaEncrypted: zamaEncrypted as string,
      }));
      setReserves({ usdt: reserveUsdt, zama: reserveZama });
      setLpBalance(lpBal as bigint);
      setLpSupply(supply as bigint);
    } catch (error) {
      console.error('Failed to refresh data', error);
      setStatus('Unable to refresh on-chain data.');
    }
  }, [address, contracts.swap, contracts.usdt, contracts.zama, isConfigured]);

  useEffect(() => {
    setBalances((prev) => ({
      ...prev,
      usdtClear: null,
      zamaClear: null,
    }));
  }, [contracts.usdt, contracts.zama]);

  useEffect(() => {
    if (isConnected && isConfigured) {
      refreshData();
    }
  }, [isConnected, isConfigured, address, refreshIndex, refreshData]);

  useEffect(() => {
    const amountIn = parseTokenAmount(swapAmount);
    if (!amountIn || !isConfigured) {
      setSwapQuote(null);
      return;
    }
    const fetchQuote = async () => {
      try {
        const quote = await publicClient.readContract({
          address: contracts.swap as `0x${string}`,
          abi: SWAP_ABI,
          functionName: 'getAmountOut',
          args: [amountIn, swapDirection === 'usdtToZama'],
        });
        setSwapQuote(quote as bigint);
      } catch (error) {
        console.error('Failed to fetch quote', error);
        setSwapQuote(null);
      }
    };
    fetchQuote();
  }, [swapAmount, swapDirection, contracts.swap, isConfigured]);

  const handleDecrypt = async (tokenKey: 'usdt' | 'zama') => {
    if (!address || !instance || zamaLoading) {
      return;
    }
    const signer = signerPromise ? await signerPromise : undefined;
    if (!signer) {
      setStatus('Connect a wallet to decrypt balances.');
      return;
    }
    const handle = tokenKey === 'usdt' ? balances.usdtEncrypted : balances.zamaEncrypted;
    const contractAddress = tokenKey === 'usdt' ? contracts.usdt : contracts.zama;
    if (!handle || !isAddress(contractAddress)) {
      return;
    }
    try {
      setBusyAction(`decrypt-${tokenKey}`);
      const keypair = instance.generateKeypair();
      const contractAddresses = [contractAddress];
      const startTimestamp = Math.floor(Date.now() / 1000).toString();
      const durationDays = '1';

      const eip712 = instance.createEIP712(keypair.publicKey, contractAddresses, startTimestamp, durationDays);
      const signature = await signer.signTypedData(
        eip712.domain,
        {
          UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification,
        },
        eip712.message,
      );

      const result = await instance.userDecrypt(
        [{ handle, contractAddress }],
        keypair.privateKey,
        keypair.publicKey,
        signature,
        contractAddresses,
        address,
        startTimestamp,
        durationDays,
      );

      const clearValue = result[handle as `0x${string}`];
      if (typeof clearValue === 'bigint') {
        setBalances((prev) => ({
          ...prev,
          usdtClear: tokenKey === 'usdt' ? clearValue : prev.usdtClear,
          zamaClear: tokenKey === 'zama' ? clearValue : prev.zamaClear,
        }));
      }
    } catch (error) {
      console.error('Failed to decrypt balance', error);
      setStatus('Decryption failed. Check permissions and try again.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSetOperator = async () => {
    if (!isConfigured) {
      setStatus('Set contract addresses first.');
      return;
    }
    const signer = signerPromise ? await signerPromise : undefined;
    if (!signer) {
      setStatus('Connect a wallet to grant operator permissions.');
      return;
    }
    try {
      setBusyAction('operator');
      const until = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
      const usdtContract = new ethers.Contract(contracts.usdt, TOKEN_ABI, signer);
      const zamaContract = new ethers.Contract(contracts.zama, TOKEN_ABI, signer);
      const txUsdt = await usdtContract.setOperator(contracts.swap, until);
      await txUsdt.wait();
      const txZama = await zamaContract.setOperator(contracts.swap, until);
      await txZama.wait();
      setStatus('Operator permissions updated.');
    } catch (error) {
      console.error('Failed to set operator', error);
      setStatus('Failed to set operator permissions.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleMint = async (tokenKey: 'usdt' | 'zama') => {
    if (!address || !isConfigured) {
      setStatus('Set contract addresses first.');
      return;
    }
    const signer = signerPromise ? await signerPromise : undefined;
    if (!signer) {
      setStatus('Connect a wallet to mint tokens.');
      return;
    }
    const amount = parseTokenAmount(tokenKey === 'usdt' ? mintUsdt : mintZama);
    if (!amount) {
      setStatus('Enter a valid mint amount.');
      return;
    }
    try {
      setBusyAction(`mint-${tokenKey}`);
      const tokenAddress = tokenKey === 'usdt' ? contracts.usdt : contracts.zama;
      const tokenContract = new ethers.Contract(tokenAddress, TOKEN_ABI, signer);
      const tx = await tokenContract.mint(address, amount);
      await tx.wait();
      setStatus(`${tokenKey.toUpperCase()} minted.`);
      setRefreshIndex((prev) => prev + 1);
    } catch (error) {
      console.error('Mint failed', error);
      setStatus('Mint failed. Check wallet balance and permissions.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleAddLiquidity = async () => {
    if (!isConfigured) {
      setStatus('Set contract addresses first.');
      return;
    }
    const signer = signerPromise ? await signerPromise : undefined;
    if (!signer) {
      setStatus('Connect a wallet to add liquidity.');
      return;
    }
    const usdtAmount = parseTokenAmount(liquidityUsdt);
    const zamaAmount = parseTokenAmount(liquidityZama);
    if (!usdtAmount || !zamaAmount) {
      setStatus('Enter valid liquidity amounts.');
      return;
    }
    try {
      setBusyAction('add-liquidity');
      const swapContract = new ethers.Contract(contracts.swap, SWAP_ABI, signer);
      const tx = await swapContract.addLiquidity(usdtAmount, zamaAmount);
      await tx.wait();
      setStatus('Liquidity added.');
      setRefreshIndex((prev) => prev + 1);
    } catch (error) {
      console.error('Add liquidity failed', error);
      setStatus('Failed to add liquidity.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRemoveLiquidity = async () => {
    if (!isConfigured) {
      setStatus('Set contract addresses first.');
      return;
    }
    const signer = signerPromise ? await signerPromise : undefined;
    if (!signer) {
      setStatus('Connect a wallet to remove liquidity.');
      return;
    }
    const lpAmount = parseLpAmount(lpToRemove);
    if (!lpAmount || lpAmount === 0n) {
      setStatus('Enter a valid LP amount.');
      return;
    }
    try {
      setBusyAction('remove-liquidity');
      const swapContract = new ethers.Contract(contracts.swap, SWAP_ABI, signer);
      const tx = await swapContract.removeLiquidity(lpAmount);
      await tx.wait();
      setStatus('Liquidity removed.');
      setRefreshIndex((prev) => prev + 1);
    } catch (error) {
      console.error('Remove liquidity failed', error);
      setStatus('Failed to remove liquidity.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSwap = async () => {
    if (!isConfigured) {
      setStatus('Set contract addresses first.');
      return;
    }
    const signer = signerPromise ? await signerPromise : undefined;
    if (!signer) {
      setStatus('Connect a wallet to swap.');
      return;
    }
    const amountIn = parseTokenAmount(swapAmount);
    if (!amountIn || !swapQuote) {
      setStatus('Enter a valid swap amount.');
      return;
    }
    const parsedSlippage = Number.parseInt(slippageBps || '0', 10);
    const safeSlippage = Number.isFinite(parsedSlippage) ? parsedSlippage : 0;
    const slippage = Math.min(Math.max(safeSlippage, 0), MAX_SLIPPAGE_BPS);
    const minOut = (swapQuote * BigInt(10_000 - slippage)) / 10_000n;
    try {
      setBusyAction('swap');
      const swapContract = new ethers.Contract(contracts.swap, SWAP_ABI, signer);
      const tx =
        swapDirection === 'usdtToZama'
          ? await swapContract.swapExactUsdtForZama(amountIn, minOut)
          : await swapContract.swapExactZamaForUsdt(amountIn, minOut);
      await tx.wait();
      setStatus('Swap confirmed.');
      setRefreshIndex((prev) => prev + 1);
    } catch (error) {
      console.error('Swap failed', error);
      setStatus('Swap failed. Check slippage and balances.');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="swap-app">
      <Header />
      <main className="swap-main">
        <section className="hero">
          <div className="hero-copy">
            <span className="pill">FHE-powered AMM</span>
            <h2>Trade fUSDT and fZama with encrypted balances.</h2>
            <p>
              StealthSwap keeps balances confidential while giving you clear control over liquidity and pricing.
              Decrypt only when you want to reveal a value.
            </p>
            <div className="hero-status">
              <div className="status-chip">
                <span>Status</span>
                <strong>{isConnected ? 'Wallet connected' : 'Wallet not connected'}</strong>
              </div>
              <div className="status-chip">
                <span>Relayer</span>
                <strong>{zamaLoading ? 'Initializing' : zamaError ? 'Offline' : 'Ready'}</strong>
              </div>
            </div>
          </div>
          <div className="hero-panel">
            <div className="metric">
              <span>Pool price</span>
              <strong>{tokenPrice ? `${tokenPrice.toFixed(4)} USDT / Zama` : '--'}</strong>
            </div>
            <div className="metric">
              <span>Reserves</span>
              <strong>
                {formatToken(reserves.usdt)} fUSDT · {formatToken(reserves.zama)} fZama
              </strong>
            </div>
            <div className="metric">
              <span>LP supply</span>
              <strong>{formatLp(lpSupply)} SSLP</strong>
            </div>
            <button
              className="ghost-button"
              onClick={() => setRefreshIndex((prev) => prev + 1)}
              disabled={!isConfigured}
            >
              Refresh data
            </button>
          </div>
        </section>

        <section className="grid">
          <div className="card wide">
            <div className="card-header">
              <h3>Contract setup</h3>
              <p>Paste the deployed addresses to activate the dashboard.</p>
            </div>
            <div className="card-body form-grid">
              <label>
                <span>Swap contract</span>
                <input
                  value={contracts.swap}
                  onChange={(event) => setContracts((prev) => ({ ...prev, swap: event.target.value.trim() }))}
                  placeholder="0x..."
                />
              </label>
              <label>
                <span>fUSDT token</span>
                <input
                  value={contracts.usdt}
                  onChange={(event) => setContracts((prev) => ({ ...prev, usdt: event.target.value.trim() }))}
                  placeholder="0x..."
                />
              </label>
              <label>
                <span>fZama token</span>
                <input
                  value={contracts.zama}
                  onChange={(event) => setContracts((prev) => ({ ...prev, zama: event.target.value.trim() }))}
                  placeholder="0x..."
                />
              </label>
              <div className="config-state">
                <span>Configuration</span>
                <strong>{isConfigured ? 'Valid' : 'Incomplete'}</strong>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3>Encrypted balances</h3>
              <p>Handles are displayed on-chain, decrypt only when needed.</p>
            </div>
            <div className="card-body">
              <div className="token-row">
                <div>
                  <span>fUSDT handle</span>
                  <strong className="mono">{balances.usdtEncrypted || '--'}</strong>
                  <em>Clear balance: {formatToken(balances.usdtClear)}</em>
                </div>
                <button
                  className="action-button"
                  onClick={() => handleDecrypt('usdt')}
                  disabled={!balances.usdtEncrypted || zamaLoading || !!zamaError || busyAction === 'decrypt-usdt'}
                >
                  Decrypt
                </button>
              </div>
              <div className="token-row">
                <div>
                  <span>fZama handle</span>
                  <strong className="mono">{balances.zamaEncrypted || '--'}</strong>
                  <em>Clear balance: {formatToken(balances.zamaClear)}</em>
                </div>
                <button
                  className="action-button"
                  onClick={() => handleDecrypt('zama')}
                  disabled={!balances.zamaEncrypted || zamaLoading || !!zamaError || busyAction === 'decrypt-zama'}
                >
                  Decrypt
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3>Wallet actions</h3>
              <p>Mint demo tokens and grant the pool operator access.</p>
            </div>
            <div className="card-body">
              <div className="inline-field">
                <input
                  value={mintUsdt}
                  onChange={(event) => setMintUsdt(event.target.value)}
                  placeholder="Mint fUSDT"
                />
                <button
                  className="action-button"
                  onClick={() => handleMint('usdt')}
                  disabled={busyAction === 'mint-usdt'}
                >
                  Mint fUSDT
                </button>
              </div>
              <div className="inline-field">
                <input
                  value={mintZama}
                  onChange={(event) => setMintZama(event.target.value)}
                  placeholder="Mint fZama"
                />
                <button
                  className="action-button"
                  onClick={() => handleMint('zama')}
                  disabled={busyAction === 'mint-zama'}
                >
                  Mint fZama
                </button>
              </div>
              <button
                className="primary-button"
                onClick={handleSetOperator}
                disabled={busyAction === 'operator'}
              >
                Grant pool operator permissions
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3>Liquidity</h3>
              <p>Initial price is fixed at 1 fZama = 2 fUSDT.</p>
            </div>
            <div className="card-body">
              <div className="inline-field">
                <input
                  value={liquidityUsdt}
                  onChange={(event) => setLiquidityUsdt(event.target.value)}
                  placeholder="fUSDT amount"
                />
                <input
                  value={liquidityZama}
                  onChange={(event) => setLiquidityZama(event.target.value)}
                  placeholder="fZama amount"
                />
              </div>
              <button
                className="primary-button"
                onClick={handleAddLiquidity}
                disabled={busyAction === 'add-liquidity'}
              >
                Add liquidity
              </button>
              <div className="inline-field">
                <input
                  value={lpToRemove}
                  onChange={(event) => setLpToRemove(event.target.value)}
                  placeholder="LP amount"
                />
                <button
                  className="action-button"
                  onClick={handleRemoveLiquidity}
                  disabled={busyAction === 'remove-liquidity'}
                >
                  Remove liquidity
                </button>
              </div>
              <div className="subtle">
                <span>Your LP balance</span>
                <strong>{formatLp(lpBalance)} SSLP</strong>
              </div>
            </div>
          </div>

          <div className="card accent">
            <div className="card-header">
              <h3>Swap</h3>
              <p>Read quotes with viem, execute with ethers.</p>
            </div>
            <div className="card-body">
              <div className="toggle-row">
                <button
                  className={swapDirection === 'usdtToZama' ? 'toggle active' : 'toggle'}
                  onClick={() => setSwapDirection('usdtToZama')}
                >
                  fUSDT → fZama
                </button>
                <button
                  className={swapDirection === 'zamaToUsdt' ? 'toggle active' : 'toggle'}
                  onClick={() => setSwapDirection('zamaToUsdt')}
                >
                  fZama → fUSDT
                </button>
              </div>
              <input
                value={swapAmount}
                onChange={(event) => setSwapAmount(event.target.value)}
                placeholder="Amount in"
              />
              <div className="quote-line">
                <span>Estimated out</span>
                <strong>{swapQuote ? formatToken(swapQuote) : '--'}</strong>
              </div>
              <label className="slippage">
                <span>Slippage (bps)</span>
                <input
                  value={slippageBps}
                  onChange={(event) => setSlippageBps(event.target.value)}
                  placeholder="50"
                />
              </label>
              <button className="primary-button" onClick={handleSwap} disabled={busyAction === 'swap'}>
                Swap now
              </button>
            </div>
          </div>
        </section>
        {status && <div className="status-banner">{status}</div>}
      </main>
    </div>
  );
}
