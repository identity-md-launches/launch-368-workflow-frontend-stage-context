# Lockvote frontend

One static React + TypeScript page for the deployed LockVoteTreasury and LVOT token. It supports browser-wallet connection, explicit exact-amount approval, locking, unlocking with the unlock time, proposals, both vote directions, execution, and voluntary test ETH donations. Treasury ETH, wallet LVOT, allowance, locked balance, proposal states and tallies come from contract reads.

This is a Sepolia test toy. The treasury holds donated Sepolia test ETH only; LVOT votes carry no off-chain rights. Obtain LVOT by swapping Sepolia ETH in the factory-seeded launch pool with a compatible Uniswap v4 interface. The approved workflow explicitly excludes an in-page swap. There is no token faucet or treasury allocation for users.

## Install, build and preview

Use Node 22 and npm. From the repository root:

```sh
npm ci --prefix web
npm run build --prefix web
npm run preview --prefix web -- --host 127.0.0.1
```

`package-lock.json` pins dependencies. Installation may use the network; build and typecheck require no network after installation. With an already populated npm cache, installation can also run offline:

```sh
npm ci --prefix web --offline --cache /path/to/populated/npm-cache
```

The worker verified this with `/tmp/lockvote-npm-cache`. That machine cache is not a deliverable or a dependency of the export. There is deliberately no vendored registry. `web/.gitignore` excludes nested dependency, cache and test-report directories. Never add them to Git.

`npm run build` typechecks, runs Vite with `base: './'`, writes repository-root `dist/`, copies verified ABI JSON, then generates `dist/imd-deployment.json`. The committed export is ready for a static host or IPFS gateway subpath. It uses anchors, no server routing, CDN fonts, backend or indexer. Always rebuild the manifest after any export change. The publisher hosts the committed bytes; this worker neither publishes nor deploys.

For development run `npm run dev --prefix web`, but use a built preview for deployment testing: the runtime deployment and ABI files are generated into `dist/`. To use the Vite development server, first copy `dist/imd-deployment.json` and `dist/abi/` into a local `web/public/` directory, and remove those development copies before delivery. The production preview requires no such copies.

## Deployment source of truth

- `deployment/handoff.json` and `deployment/network.json` preserve the supplied deployment inputs. Source commit: `dce714edd13163039b2a0f2d06b154944a1e776f`.
- `deployment/abi/*.json` were obtained verbatim using `git show <sourceCommit>:docs/abi/<Contract>.json`. These are the implementation-derived compiler ABI arrays, including errors and events. The original Solidity and `docs/abi/` files remain unchanged.
- `scripts/export.mjs` verifies canonical Keccak-256 for each ABI (recursively sort object keys, preserve array order, compact JSON, UTF-8). Both hashes match the handoff. The script copies the complete contract set, IDs, attestation and unchanged network object into the generated manifest. `walletAddChain` is an additional manifest field preserving the supplied parameters.
- `src/config.ts` fetches that same manifest and referenced ABIs at runtime, validates their canonical hashes, and creates the public client and wagmi wallet configuration. There is no independent runtime address, ABI, RPC or chain map. Public addresses inside test fixtures are read from the manifest or are synthetic wallet/recipient addresses.
- Every exported file except the manifest has a lowercase SHA-256 entry. `scripts/validate.mjs` verifies exact inventory, bytes, ABI bindings, handoff fields, network equality, relative base and size limits. The handoff and source ABI copies are needed to rebuild after `.imd/reads/` is removed.

Runtime verification checks the configured RPC chain ID, nonempty code for both contracts, and `LockVoteTreasury.token()` equality with the attested token before enabling writes. Token balance and allowance use this verified linked address. This establishes configuration consistency and code presence, not independent cryptographic proof of the deployment attestation or a full runtime bytecode audit. Asset SHA-256 verification against the immutable publication belongs to the control plane.

## Reads, wallet and transactions

