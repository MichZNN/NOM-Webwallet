# Fork work vs. the new design

Status: 2026-11-16.

The fork (MichZNN/NOM-Webwallet) adds about 19,000 lines on top of upstream `main`, mostly logic in
`src/core` with 365 unit tests and 31 end-to-end tests. About half of it overlaps screens in the new
design; the rest is features the design does not cover yet. Proposal: the new design owns the UI, and
the fork offers its `src/core` logic upstream as small pull requests.

## Feature comparison

The design covers 12 of the 19 rows below. Where both exist, the design's screen wins and the fork
offers the logic behind it. Paths are in the fork; test counts are unit tests unless marked e2e
(mocked node) or testnet (live).

| Feature | In the new design | In the fork | Tests |
| --- | --- | --- | --- |
| PoW off the main thread under a strict CSP | PoW overlay (blocking) | `src/core/web-pow-provider.ts`, `public/pow-worker.js` | e2e PoW at difficulty 5000 under the production CSP |
| Send / tracker / send overlay | Yes | Upstream PR #21 code, merged in | Upstream tests |
| WalletConnect + dApp approvals | Yes | Upstream PR #20 code, merged in | Upstream tests |
| Auto-receive | "Receive all" button only | `src/core/auto-receiver.ts` | 6 |
| Activity / history | Activity page | `src/core/history.ts`, `HistoryTab.vue` | 7 |
| Change password | Dialog | `wallet-service.ts` (re-encrypts only) | 6 |
| Recovery phrase import | One field with a live word check | `src/core/mnemonic-input.ts`: word-by-word fields with suggestions, or paste; password fields appear once the checksum is valid | 5 + 3 e2e |
| Issue / mint / burn / manage tokens | Yes | `src/core/token-rules.ts`, `token-admin-service.ts`, `pages/Tokens.vue` | 6 + 2 e2e |
| HTLC create / unlock / reclaim | Raw HTLC pages, proxy unlock | `src/core/swap-service.ts` (used by swaps, see below) | 14 + e2e + testnet |
| Network: node + chain id | Settings · Network, change from a link | `src/core/networks.ts` | e2e |
| Plasma, staking, delegation, rewards | Yes | Upstream code, unchanged | — |
| Phones / responsive | Full phone layouts | Not done | — |
| Mainnet/testnet switch with banner, faucet and testnet explorer links | No (chain id field only) | `networks.ts`, `NetworkBanner.vue`, `NetworkSwitch.vue` | e2e |
| P2P swaps (derived secret, durations, recovery from chain) | No | `swap-rules.ts`, `swap-service.ts`, `swap-recovery.ts`, `pages/Swaps.vue` | 14 + e2e + testnet |
| Ledger hardware wallet | No | `src/core/ledger/*`, see `docs/LEDGER.md` | 12 + e2e (fake device) |
| Accelerator-Z: projects, phases, voting, donations | No | `accelerator-rules.ts`, `accelerator-service.ts`, `pages/Accelerator.vue` | 12 + e2e + testnet |
| Register / manage your own pillar and sentinel | No (delegation only) | `node-rules.ts`, `node-service.ts`, `pillar-service.ts`, `pages/Nodes.vue` | 6 + e2e |
| Syrius keystore import / export | No | `src/core/syrius-keystore.ts` | 10 + e2e |
| Docker image + deploy | — | Fork only, not meant for upstream | — |

## Needs a screen in the design

Six fork features work today but have no place in the design. They need a page or a dialog in its
design system, drawn by the designer or built by the fork in it.

- **Accelerator-Z**: project list, phases, voting (only the pillar owner address can vote), donations,
  creating projects and phases.
- **Own pillar and sentinel**: registration requirements, deposit QSR, register, update rewards and
  producer address, revoke with its cooldown window.
- **P2P swaps**: start a swap, join one with the counterparty's HTLC ID, live state, and recovery of
  open swaps from the chain. This sits on top of the raw HTLC pages, so it could be a tab there.
