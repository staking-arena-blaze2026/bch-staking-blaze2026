# Atomic linked-queue creation and offers

Post-baseline BCH Blaze 2026 work; replaces the earlier linked-queue creation path. No migration or contract version selector is retained.

## Original problem

The wallet first manufactured a queue output-zero coin if needed, then paid a constrained genesis seed covenant at output zero and announced that seed, then spent both in the actual genesis. This required two or three transactions and approvals. The seed was a way to enforce the original initial supply, rather than a CashTokens consensus requirement.

## Chosen genesis and security boundary

Two existing, distinct, token-free wallet output-zero UTXOs become the independent vault and queue category origins. Both ordinary P2PKH inputs, any additional funding, the single mutable non-minting vault NFT with an empty head and full reward reserve, the persistent queue minting root, the optional token reserve gate, public marker/announcement, token/BCH change, and the exact size-priced network fee are in one transaction. All wallet inputs are signed in one WizardConnect request with `broadcast:false`. Signed-byte validation and local VM execution precede broadcast of those identical bytes.

No seed covenant or seed-funding transaction exists. Genesis is accepted only after full origin authentication against independently verified ancestry. The indexer checks category identities, complete initial state, exact reserve backing, root script/capability, input assets, all change and listing outputs, and the absence of extra authority or token supply. It validates the signatures and VM as well. Canonical origin validation is a protocol security requirement: **consensus alone permits a malicious creator to mint extra NFTs at genesis**. Clients must reject such origins, including externally supplied configurations. Tests re-sign malformed, consensus-valid origins and verify their rejection. Once genesis authenticates, the unchanged linked-list covenant rules confine all minting authority.

