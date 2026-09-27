# Frontend validation

Worker validation for the Lockvote frontend, 2026-09-27. This records checks performed by the implementing worker; it is not independent certification. The assignment's service verifier checks permitted paths and bytes only.

## Scope and assumptions

One static English-language page built against the supplied deployment, with no contract modifications or redeployment. The approved workflow explicitly says **no in-page swap**; token acquisition is explained rather than implemented. Governance approval targets the verified treasury, not a swap router. All supplied network/Uniswap reference fields are preserved unchanged in the runtime manifest.

Source is in `web/`, final export in `dist/`, and evidence in `docs/evidence/`. The overriding allowed-path list excludes root `DESIGN.md`; the requested design documentation is therefore delivered as `docs/DESIGN.md`. Root configuration, root README, Solidity, tests and original ABI exports remain unchanged. The only changed ignore file is the explicitly budgeted `web/.gitignore`.

The treasury is a test toy holding donated Sepolia test ETH. The page and frontend README state that votes carry no off-chain rights, a quorum holder can pass an unopposed proposal, the delay only gives visibility, and competing proposals do not reserve funds.

## Build and deployment evidence

| Check | Result and evidence |
| --- | --- |
| Lockfile installation | `npm ci --prefix web --offline --cache /tmp/lockvote-npm-cache --no-audit --no-fund` passed, 90 packages. Cache was populated by the permitted initial network install; it is not included in Git. |
| Typecheck + production build | `npm run build --prefix web` passed after the final application edit. Includes `tsc --noEmit`, Vite and manifest generation. See `evidence/build.txt`. |
| ABI provenance | Both arrays were extracted via `git show dce714edd13163039b2a0f2d06b154944a1e776f:docs/abi/<Contract>.json`. Byte equality with pinned files and canonical hashes verified. No contract build or source modification was needed. |
| Deployment binding | `npm run validate --prefix web` verifies exact contract names/addresses/hashes, identifiers, unchanged network and exact wallet-add parameters. See `evidence/export-validation.txt`. |
| Asset inventory | Six assets plus the manifest, under 0.6 MB total export. All SHA-256 hashes recomputed from final bytes; manifest excludes itself. Relative `./assets/` base verified. Exact size is in `evidence/export-validation.txt`. |
| Browser/live RPC read | Chromium loaded the production export at `/preview/` against real public RPC, block **11791708**, and rendered **0 ETH / 0 proposals**. No browser errors or failed requests. See `evidence/live-browser.json` and `evidence/live-desktop.png`. |
| Configured RPCs | All three returned chain 11155111; token runtime 1,722 bytes and treasury runtime 4,293 bytes. Treasury `token()` matched the handoff. Blocks 11791634/11791633. See `evidence/live-rpc.json`. |

Canonical ABI Keccak-256 hashes (without `0x`):

- LaunchToken: `38880b8e56d42ce900f744a7908c7139632a49f1c3f33385c64ceaed29d37bee`
- LockVoteTreasury: `025a67cb2802cf1090ca7faa43f14686a723f0281f03af4cb002afd42da85394`

Vite reports an advisory warning that the main JS chunk is just above its default 500 kB threshold. The complete export is far below the assignment size/response limits. There are no source maps, remote fonts, registry archives, dependency directories or package-manager caches in the submission. The remaining large dependency directories are ignored local installation state only.

## Browser and interaction checks

The provided browser MCP returned `Transport closed` and supplied no usable preview. A permitted fallback was used: Playwright Chromium **141.0.7390.37**, a script-managed foreground HTTP server with `/preview/`, and teardown in `finally`. This executed and rendered the actual production export, not a component-only substitute. Screenshots were opened and visually inspected after capture. No real transaction was sent.

Command: `PLAYWRIGHT_BROWSERS_PATH=/tmp/lockvote-browsers npm test --prefix web`. Detailed results: `evidence/interactions.json`; command output: `evidence/browser-tests.txt`. The suite checks:

- Disconnected action gates, missing wallet and recovery, all six proposal state labels.
- Wrong-chain gates and switch → unknown chain → exact `wallet_addEthereumChain` → switch sequence.
- Exact treasury allowance approval, separate lock after confirmation, state refresh, and exact unlock amount.
- Zero/negative/overprecision/over-balance amount errors; invalid recipient; error focus and `aria-invalid`; correct ETH and description-hash encoding.
- Irreversible vote review, both support directions, locked token freeze and already-voted gates.
- Insufficient treasury ETH gate; executable proposal ID; updated balance and state after payment.
- Wallet rejection, simulation failure before signature, decoded `InsufficientETH` recovery text, donation value, review cancellation without a transaction, and mined revert without a success claim.
- Bounded proposal pagination and account-change invalidation of open reviews/data.
- Missing code, treasury/token mismatch, RPC failure and recovery; altered ABI JSON fails closed before connection controls exist.
- Keyboard review opening, initial Cancel focus, inert background, Tab behavior, Escape and focus return. Chromium may move through browser chrome before wrapping, while background controls remain inaccessible.
- 1440×1000, 768×1000 and 320×1000 viewport reflow, empty state, 200% root font-size enlargement at 768px, reduced-motion behavior, no console errors or failed local assets.

Mock wallet and RPC responders are confined to the validation script and never bundled. They assert actual transaction calldata, values and ordering at the EIP-1193/JSON-RPC boundary while exercising real wagmi/viem browser code. They do not establish contract correctness. Real RPC/browser checks independently validate read-only connectivity and deployment presence.

