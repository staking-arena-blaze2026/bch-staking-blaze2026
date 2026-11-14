# Fast v3 vault creation — BCH Blaze 2026

This work is post-baseline development in the native Blaze fork. Covenant sources and artifacts are unchanged. Mainnet remains disabled. No public chipnet transaction was signed or broadcast during verification.

## Authorization contract

Normal creation uses one transaction and one `manager.signTransaction` invocation. A token-free output zero is the first input; its transaction ID is the new state NFT category. Reward funding, covenant carriers, and safe BCH/token change are included atomically. Both confirmed and independently verified unconfirmed output-zero coins are eligible.

The explicit fallback uses **two transactions and two approvals**. The first funds the existing factory and full reward reserve. After both providers report it and its ancestry verifies, the user explicitly selects Continue in Transaction recovery to authorize genesis. No block is required. The application neither automatically signs the child nor represents these two requests as one authorization. An uncertain broadcast retains signed bytes; reconciliation never automatically allocates another spend.

The installed versions are `@wizardconnect/react` 0.2.3, `@wizardconnect/dapp` 0.2.2 and `@wizardconnect/core` 0.2.5. `SignTransactionRequest` contains a single `transaction` and `inputPaths`; the response contains a single `signedTransaction`. There is no supported dependent transaction package authorization field/API. Cashonize's [signing handler at ff731f9dacdc9b6ae0194292fa144da248f620b3](https://github.com/cashonize/cashonize-wallet/blob/ff731f9dacdc9b6ae0194292fa144da248f620b3/src/stores/wizardconnectStore.ts#L380) opens one transaction dialog and signs that request after its own approval. Sending two requests queues two dialogs. A single-interaction package fallback is therefore not supported by the inspected integration. Physical Cashonize prompts were not exercised; frontend tests count real manager API invocations against a mock manager and regtest counts local signing-harness authorizations.

## Why the previous creation failed

`scanWallet` discarded every history entry with height <= 0. `verifyCoins` separately rejected every unconfirmed wallet/covenant input. A wallet with no confirmed, token-free output zero could not supply the genesis seed, even if an otherwise valid output zero was already in the mempool. The indexer also required confirmed genesis/history, and funded action recovery waited for funding confirmation. All four barriers have been addressed for v3; other protocol versions retain their prior confirmation rules.

## Verification and provisional state

The v3 verifier checks selected output bytes/index/value/tokens and script ownership, then recursively validates unconfirmed ancestors up to Merkle/header-verified confirmed boundaries. It executes scripts and CashTokens conservation using the existing BCH 2026 VM, checks finality and relative locks, rejects immature coinbase dependencies, detects duplicate ancestor spends and competing spends reported in source histories, and requires matching ancestry/chain observations on two different provider hosts. Input availability is rechecked before approval, after signing, and on the pinned broadcast provider. Session-local raw/history caches avoid repeated ancestor reads and never cache authorization trust across sessions.