Public reads work before connection through the supplied fallback RPC list. Wallet-specific reads begin after connection. Generic injected Ethereum browser wallets are supported through wagmi; no WalletConnect project ID was provided, so remote WalletConnect is not included. The implementation follows [wagmi's core configuration](https://wagmi.sh/core/api/createConfig) and [connection actions](https://wagmi.sh/core/api/actions/connect). To support a remote connector later, supply its public project ID and add it at the single configuration boundary.

Wrong-network state is visible and all writes are disabled. Switching first requests `wallet_switchEthereumChain`; unknown-chain/4902 failure offers `wallet_addEthereumChain` with the exact supplied parameters, then switches again. Rejection remains an actionable error. Account and network changes close an open review and invalidate account-specific data.

Snapshots read a single block, using treasury views and `proposalCount()`. Six proposals per page are ordered newest first. No log queries are needed; therefore there is no unbounded historical event scan. Were logs added, they would need bounded deployment-block chunks. Every 15 seconds, manual refresh and confirmed/failed transactions trigger new snapshots. Re-reading views also replaces reorganized data rather than accumulating event-derived history. Snapshots expire after 45 seconds; RPC blocks older than 180 seconds are rejected. Device clock accuracy affects that freshness guard. RPC failure leaves labeled stale data visible and disables writes.

Before every signature: recheck deployment and wallet, simulate the intended call, recheck the wallet, then ask the wallet to sign. The native review dialog shows the actual amount, recipient/spender and consequence. Approval sets the requested allowance, never an unlimited allowance. Wait for the approval receipt before a separate lock request. Amounts use exact bigint parsing with token decimals, never floating point. Field errors identify and focus the failing input.

Pending, successful, rejected, simulated-revert and mined-revert states are distinct; submitted transactions link to the configured explorer. Replacement hashes update the link; cancellations or different replacements do not claim the original call succeeded. Receipt confirmation is one confirmation, not finality. A timeout may leave an on-chain transaction pending; inspect its explorer link before retrying. Public RPCs serve reads; the wallet only signs. No private credentials are used.

## Contract rules reflected in the page

- Proposing needs 100,000 LVOT locked. Recipient must be nonzero and ETH amount positive. Only the Keccak-256 hash of exact UTF-8 description text is stored; share the text separately. No backend reconstructs descriptions.
- Voting lasts 3 days. Each address votes once at its locked balance at the moment of voting. Later locks do not add to an existing vote. Voting freezes the entire locked balance through the latest vote end.
- Passage requires strictly more for than against and at least 1,000,000 LVOT combined votes; ties fail. Whoever locks a quorum can pass an unopposed proposal.
- A passed proposal executes in `[voteEnd + 1 day, voteEnd + 15 days)`. The delay gives visibility only. Execution is permissionless. ETH is not reserved, so competing proposals are paid first come, first served. Insufficient ETH disables execution in the page. A rejecting recipient can still revert; simulation surfaces that error.
- Donations are irreversible, add no voting power, and leave only through successful proposals. There is no owner, admin, pause or upgrade control.

## Validation

```sh
npm run typecheck --prefix web
npm run validate --prefix web
PLAYWRIGHT_BROWSERS_PATH=/tmp/lockvote-browsers node web/node_modules/playwright/cli.js install chromium
PLAYWRIGHT_BROWSERS_PATH=/tmp/lockvote-browsers npm test --prefix web
node web/scripts/live-check.mjs
PLAYWRIGHT_BROWSERS_PATH=/tmp/lockvote-browsers node web/scripts/browser-live.mjs
```

The browser scripts manage their own bounded foreground preview server under `/preview/` and close it and Chromium on exit. `npm test` mocks EIP-1193 and public RPC at the transport boundary while exercising the actual exported app, wagmi and viem. It never sends a real transaction. The separate live checks only read public RPCs. Browser evidence and machine-readable results are committed in `docs/evidence/`; see `docs/VALIDATION.md` for coverage, fixes and limitations, and `docs/DESIGN.md` for the implemented design. `DESIGN.md` is under `docs/` because the assignment forbids root-file writes.