## Better Interface consolidated review

The locally pinned workflow, all six core domains, and documentation method were read and applied during implementation. Review coverage uses the supplied guide's distinctions between source, rendered and unperformed checks.

| Domain | Coverage | Evidence and limits |
| --- | --- | --- |
| Accessibility | **Checked** | Native labels/buttons/details/dialog, one main/h1, skip link, status/alert regions, field error associations, focus, keyboard flow and target sizing. Axe WCAG 2 A/AA and 2.1 AA scans report **zero violations** at all three widths in `accessibility-*.json`. Screen-reader and physical-device sessions were not performed. |
| Layout | **Checked** | Shared alignment edges, sensible grouping, responsive stacking, wrapping control rows, readable full addresses/hashes. Measured no horizontal overflow at 320/768/1440; text enlargement checked. Native browser zoom, RTL and translation variants were not tested. English/light theme are the supported variants. |
| Writing | **Checked** | Explicit approve → lock, irreversible vote/donation review, clear empty state, recoverable errors, test-only notice, quorum/majority/window/funding rules. No backend or promise of recoverable on-chain description text. |
| Typography | **Checked** | Descending hierarchy, readable input size, tabular numbers, exact bigint formatting, long identifiers wrap, bounded rules measure. Screenshot inspection confirms actual wrapping. Rendering on other platform font stacks is unverified. |
| Colors | **Checked** | Semantic roles and textual status cues. Seven foreground/background pairs measured from rendered computed colors, all ≥4.5:1 (`contrast.json`); axe contrast checks also passed. Light theme only; no claim of every possible pair/state or OS configuration. |
| UI | **Checked** | Outlined/default, selected segment, disabled, loading, error, empty, transaction review and populated states. Visible keyboard focus inspected in `review-desktop.png`. Reduced-motion removes optional transitions. Native controls and restrained surfaces. No custom entrance animation requiring slow replay. |

Rendered screenshots: `live-desktop.png` is actual live read-only state; `connected-1440.png`, `connected-768.png`, `connected-320.png`, `controls-320.png`, `proposal-320.png`, `review-desktop.png`, and `empty-desktop.png` use declared mock state. Screenshots are evidence, not production assets or sample data shown to visitors.

## Findings, fixes and rechecks

| Severity | Source location | Finding and disposition |
| --- | --- | --- |
| High, fixed | `web/src/App.tsx:200`, `web/src/model.ts` read helper | Initial typecheck caught an unextended connector client used for writing and optional dynamic-ABI args. Use wagmi's wallet client and explicit args arrays. Final build passes and calldata flows execute in the browser suite. |
| Medium, fixed | `web/src/App.tsx:250` | Initial custom amount/address validation used only a global error. Added inline associated error text, invalid state and focus to the failing field. Invalid-input browser cases now assert focus and `aria-invalid`; final axe checks pass. |
| Medium, fixed | `web/src/model.ts:75` (`errorText`) | Viem's short message can omit decoded custom error names. Walk the error cause to retain the contract error and provide recovery guidance. The final simulated `InsufficientETH` case checks the displayed name and verifies no wallet send request occurs. |
| Medium, fixed; source-reviewed branch | `web/src/App.tsx:209` | A cancellation/different replacement receipt must not claim that the original operation succeeded. Track replacement reason, update the explorer hash and report replacement separately. Ordinary mined success/revert paths tested; actual replacement/cancellation receipt polling is not exercised. |

Two initial harness issues were corrected without changing production behavior: accessible button queries must exclude decorative `aria-hidden` arrows, and Chromium native dialog navigation can visit browser chrome between Tab cycles. The corrected tests exercise the actual accessible names and verify that no background control gains focus.

## Limitations and completion

Complete for the authorized frontend scope, with the root-design-file location exception documented above. Worker checks provide evidence only; they carry no independent authority.

Untested: real wallet signatures/broadcasts, live approval/lock/vote/payment flows, gas costs, real recipient reverts, live proposal time-boundary transitions, competing on-chain proposals, reorg/timeout/replacement scenarios, WalletConnect, other browser engines, physical mobile devices, screen readers and native 200% browser zoom. The original Foundry/protected tests were read as interface context but were not rerun or modified in this frontend stage. No Solidity correctness claim is made by browser mocks.

Read-only RPC success is a point-in-time observation. No hosting, IPFS pinning, site naming, immutable-CID checks or control-plane publication checks were performed; those are subsequent publisher/control-plane work and are not prerequisites for this delivery. The app does not cryptographically authenticate the handoff itself; publication binds the configuration to the attested source.

## Submission packaging

The workspace Git metadata is mounted read-only. `git add -- web dist docs` failed with `Unable to create .git/index.lock: Read-only file system`; no workspace commit was created. All deliverables remain in the permitted working-tree paths for network collection. `evidence/submission-scope.json` records the path/dependency/submodule check. A separate disposable checkout under `test/scratch/` is used only to construct and size a complete candidate Git bundle; its metadata and bundle are not part of the delivered frontend. This validates the 8 MiB packaging budget without modifying the protected repository metadata.

The complete candidate bundle (including the original repository history and all delivery files) measured approximately **1.20 MB**, below **8,388,608 bytes**. A final `git bundle verify` and byte-limit assertion were run in the disposable checkout. This is a packaging check, not a commit in the original workspace or a published submission.