- **Ledger**: connect, pick accounts, and confirm on the device during send. It touches onboarding, the
  wallet switcher and the send review.
- **Testnet**: an always-visible banner with faucet link while not on mainnet, plus a clear
  mainnet/testnet switch. The design's chain id field could stay as the advanced option.
- **Syrius keystore**: import a `.json` keystore at first run, export one from Settings · Wallets.

## Bugs that also affect upstream

The PoW one will hit the new PoW overlay as soon as the app is served with a strict CSP.

| Bug | Effect | Fix in the fork |
| --- | --- | --- |
| The SDK's PoW Blob worker inherits the page CSP, and the emscripten `pow.js` needs `'unsafe-eval'` | Any send without plasma fails with "PoW worker error: failed to load"; auto-receive stalls | Own module worker `public/pow-worker.js`; nginx gives only that file a CSP with `'unsafe-eval'`, the page CSP stays strict; 10-minute timeout terminates a stuck worker |
| znn-typescript-sdk 1.0.5: `depositQsr` sends ZNN | Pillar/sentinel QSR deposit sends the wrong token | Builds the call itself; fixed on SDK `main`, not yet released to npm |
| SDK 1.0.5: `createProject` sends 10 base units instead of 1 ZNN | Project creation is rejected by the chain | Builds the call itself; fixed on SDK `main`, not yet released |
| SDK 1.0.5: `PillarInfo.regularPillarType` is 1, chain uses 2 | Code that compares the constant to the chain's pillar type gets it wrong | The fork does not use the constant; reported to the SDK |
| `overflow-x-hidden` on the app wrapper makes it a scroll container | A sticky header with a top offset lands below its spot and overlaps content | `overflow-x-clip` |

Chain rules (amounts, name formats, cooldowns) in the fork are checked against go-zenon's
`vm/constants/embedded.go` and `vm/embedded/implementation/*`.

## Proposed pull requests to upstream

Small, logic-first pull requests, each with its tests, in this order. UI in each comes in the new
design system, or is left out until the design has the screen.

1. **PoW worker under a strict CSP**: `web-pow-provider.ts`, `pow-worker.js`, the nginx block. The PoW
   overlay needs it. (Branch `claude/upstream-pow-worker` in the fork, based on upstream `main`.)
2. **Fixes and small logic**: auto-receive, change password, the `overflow-x-clip` fix, SDK workarounds
   for `depositQsr` and `createProject`.
3. **Recovery phrase input**: `mnemonic-input.ts` + a component in the new design (word-by-word and
   paste, the password step after a valid checksum).
4. **Tokens**: `token-rules.ts`, `token-admin-service.ts` behind the Issue token and Mint / burn /
   manage screens.
5. **Networks**: `networks.ts` + testnet banner, next to the chain id settings and network links.
6. **Pillar and sentinel management**: `node-rules.ts`, `node-service.ts`, once a screen exists.
7. **Swaps on HTLC**: `swap-rules.ts`, `swap-service.ts`, `swap-recovery.ts`, under the HTLC pages.
8. **Accelerator-Z**: `accelerator-rules.ts`, `accelerator-service.ts`, once a screen exists.
9. **Ledger**: `src/core/ledger/*`, once onboarding and send review have its states.
10. **Test harness**: the mocked-node Playwright setup (`e2e/mock-node.ts`) and the live testnet tests,
    if wanted upstream.

## Open questions

- [ ] Is the large update going to `dev` or `main`, and roughly when? The fork would base its pull
      requests on it.
- [ ] Does the new design replace `nom-ui`, or extend it with the Zenon NoM design system from the
      design file?
- [ ] Who draws the six screens in "Needs a screen in the design": the designer, or the fork builds them
      in the design system for review?
- [ ] Is the extension popup's scope final (no rewards, pillars or staking there), and should Ledger
      work in the extension?
- [ ] Should the e2e harness and testnet tests go upstream, or stay in the fork?

The fork stops adding screens in the current style until this is agreed; bug fixes continue.