Multiple categories in one transaction are explicitly supported by the [CashTokens specification](https://cashtokens.org/docs/spec/chip/). A shared category was rejected: a queue node's minting authority could forge the mutable vault-state NFT on which root and asset-gate authorization depend. Fixing that would require a broader and more costly authorization redesign. Two independent categories preserve the existing authenticated queue with fewer dependencies and bytes than the removed genesis covenant.

Offer insertion remains `q.insert()`: one transaction authenticates the controller, owner and insertion interval; commits the BCH stake or separate token escrow; mints the node; relinks its predecessor or vault head; preserves existing authorities; returns change; and pays its fee. Exact priority, ties after earlier equal-score nodes, independent disjoint insertion and ordinary UTXO conflicts remain enforced. No registration, funding or escrow preparation is performed.

## Wallet and recovery

Successful creation: **one transaction, one signing request, one approval**. Successful offer: **one transaction, one signing request, one approval**. Multiple input signatures are carried within that one request. The frontend displays counts, committed reserve/stake, exact planned fee and wallet BCH debit including fee before approval, plus signing, verification and broadcasting statuses.

Review evidence remains bound to the exact plan, intent, wallet descriptor, tip and fee policy. A durable requested-signing boundary prevents duplicate prompts. Explicit refusals permit a fresh review; unknown signing reserves the sources. Returned bytes are retained even across reconnection, then checked before submission. Lost acknowledgements and disconnected sessions retain signed recovery. Retries inspect status or rebroadcast identical bytes; confirmed competing spends are independently established before marking conflicts. A stale queue position needs a new explicit approval. Removed preparation steps have no continuation or automatic fallback.

## UTXO and asset limitations

Creation needs two spendable token-free output-zero UTXOs from different transactions, excluding parameter category collisions, within the verified wallet derivations. The builder conservatively does not use token-bearing outputs as category seeds, although consensus can support them. A wallet with zero or one eligible coin fails before a signature or broadcast. The message reports the count and suggests receiving two separate BCH payments; the application never makes those payments or prepares replacement coins. Incoming payments must actually produce spendable output-zero coins; a wallet balance alone cannot establish eligibility. Discovery can extend to 40 indices per available derivation path before returning the error. Reserved, immature, conflicting or independently unverifiable coins cannot be used.

The transaction needs enough BCH for reserve/carriers, listing, change and fee; token rewards also require the full fungible reserve. Up to 16 wallet funding inputs are selected, including the two category seeds; dust change requires more suitable funding. BCH/BCH, BCH/token, token/BCH, different-token/token and same-token/token combinations retain separate authenticated roles. Existing vault compatibility is not provided.

The 1,000-sat public discovery carrier is a separate output, not a miner fee. Protected vault/root carriers total 2,400 sats; token rewards add a 1,200-sat reserve carrier. Offer collateral and carriers are distinct from the size-priced network fee. Actual fees and validation results are recorded below after the focused runs complete.

## Verification

All network-spending tests use temporary isolated regtest BCHN instances with standard policy and activated BCH2026 rules, including a second loopback P2P relay node. No real Mainnet or Chipnet funds are broadcast. Signatures and WizardConnect calls are synthetic; physical Cashonize approval remains a wallet-owner acceptance test. Public deployments are checked read-only.

## Measured fees and completed checks

All values below are actual signed bytes and miner fees at 1 sat/byte from `atomic-performance.json`; creation includes the public listing and token change where applicable. Funding/token issuance before each test is fixture setup and is excluded.

| Staking / reward | Create | Empty-list offer | Ordinary offer |
| --- | ---: | ---: | ---: |
| BCH / BCH | 732 sats | 3,613 sats | 2,355 sats |
| BCH / token | 1,027 sats | 3,613 sats | 2,355 sats |
| Token / BCH | 732 sats | 3,908 sats | 2,650 sats |
| Different tokens | 1,027 sats | 3,908 sats | 2,650 sats |
| Same token | 1,027 sats | 3,908 sats | 2,650 sats |

Each of those 15 successful user actions has one transaction and one approval. Exact-token protocol-only fixtures without public listings also relay successfully at 533/755 sats for BCH/token reward creation. Fees vary with input count, token change, insertion position and verified policy.

- Artifact consistency, root and frontend TypeScript checks, and production Pages build passed.
- `npm run test:queue` passed all eight then-present suites, covering protocol, native indexer, wallet lifecycle and real BCHN relay. The expanded protocol run passed all seven suites including consensus-valid malformed origins and ineligible/duplicate category inputs.
- Native relay: 57 checks, 35 successful P2P propagations, all supported asset pairs, independently updated insertion positions, rejected same-predecessor conflicts, collateral/asset integrity and owner/maturity authorization.
- `npm run test:queue:atomic-assets` passed all five asset pairs, with complete wallet planning, authorization, synthetic Schnorr signing, byte validation and standard-policy BCHN admission for creation plus empty/ordinary offers.
- Focused frontend: 31 tests in QueueArena, queueWalletSigning, queueClient and walletRequest passed, including one WizardConnect request for each operation, reconnect retention, refusing stale authorization, review counts/debits and clearing stale estimates.
- The real-worker browser fixture passed with two WSS hosts, genesis verification, owner history and five viewport widths (320–1672 px), without public broadcasts.
- The first broad all-lifecycle performance run exceeded its ten-minute limit during concurrent validation. It was stopped and the focused atomic matrix passed separately. The benchmark retains its full lifecycle mode; the longer non-atomic actions are covered by the separate native lifecycle/relay suites. No production timeout was increased.

The checkout already contained uncommitted Phase 2 covenant, indexer and reviewed-plan optimizations. Those relevant dependencies are retained in this implementation and recorded separately in the historical Phase 2 reports; unrelated artwork, screenshots and marketplace benchmark changes are excluded from this release commit.

Reproduce the atomic asset matrix with `npm run test:queue:atomic-assets`, the protocol/indexer/wallet/relay suites with `npm run test:queue`, and the browser fixture with `npm --prefix frontend run test:queue:browser`. The website deployment is restricted to the native Blaze fork and its exact source revision is verified from the public release manifest after publication.
