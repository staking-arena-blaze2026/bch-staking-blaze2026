# Shared wallet discovery for Create Vault and Make an Offer

Cashonize connection starts read-only discovery on both supported networks, regardless of the current route. Create Vault and Make an Offer use the same public derivation cache, Electrum candidates and provider-scoped immutable evidence. Newly connected wallets start with journal hints and receive/change/DeFi indices 0 and 1. Discovery advances through 8, 16, 24, 32 and 40 indices when needed. An independently verified atomic creation can stop early. A fallback quote follows the complete documented search, including authenticated funding hints, and displays its fees and approval count before signing. Offers continue in one transaction and one approval and select the vault’s staking asset and BCH funding for carriers and fees.

## Storage and verification

IndexedDB stores public child paths and keys, funded-address hints, candidate outpoints and provider tip hashes, and bounded confirmed raw transactions with their Merkle branches. Cache keys are SHA-256 fingerprints of the authenticated public paths and network. The original xpubs, wallet connection credentials, and private keys are absent from the discovery store. Recent candidate lists are reusable for 30 seconds and only for the exact independently observed tip of their provider. Funded paths are checked against the live wallet derivation before the workers use them. Cache records last saved more than seven days ago are ignored. Background refresh checks the ordinary paths and known funded paths, with progressive reads during initial discovery. A completed broadcast invalidates the scripts it touches. Wallet and network changes, failed input verification and provider conflicts invalidate the corresponding in-memory discovery state.

The candidate layer uses Electrum Cash’s token-aware listunspent metadata. Exact selected outputs are checked against raw transactions, token data, Merkle inclusion or independently validated unconfirmed ancestry, chain context and fresh availability. Restored Merkle evidence is rechecked against a live header, and confirmation is linked to the current tip. Authenticated queue state and the exact covenant and wallet inputs still gate Make an Offer. Current spendability, ancestry histories, relative locks and fee policy are rechecked at signing and broadcast. See [the Electrum Cash wire format](https://electrum-cash-protocol.readthedocs.io/en/latest/protocol-methods.html#blockchain-scripthash-listunspent).

A separate IndexedDB database holds discovery data. Cancellation, eviction, corruption or a failed cache write leave signed transaction recovery and durable reservations intact. The live transaction journal determines which candidate outpoints are reserved. Automatic preparation verifies the reserved funding and outputs of the retained signed transaction and can continue when providers independently see valid unconfirmed outputs. When two agreeing Electrum transports are available, the preparation transaction’s exact retained bytes are sent to both. Either matching transaction ID is enough to record submission, and the next step still needs independent live verification. Missing acknowledgements leave signed bytes available for recovery.

## Validation

Local verification included browser reload and a fresh Chromium process using the same profile, an aborted IndexedDB transaction, expired candidates, wallet and network isolation, Cashonize reconnect simulation, switching between creation and offers, BCH and CashToken funding, stale selected inputs, same-height forks, reorganizations, conflicting spends and provider disagreements. Isolated BCHN tests exercised standard policy and loopback P2P relay across both application configurations. One-, two- and three-approval creation paths were covered, including a separate two- and three-approval run that mined no blocks between approvals.

All timing measurements use isolated BCHN with synthetic wallet keys. The baseline is the wallet planner from source revision `44bedb89f988e1a20c957da28ff0118d7e2cf80a` running through the same local Electrum facade as the candidate planner. Its providers are serial aliases over a single isolated node. They reproduce method counts and controlled round trips but cannot measure public propagation or the physical Cashonize prompt. Creation timings are medians of three runs per case. Offer and repeat-connection comparisons are individual runs.

| Create Vault case | Time before → after | Electrum calls before → after |
| --- | ---: | ---: |
| Mainnet, initial addresses | 1.52 → 1.51 s | 124 → 66 |
| Chipnet, initial addresses | 2.89 → 2.17 s | 124 → 66 |
| Mainnet, origins at indices 22 and 23 | 1.88 → 1.23 s | 226 → 154 |
| Chipnet, origins at indices 22 and 23 | 2.60 → 1.89 s | 226 → 154 |

| Action and configuration | First connection | Repeat connection | Wallet and contract listunspent calls |
| --- | ---: | ---: | ---: |
| Create Vault, mainnet | 2.41 s | 1.26 s | 20 → 4 |
| Create Vault, chipnet | 1.43 s | 1.81 s | 20 → 4 |
| Make an Offer, mainnet BCH stake | 3.07 s | 1.65 s | 34 → 18 |
| Make an Offer, chipnet CashToken stake | 5.39 s | 3.27 s | 34 → 18 |

The repeat-connection comparison ends just before the synthetic signing request. It restores the discovery snapshot in a new wallet service. The separate Chromium test verifies actual IndexedDB readback across browser processes. The baseline Make an Offer samples were 7.32 s for mainnet BCH and 9.74 s for chipnet CashTokens. The chipnet repeat-creation sample took longer despite 16 fewer address lookups.

The three-sample mainnet initial-address tail rose from 1.93 to 2.10 seconds. The selected-input checks, background refresh and cache can save requests while transport load and host scheduling still vary. Fallback discovery without warm candidates, provider disagreement or mempool propagation, and Cashonize relay and user response are still observable delays. No automated test transmitted funds to public mainnet or chipnet.
