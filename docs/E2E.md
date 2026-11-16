# End-to-end tests

Two layers on top of the Vitest unit tests (`npm test`).

## Browser flows against a mocked node: `npm run e2e`

Playwright drives the real app (a Vite dev server on port 5174 is started for
you) while `e2e/mock-node.ts` answers the wallet's WebSocket JSON-RPC calls.
No network, funds or plasma are needed, and every block the wallet publishes is
captured and decoded with the SDK's contract ABIs, so the tests assert on the
exact method, arguments, token and amount that would go on chain.

Covered: keystore import, duplicate-wallet refusal, change password, network switch
(mainnet/testnet, wrong-chain node), Accelerator-Z, P2P swaps (start, join, unsafe
deposits), pillar
update, sentinel registration (QSR deposit + register), pillar name
validation, token issue, mint, burn and update.

- Add a scenario: create `e2e/<area>.e2e.ts`, build a `MockNode` with the RPC
  responses the screen needs (`handlers`, `balances`), `attach(page)`, then
  `decode(node.published[i])` to check what was sent.
- Methods the mock doesn't know return `null`; `node.unhandled` lists them.
- First time on a new machine: `npx playwright install chromium`.

## Live testnet checks: `npm run e2e:testnet`

`e2e/testnet/*.testnet.ts` run with Vitest against the public testnet
(https://testnet.zenon.info, chain 73404, RPC `https://rpc.testnet.zenon.info`).
They are skipped unless `TESTNET_MNEMONIC` is set:

```bash
TESTNET_MNEMONIC="word1 … word24" npm run e2e:testnet
```

- `deposit-qsr`: QSR deposit and withdrawal for sentinels.
- `swap`: a full HTLC swap between two wallets; also needs `TESTNET_MNEMONIC_B`
  (a second funded testnet wallet). Takes about 10 minutes with PoW.
- `accelerator`: creates a project (costs 1 testnet ZNN); also needs
  `TESTNET_ACCELERATOR=1`.

Use a throwaway testnet-only wallet funded from the faucet
(https://faucet.zenonhub.io/, 10 ZNN + 100 QSR per 24h). Without plasma each
block needs PoW, so a run takes a few minutes. `TESTNET_RPC` and
`TESTNET_CHAIN_ID` override the defaults.

The faucet drip is too small to register a sentinel (5,000 ZNN + 50,000 QSR)
or a pillar, so those are covered by the mocked flows; the live test checks the
QSR deposit and withdrawal they depend on.
