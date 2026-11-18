# Linked-list staking queue

Post-baseline BCH Blaze 2026 work. This replaces the public V3/V4 vault interface with a separate linked-list implementation; it does not migrate existing vaults or add a version-selection mechanism. The pre-existing source and deployments are preserved. The Drive prototype informed the layout, but its authorization checks were replaced.

Phase 2 reduces transaction scripts and repeats less financial preparation work. See [before/after results, security proofs and validation](phase2/README.md) and [measurement tables](phase2/tables.md).

## Architecture and invariants

- The vault category contains one **mutable, non-minting NFT**, created with a canonical empty head and fully funded reward reserve. A separate queue category starts with exactly one persistent minting root. Its commitment is `00`; it remains dormant while the list is nonempty.
- Each live offer is a minting NFT at the same immutable node covenant, bound to both categories and staking/reward assets. Its 121-byte commitment contains a stable ID, compressed owner key, stake/duration/reward, and successor ID plus immutable score. The vault commitment holds the authenticated head score/ID and remaining reserve.
- Ordinary insertion spends its predecessor and wallet funding. The predecessor is recreated with only its successor changed; exactly one new, correctly collateralized node is minted. Highest insertion additionally updates the vault and recreates the old head unchanged. Empty insertion uses and recreates the persistent root. No global registration input is spent for insertion below an existing node.
- Offer IDs hash the first consumed funding outpoint. A funding outpoint cannot be consumed twice. No other output can acquire a vault/queue authority: all output scripts, categories, capabilities, amounts and commitments are constrained. Canonical genesis excludes extra authorities and category collisions. Clients verify genesis and its chain-authenticated sources before trusting either category.
- Ordering uses exact cross-multiplication of `S × T / R`; products are below 2^75 under the enforced bounds and use BCH2026 BigInt rules. Equal scores can only insert after existing equal scores. Disjoint positions can update concurrently; the same predecessor conflicts normally under UTXO rules.
- BCH stakes remain in their individual node outputs. Token stakes use an individual escrow keyed by the stable offer ID. Reward-token reserves use a distinct gate. **Gates only release during node removal**; insertion cannot spend either an old offer escrow or the vault reserve. The reserve gate must be recreated at the claim's exact output position, protecting even the exhausted tokenless carrier. These checks were added after adversarial review found an insertion-release gap in the first implementation.
- Cancellation authenticates the removed node's owner, relinks its predecessor and returns the entire stake and its carriers in one action. Head claims authenticate the unique vault NFT and its exact successor; no queue traversal, roster, Merkle proof or period activation is needed in the covenant witness. Claims pay the head owner immediately and create an independent allocation locked to the same owner.
- Allocations enforce exact BIP68 time locks: `sequence = 0x400000 + durationSeconds / 512`. Website durations are whole units from 1 to 65,535. Withdrawal requires confirmation/MTP maturity and an owner signature; all stake and carrier value returns to that owner.
- Release accounting remains `released × cap − paid`, bounded by the remaining reserve. Temporarily unavailable rewards wait for MTP; a permanently unfundable head can be removed permissionlessly with the entire stake returned to its owner. Already paid allocations are independent of all subsequent queue operations.
- A transaction initiator supplies fee inputs. Protected reserves, stakes, and carriers balance exactly; they cannot be diverted into miner fees or caller change. No fixed 10,000-satoshi fee exists in this queue implementation. Plans converge to signed Schnorr byte count times the independently read relay-policy ceiling, with a minimum of 1 sat/byte. Wallet changes to the approved transaction body or fee fail local verification.

The shared node script does not include the schedule: the unique vault category binds it to the canonical schedule through authenticated genesis. Only the vault script performs reward accounting. Embedding an arbitrary vault category into a forged node script does not create a valid NFT of that category.

Atomic genesis consumes two ordinary token-free wallet `vout=0` coins from distinct transactions, creates both categories, the full reserve and all covenant outputs, and carries discovery in the same transaction. Complete chain-authenticated origin validation rejects extra supply, authority, malformed state and reserve shortfalls. There is no genesis seed covenant or preparation transaction. Creation requires one transaction and one approval; fewer than two eligible coins fails before signing. See [atomic genesis design and verification](atomic-genesis.md). The root is necessary for empty-list initialization and is never spent by normal claims or nonempty insertion. Asset gates are required because one output cannot carry two independent token categories. There is no shared stake escrow.

## Website, discovery and recovery

The existing branding, network selector, About page, wallet pairing restoration and explicit Cashonize approvals remain. Create Vault, public discovery, ranked offers, cancellation, claiming, My Offers (Waiting/Baked/Finished/Cancelled), and independent stake withdrawal use the new queue. Local-time release schedules show blockchain MTP separately; local time never authorizes a claim. Offline requests expire or cancel when the route, terms, pairing or network changes. Claims bind to the reviewed head before signing.

Discovery uses existing public Electrum markers and separate network-specific `public-index/queue` pages. The established Blaze deployment scanner now produces these pages. Announcements and saved browser configurations are hints, never financial authority. Direct announcement resolution, genesis, current UTXOs and transaction inputs must verify against independent providers. Unresolved announcements rotate through bounded work batches and are retained through outages.

The indexer traverses the current queue for display and insertion routing; owner archives replay node history. This is not a covenant claim witness. Financial claim preparation authenticates the vault/head without traversing the queue. Withdrawal preparation authenticates only the requested offer/allocation lineage without synchronizing the standing queue. Electrum still returns script-wide node candidates/history; preparation is not a constant-bandwidth claim. Electrum cannot prove history completeness or non-spending; independent provider agreement does not remove that trust boundary.

