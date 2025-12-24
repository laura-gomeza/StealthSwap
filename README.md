# StealthSwap

StealthSwap is a privacy-first automated market maker (AMM) built on FHEVM. It implements a Uniswap v2-style pool for
fUSDT and fZama where balances and transfers remain encrypted on-chain, while users can explicitly decrypt their own
balances in the frontend when needed.

## Project Goals

- Deliver a functional AMM with confidential balances and swaps.
- Enforce the initial price of 1 fZama = 2 fUSDT at pool bootstrap.
- Provide a usable frontend that shows encrypted balances by default and supports explicit decryption.
- Keep the system simple, testable, and easy to deploy to Sepolia.

## Problems This Project Solves

- Public on-chain swaps expose trade sizes and wallet balances.
- Liquidity providers reveal positions and can be targeted by MEV.
- Traditional AMMs are not compatible with confidential token standards.

## Solution Overview

- fUSDT and fZama are confidential ERC7984 tokens where balances and transfers are encrypted using FHE.
- StealthSwap implements a constant-product AMM with a 0.3% fee (997/1000) and mints LP tokens for liquidity providers.
- The frontend reads encrypted balances, and optionally decrypts them using the Zama relayer flow.

## Key Advantages

- Privacy by default: encrypted balances and transfers stay hidden on-chain.
- Familiar AMM model: Uniswap v2-style constant product pricing and LP shares.
- Deterministic bootstrap: initial liquidity must satisfy the 2:1 fUSDT:fZama ratio.
- Straightforward integration: ABI and addresses are copied from deployment artifacts.

## Features

- Add liquidity with ratio checks and LP token minting.
- Remove liquidity for proportional token withdrawal.
- Swap exact input in either direction with slippage protection.
- Read pool reserves, LP supply, and LP balances.
- Mint test tokens (fUSDT, fZama) for local or testnet usage.
- Decrypt balances on demand, with explicit user consent.
- Read operations via viem, write operations via ethers.

## How It Works

### On-chain flow

1. Users mint or receive fUSDT and fZama.
2. Liquidity providers deposit both tokens. The first deposit must keep the 2:1 ratio.
3. The pool maintains a constant-product invariant and charges a 0.3% fee on swaps.
4. LP tokens (SSLP) represent a share of the pool and are minted/burned on add/remove.

### Frontend flow

1. The app reads encrypted balances and pool state using viem.
2. When a user clicks Decrypt, the relayer verifies the request and returns clear values.
3. Swap and liquidity actions are sent with ethers through the connected wallet.

## Tech Stack

- Smart contracts: Solidity 0.8.27, Hardhat, hardhat-deploy
- Privacy: FHEVM, Zama FHE libraries, ERC7984 confidential tokens
- Frontend: React, Vite, TypeScript, RainbowKit, wagmi
- Chain access: viem (reads) and ethers (writes)
- Styling: vanilla CSS (no Tailwind)

## Repository Layout

```
./
├── contracts/              # Smart contracts
├── deploy/                 # Hardhat deploy scripts
├── tasks/                  # Hardhat tasks
├── test/                   # Test suite
├── frontend/               # React + Vite frontend
├── docs/                   # Zama docs references
├── hardhat.config.ts       # Hardhat configuration
└── deployments/            # Deployment artifacts per network
```

## Smart Contracts

- `contracts/StealthSwap.sol` - AMM pool and LP token (SSLP) contract.
- `contracts/fakeUSDT.sol` - Confidential test token for fUSDT.
- `contracts/fakeZama.sol` - Confidential test token for fZama.
- `contracts/FHECounter.sol` - Sample contract from the FHEVM template.

## Configuration and ABI Sources

- Deployments write artifacts to `deployments/<network>/`.
- Copy the ABI arrays and addresses into `frontend/src/config/contracts.ts`.
- Keep ABIs in TypeScript, not JSON files, to match project constraints.

## Setup

### Prerequisites

- Node.js 20+
- npm

### Install dependencies

```
# root dependencies
npm install

# frontend dependencies
cd frontend
npm install
```

### Environment variables (backend only)

Create a `.env` in the project root for deployment and verification:

```
INFURA_API_KEY=your_infura_key
PRIVATE_KEY=your_private_key
ETHERSCAN_API_KEY=optional_etherscan_key
REPORT_GAS=optional
```

Notes:
- The deployer uses `PRIVATE_KEY` only. Do not use a mnemonic.
- The frontend does not use environment variables.

## Build, Test, and Deploy

### Compile

```
npm run compile
```

### Test

```
npm run test
```

### Local development deploy

Start a local JSON-RPC node at `http://localhost:8545` (Hardhat node or Anvil), then:

```
npx hardhat deploy --tags StealthSwap --network anvil
```

### Deploy to Sepolia

```
npx hardhat deploy --tags StealthSwap --network sepolia
```

After deployment, update `frontend/src/config/contracts.ts` with the addresses and ABI copied from
`deployments/sepolia/`.

## Frontend Usage

1. Ensure contract addresses and ABIs are set in `frontend/src/config/contracts.ts`.
2. Run the app:

```
cd frontend
npm run dev
```

3. Connect a wallet on Sepolia.
4. Mint test tokens (fUSDT and fZama) if needed.
5. Add liquidity, swap, or remove liquidity.
6. Click Decrypt only when you want to reveal balances.

## Design Constraints and Conventions

- Frontend avoids localhost network usage and does not rely on local storage.
- Frontend uses ethers for write transactions and viem for reads.
- ABIs are sourced from the deployment artifacts and kept in TypeScript.
- UI styling uses plain CSS, no Tailwind.
- View functions in contracts avoid `msg.sender` usage.

## Limitations

- Single pool (fUSDT/fZama) only.
- uint64 amounts cap balances and swap sizes.
- Not audited; use for testing and learning purposes.
- Decryption is explicit and reveals values to the user and relayer.
- FHE operations have higher computation costs than standard ERC20 transfers.

## Roadmap

- Add multiple pools and a factory/router pattern.
- Support dynamic fees and governance-controlled fee settings.
- Improve liquidity tooling (price ranges, LP analytics, fee accounting).
- Add robust slippage presets, gas estimation, and transaction batching.
- Expand testing coverage for edge cases and reentrancy scenarios.
- Integrate more networks and a better relayer UX.

## License

See `LICENSE` for details.