Application resource limits are 256 pending ancestors, depth 256, 4 MB of pending raw transactions and 1,024 total source transactions. These are client validation budgets, not a claimed BCHN consensus or mempool chain-count limit. [BCHN removed its ancestor/descendant count limits](https://docs.bitcoincashnode.org/doc/release-notes/release-notes-23.1.0/). Fee rates, standardness, mempool capacity, missing parents, local node configuration and propagation still affect relay; the actual broadcast remains authoritative for that provider's acceptance. Electrum observations cannot prove network-wide acceptance or rule out privately held double spends.

The indexer replays confirmed and validated pending lineage from scratch. Pending history is kept separate from confirmed history. A valid pending head may accept subsequent offers and claims; its allocations remain immature until their real confirmed time anchor matures. Missing/evicted/conflicting history withholds usable state. UI cards and vault details label provisional state. Reorganizations replay from current providers rather than trusting cached state. Existing IndexedDB names, journal schema and signed recovery records are preserved.

## Discovery and progress

V3 discovery interleaves receive/change/DeFi addresses by child index, prioritizes recently funded public keys, and reads six addresses concurrently per pinned provider. Each batch must agree across providers. It expands only while coin selection cannot cover the full transaction. Empty addresses are never permanently marked unused. Cached public address/outpoint observations are hints only; selected inputs are independently revalidated for every authorization and broadcast. The ordinary bound is 40 children per supported path; an explicit UI control expands it to 200 without triggering signing or a redundant full balance scan. Existing public-key derivation caching remains in use.

The Create Vault area displays preparation, discovery, input/ancestry verification, construction, approval, broadcast and pending stages. Errors appear immediately beneath the button. Expanding discovery and the two-approval fallback are explicit user actions.

## Reproducible evidence

- `ARENA_NETWORK=regtest npx tsx --test tests/blaze-zero-conf.test.ts` starts its own temporary BCHN 29.2 node on ports 18448/18449. It does not consult or mutate the original node. It checks confirmed and specifically selected unconfirmed output zero, no-seed fallback selection, parent/child without mining, all four staking/reward combinations plus same-category tokens, unspent unrelated NFTs, signed-plan tampering, refusal, journal failure, conflicting parent rejection, missing parents, provider disagreement, lost acknowledgement, reorganization and actual mempool eviction/recovery.
- `tests/blaze-funding-discovery.test.ts` checks early stop, sparse funds beyond gaps, cache reuse without trusting old balances, empty-address revisiting and provider disagreement.
- `tests/v3-indexer.test.ts` verifies provisional replay, immutable genesis layout, reserve/category conservation and conflicting lineage rejection.
- Frontend signing tests count one manager call for direct creation and two explicitly requested calls for the fallback. They check rejection, disabled wallet broadcasting, changed state and no signing while expanding discovery. UI tests check progress and errors below Create Vault.
- `zero-conf-results.json` records actual BCHN results and local request/timing benchmarks. The before path replays the previous full scanner and direct preparation/verification sequence; the after path measures adaptive discovery and time to the signing boundary. These are local RPC-backed Electrum measurements, **not public chipnet or physical-wallet latency**. No claim of faster public wall-clock time is made without that measurement.
- `fast-vault-browser-local.json` / `fast-vault-browser-deployed.json` record read-only production UI checks. Their WebSocket interceptors reject broadcasts.

## Recorded benchmark

Same 120-address fixture and confirmed funding state, before any broadcast. Before uses the committed baseline algorithm; after uses adaptive discovery. Counts are Electrum facade requests, including proof/header reads, without real socket handshakes.

| Measurement | Before | After |
| --- | ---: | ---: |
| Addresses checked | 120 | 6 |
| Discovery requests | 531 | 36 |
| Discovery time | 801 ms | 274 ms |
| Preparation through authorization verification requests | 639 | 144 |
| Backend preparation to signing boundary | 2,171 ms | 997 ms |
| Creation transactions / authorizations | 1 / 1 | 1 / 1 |

Browser key derivation, real WebSocket latency, UI scheduling and the physical Cashonize handoff are outside this backend timing. Complete click-to-physical-wallet latency was not measured. The fallback is two transactions / two authorizations. Each entire creation → offer funding → offer registration → claim regtest flow uses four transactions / four harness authorizations, with creation itself accounting for exactly one. Blocks are mined only between separate completed asset-pair flows, never inside a flow.

## Validation completed

Root and frontend TypeScript checks and the public production build passed. All 102 frontend tests in 22 files and all four v3 browser regression tests passed. The focused isolated BCHN test passed, as did the three adaptive-discovery unit tests and two v3 indexer/genesis unit tests. Browser tests exercise real workers against loopback WSS with synthetic proof fixtures; consensus acceptance is separately tested against BCHN 29.2. The existing isolated four-asset caller-funded claim regression also passed, including signature metadata substitution, diverted outputs, exact BCH change, independent caller funding and durable recovery; see `caller-fee-regression.json`. The source and website deployment revisions are reported with the final publication result.
