# One website, two networks

Mainnet is the default and immediate live-testing network. Chipnet remains a separately selected, retained alternative. The November 2026 investigation is preserved unchanged in commit `ab083bf`, pushed by fast-forward after fetching and confirming that the local branch was exactly one commit ahead. The operator report was published as repository documentation as requested; it was not sent to an operator.

## Mainnet implementation

The existing V3 and RegistryAtomicV4 workflows use a mainnet Electrum provider, mainnet CashAddr prefixes, and mainnet public wallet derivations: direct genesis, covenant-controlled chained genesis, legacy two-approval genesis, V3 two-stage offers, Atomic V4 one-transaction offers, caller-funded reward claims, owner cancellation, unused commitment recovery, and matured stake withdrawal. No covenant bytecode or immutable vault parameters change.

Signing is enabled for a freshly connected matching mainnet Cashonize session. An xpub identifies the mainnet key family; it does not prove that the wallet is following BCH rather than another chain. The application independently resolves every transaction input on the selected BCH providers and pins both genesis and BCHN's CashTokens checkpoint at height 792773 (`000000000000000002fc0cdadaef1857bbd2936d37ea94f80ba3db4a5e8353e8`). See the [BCHN checkpoint source](https://github.com/bitcoin-cash-node/bitcoin-cash-node/blob/master/src/chainparams.cpp). Conflicting explicit wallet declarations are rejected. Existing provider disagreement latches, current-input checks, signed-plan comparison, BCH 2026 VM validation, maturity/finality checks, strict journals and fixed 10,000-satoshi transaction fees remain enforced.

Every new wallet spend requests explicit Cashonize approval with `broadcast:false`, showing MAINNET REAL BCH in the wallet prompt. The application checks the live authorization again after approval and verifies before broadcasting. A signed chained creation parent also authorizes its predetermined permissionless child; the legacy alternative requires two wallet approvals. Network selection alone never authorizes spending.

Mainnet public endpoints are `wss://bch.loping.net:50004` and `wss://bch.imaginary.cash:50004`. Provider verification does not constitute independently synchronized full-node consensus validation. The [read-only audit](mainnet-readonly.json) records fresh public agreement with no wallet or broadcasts. The mainnet shared catalog starts empty; public announcement discovery queries only mainnet. Empty discovery is not an invented vault or a claim of complete historical indexing.

## Separation and switching

The visible Mainnet / Chipnet selector uses a URL-scoped choice. Switching synchronously invalidates the wallet authorization context, aborts pending signing, terminates the V3 worker and rejects queued requests, then reloads at the selected network's vault list. The immutable worker name carries the selection into its provider initialization in both development and compiled builds. In-memory financial state and verified authorization are discarded. Saved records are retained, including when a transaction was approved but its broadcast outcome is uncertain.

| Data | Mainnet | Chipnet |
| --- | --- | --- |
| Configurations and stale display snapshots | `staking-arena-v3-configs-mainnet` and its `-snapshots` key | Existing `staking-arena-v3-configs-chipnet` and its `-snapshots` key |
| Wallet journal / signed bytes | `staking-arena-wallet-v3-mainnet` | Existing `staking-arena-wallet-v3-chipnet` |
| Legacy claim journal | `staking-arena-claims-v3-mainnet` | Existing `staking-arena-claims-v3-chipnet` |
| Cashonize transport pairing | `staking-arena-wizardconnect-v1-mainnet` | Existing `staking-arena-wizardconnect-v1` |
| Provider conflict evidence | `arena-mainnet-provider-conflicts` | Existing `arena-chipnet-provider-conflicts` |
| Shared catalog | `v3-vaults-mainnet.json` | Existing `v3-vaults.json` |
| Submission lock | `arena-mainnet-v3` | `arena-chipnet-v3` |

New persistent V3 journal records carry a network tag. Cross-network tags are rejected without deleting records. Untagged pre-existing records remain recoverable in their original chipnet/regtest stores and are rejected in mainnet stores. Regtest names are unchanged. Legacy V1/V2 data and recovery storage are preserved for chipnet; the mainnet interface uses V3/Atomic V4 and never starts the legacy chipnet indexer or reads its wallet journals. Switching is tab scoped, so another open tab's network and pending operation are not silently changed.

Contract and payout addresses use the selected network's prefix. Address-based input queries reject other networks. Imported public configurations remain untrusted hints until genesis/state replay succeeds on the selected blockchain. A chipnet vault is never migrated to mainnet.

## Chipnet limitation and restoration

Chipnet visibly reports **temporarily unavailable for transactions**. Wallet signing and V3 mutation/rebroadcast requests are blocked; the shared Electrum broadcaster independently rejects chipnet even if an older caller requests broadcast permission. Known configurations, catalogs, signed bytes, original wallet pairings, conflict evidence and stale display snapshots remain intact. Read-only discovery/replay can fail because the provider conflict remains unresolved; retained listings remain available and financial snapshots are historical, not spending authorization.

Both networks remain in the same application. Restoration requires repairing infrastructure and completing the [preserved consensus-upgrade requirements](chipnet-upgrade/README.md): independently establish the valid chain/activation boundary, implement tick-based 60000-tick coinbase maturity, 600-tick sequence-height units and tick-based height finality, preserve 512-second time-based CSV, then differentially test boundary-spanning inputs and 0-conf ancestry against the upgraded node. Re-audit the implicated provider and independently verify all inputs before restoring the chipnet transaction policy. Do not clear a conflict latch, exclude an inconvenient provider, or add a runtime flag that bypasses these checks. This is a targeted provider/consensus-policy upgrade within the retained application, not a replacement website or migration of vaults.

## Validation and live-testing boundary

The [validation record](dual-network-validation.json) covers 139 frontend tests, TypeScript checks, the production build and [production browser separation checks](dual-network-browser.json). All three isolated BCHN suites passed: [Atomic V4](dual-network-atomic-offer-results.json), [chained genesis](dual-network-chained-genesis-results.json), and [zero-confirmation workflows](dual-network-zero-conf-results.json). Earlier result documents are preserved unchanged. Synthetic-wallet and isolated-node tests cannot establish physical Cashonize acceptance or successful live BCH spending. No real BCH has been signed or spent by this change. Mainnet transaction controls are available after live wallet and input verification; the wallet owner must review and explicitly approve each real signing request in Cashonize. A successful live creation/offer/claim/withdrawal must be recorded separately before claiming end-to-end mainnet success.

Only the native Blaze source and website forks may receive source pushes and deployment. The original repositories, runtime node and original website are unchanged.


## Deployment and legacy browser coverage follow-up

The website fork publisher requires both network catalogs, keeps its exact public-file allowlist and original-repository refusal, and records `defaultNetwork: mainnet`, both supported networks, mainnet transaction availability and the chipnet transaction freeze. `walletTransactionVerified` remains false because physical Cashonize spending was not performed.

Legacy static/Electrum fixture builds explicitly select chipnet; they no longer inherit the product's mainnet default. Ten historical browser success cases for chipnet spending/automation remain marked `fixme` while the consensus freeze is active. Active replacement checks assert that even agreeing synthetic providers cannot broadcast, signed recovery bytes survive reload, and the Process Period control is unavailable. Restore the historical success cases only after independently completing the documented consensus upgrade. Read-only indexing, outage/reorg recovery and retained listings continue to run.