All actions share the wallet planner, approval, byte-retention, validation, broadcast and recovery path. IndexedDB retains public descriptors, plans and signed bytes, never private keys. Signed bytes are saved before network checks/broadcast. Lost acknowledgements permit status inspection or explicit identical-byte retries. Unsigned/rejected actions may be rebuilt against replaced UTXOs; signing-unknown actions remain reserved. A competing confirmed spend must agree across independently checked providers before a signed operation is marked conflicting. A changed queue position requires a new approval, not a silent rewrite of signed bytes. Worker requests wait for an explicit module/WASM-ready handshake. Timeouts terminate the worker while retaining journals, and financial journal transitions use a network-specific Web Lock across tabs. Authorization is checked again after the durable signing boundary and after the wallet returns. Network changes terminate workers while retaining journals.

## Verification and reproducible commands

```sh
npm run compile:queue
npm run test:queue
npm run benchmark:queue
npm run typecheck
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run test:queue:browser
npm run blaze:build
```

`test:queue` uses fresh temporary BCHN data directories and separate RPC/P2P ports, with `-upgrade12activationheight=1`, `acceptnonstdtxn=0` and actual loopback P2P propagation to a second isolated BCHN. It never uses the original node or wallet. The node's software-expiration guard is explicitly disabled for these deterministic test environments. See [native admission/P2P results](relay-results.json), [signed cost/resource comparison](cost-comparison.json), and wallet/browser evidence recorded alongside this file.

Coverage includes canonical genesis and extra authority rejection, exact output capabilities/IDs, collateral and escrow integrity, owner authorization, forged head/pointer/allocation attacks, reserve/reward fee diversion, escrow/reserve reuse during insertion, empty-root reuse, equal scores, 75-bit comparison bounds, disjoint and conflicting insertions, all BCH/token combinations including same-category assets, delayed rewards, permanently unfundable heads, replaced UTXOs, independent withdrawals, wallet transaction tampering, uncertain signing and lost broadcast acknowledgements. Native attack checks require script/token rejection rather than an incidental low fee or input/output imbalance.

## Costs and limitations

At 1 sat/byte, current deterministic signed measurements are:

| Action | Previous BCH bytes / fee | Queue BCH bytes / fee | Queue token-stake + token-reward bytes / fee |
| --- | ---: | ---: | ---: |
| Register below an existing node | 4,780 / 10,000 | 2,355 / 2,355 | 2,507 / 2,507 |
| Register into an empty list | 4,780 / 10,000 | 3,613 / 3,613 | 3,694 / 3,694 |
| Cancel and return unused stake | 9,428 / 20,000 (two actions) | 3,801 / 3,801 | 4,150 / 4,150 |
| Head claim | 4,710 / 10,000 | 4,874 / 4,874 | 5,653 / 5,653 |
| Withdraw stake | 650 / 10,000 | 629 / 629 | 666 / 666 |

For BCH/BCH, empty registration + claim + withdrawal costs 9,116 sats versus 30,000 previously; for token/token it costs 10,013 sats versus 30,000. Historical Phase 1/Phase 2 reports include the superseded preparation transactions. Current complete-action creation costs are recorded in [atomic measurements](atomic-performance.json). The 1,000-satoshi public announcement output is separate from miner fees. Initial root/vault carriers remain locked (2,400 sats), plus a 1,200-satoshi reserve gate for token rewards. These are separate from reward funding and refundable offer collateral.

The JSON comparison is authoritative for each asset pair, inputs/outputs and per-input VM operation/hash budgets. Highest insertion and genesis are larger than ordinary insertion. The original comparison predates atomic genesis; use the atomic measurements for current creation costs. Lower fees are not a claim that every transaction became smaller.

No public network funds are spent by these tests. Synthetic wallet signatures and local P2P acceptance do not establish physical Cashonize approval behavior or public mainnet relay conditions. The queue has no 16-offer lifetime cap, but Electrum query/history bounds and browser resources still limit discovery/display; this is not an unbounded performance claim. The client currently selects at most 16 fee/funding inputs per action. Legacy V3/V4 records and signing code remain in the source for historical regression tests; existing vaults are not imported into the new queue marketplace.

Publication must remain gated on passing critical security, native relay, wallet/indexer and affected browser checks. Final run outcomes and deployment identity are recorded after verification.


## Phase 1 local verification (9726d5d)

Final compiled-artifact checks, root/frontend type checks and the production build passed. Five VM suites (including unauthorized withdrawal and premature reward claims), the native indexer and wallet lifecycle suites, and the native relay matrix passed. The relay matrix records **59 checks and 35 successful loopback P2P propagations**; attack cases reject on script/token rules. Fifteen focused frontend/SDK bridge tests and all 47 retained legacy vault UI tests passed. The final browser run passed with real workers and two WSS hosts, owner Waiting-to-Baked history, and no page overflow at 320, 390, 768, 1024 or 1672 pixels.

The first broad frontend run encountered two timing failures and two obsolete preview-fixture failures; the affected files passed on rerun after fixture/implementation corrections. A combined native run was terminated before its wallet test completed; its VM/indexer/relay checks passed and the wallet suite then passed independently. Final local results are recorded in [verification-results.json](verification-results.json), [wallet-results.json](wallet-results.json), and [browser-results.json](browser-results.json). Read-only scans of both public networks completed without provider errors and found no new queue vaults; see [public discovery results](public-discovery-results.json). No public spend was performed.
