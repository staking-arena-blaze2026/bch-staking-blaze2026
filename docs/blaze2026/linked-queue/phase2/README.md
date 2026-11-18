# Phase 2: transaction and verification optimization

Historical optimization measurements from before atomic genesis. The creation approval investigation below is superseded by [atomic genesis](../atomic-genesis.md); its preparation paths have been removed.
Post-baseline hackathon work based on deployed source `9726d5d`. No original checkout, node, wallet or website was modified. No public funds were spent. This changes contract identities; historical queue contract compatibility was explicitly out of scope.

## Evidence and measurement boundary

`baseline/cost-comparison.json` reproduces the original signed-byte/VM benchmark before production edits. `baseline/wallet-instrumented.json` records the original wallet with instrumentation. The original source was also exported from Git into `/tmp/blaze-phase2-baseline` to run the new complete-action fixture against the exact old implementation. Only tracked source and a dependency symlink were used; no wallets, environment files, node data or credentials were copied.

`performance.json` and `baseline/performance.json` measure identical synthetic user actions across BCH/BCH, BCH/token, token/BCH, distinct tokens and same-category tokens. Setup token genesis/funding is excluded; **application queue-funding and seed-funding preparations are included**. All application transactions are signed and admitted by an isolated BCHN with standard relay policy. `comparison.json` and `tables.md` summarize these measurements and the signed-byte VM matrix.

Timing is a single local sample, including fixture overhead, not a real Cashonize or public-network SLA. Approval readiness is preparation plus authorization, excluding human interaction and derivation. Signature-to-Pending includes local validation, durable store interface, fresh independent verification, BCHN submission and fixture refresh. The synthetic journal uses structured clones in memory; IndexedDB durability is covered by the existing browser path rather than these timing values. Electrum request counts are facade method invocations, including cached header reads and excluding direct BCHN RPC used inside the fixture. They are **not a measurement of actual public wire requests**. Every financial read still uses two distinct configured provider identities. Native fixture providers share the isolated node; browser fixtures use two WSS hosts.

## Off-chain changes and cache lifetime

- `QueueIndexer.head()` authenticates canonical genesis, the unique vault state and exactly its identified head. It verifies the head's complete cached score, collateral and token identity and checks both inputs' ancestry and unspentness on each provider. It does not read the root or rank/traverse successors. Electrum's script-wide listunspent response still contains other node candidates; this is not constant network bandwidth.
- Withdrawal preparation calls a targeted owner-lineage read without synchronizing or ranking the standing queue. Script history and hash-checked transaction candidates locate the requested ID. Only that node's replacements and terminal allocation transaction need chain/VM authentication. Ownership, canonical vault genesis, allocation output identity, confirmed maturity and fresh locked-input availability remain mandatory. Broad owner browsing continues to authenticate its archive, without a preliminary standing-queue sync.
- `authorize()` reuses the exact reviewed plan, not `prepare()`. In-memory review evidence binds the intent, owner, complete wallet descriptor, configuration, sources, fee policy and transaction request to the preparation tip. It never survives a worker reload as signing authority. A failed verification, changed tip/reorg, changed UTXO, intent or wallet-session event invalidates it. Explicit unsigned resume prepares a new review. Creation advancement alone clears the prior signed step after independent status verification and records its bytes in history.
- Fresh authorization independently verifies the exact sources, current availability, raw source values, tokens, scripts, confirmation/header proofs, unconfirmed ancestry/conflicts and fee policy. A changed tip or relay rate requires explicit preparation/review instead of silently changing the transaction. Finality and confirmed relative-time maturity are checked before approval. The 10-second authorization deadline and live SDK/session/route guards remain.
- Wallet reconnect/disconnect/close clears review evidence without terminating the signature-retention path. A signature returned after an SDK authorization change is still validated and saved, then submission is blocked by the existing live guard. Pending/uncertain signature reservations remain intact.
- Returned bytes must match the reviewed body, owner signatures, scripts/token VM rules and exact size-priced fee. They are retained before any network check. Broadcast freshly repeats independent source/unspentness/ancestry checks, finality and header-linked relative maturity, and checks the tip immediately before sending. Network errors retain the identical bytes and error in the journal, including failures during pre-broadcast verification. A confirmed competing spend still needs independently verified evidence to mark conflict. No signed transaction is rebuilt.

The cached review is evidence of completed immutable/genesis verification, not cached spend availability. Fresh verification intentionally still repeats live source ancestry and conflict work. Insertions/cancellations retain full standing-queue routing reads; their authorization no longer repeats routing or wallet inventory discovery. The common planner/sign/retain/broadcast/recovery engine remains shared by every action.

## Covenant reductions and safety arguments

The proof starts at authenticated Genesis: exactly one mutable non-minting vault NFT is created at Global, and all queue minting authorities are bound to canonical Root/Node scripts. Global always recreates its unique NFT with the same category, capability and script at output 0. Root and Node transitions constrain every authority output and every optional output. By induction, a vault NFT cannot escape Global, and queue authorities cannot escape these scripts or mint unauthorized outputs. A source with arbitrary bytes resembling these scripts/categories does not satisfy authenticated genesis provenance.

### Root delegation

Root now retains just `activeInputIndex == 1` and the exact vault NFT category/capability at input 0. Its queue constructor category and repeated state/root/output checks were removed. The non-minting vault NFT proves that input 0 must execute the canonical Global covenant. Every Global non-insertion branch requires the canonical Node script at input 1, excluding Root. Global insertion checks empty head, root script/commitment/category/capability/zero token amount/carrier, and exact root recreation. Its other outputs are bounded and checked. Thus only empty-list insertion can release Root and it must recreate Root unchanged. Merely putting an unrelated minting NFT or a forged Global script at input 0 cannot authorize it.

### Secondary Node delegation

Node `authorize()` now checks the vault authority once, or, in the non-vault branch, requires both identical controller script and queue minting category. Its repeated input-1 category assertion was removed. Global/Node controller transitions already check the secondary node category, capability, amount, 121-byte commitment, authenticated successor identity/score, collateral and required recreation/removal. Active index 1 cannot execute Node's controller entry point, which requires index 0. This preserves the complete cross-contract authentication chain rather than trusting arbitrary script equality.

### Smaller Node configuration

The 128-byte configuration becomes 97 bytes: vault category, queue category, staking category and a one-byte BCH-reward flag. Node never pays rewards or validates their category; it only needs to enforce BCH's minimum reward amount. Genesis computes the flag from the actual reward category while deriving the Node script; Global still stores the full reward category and schedule. A malicious flag/script cannot obtain canonical queue authority. AssetGate and reserve checks still bind the resulting canonical Node script. This removes no reward accounting or asset-identity check.

### Consensus-implied checks

Where `tokenCategory == 0x` is required, token amount must be zero by BCH token introspection semantics. Repeating `tokenAmount == 0` there adds no constraint. Checks of token amounts for nonempty categories, NFT capabilities/commitments and token conservation remain. In insertion branches with different token-handling logic, the existing checks were retained.

Removal and Allocation also no longer sum funding BCH and compare optional change against that sum. Let `P` be all protected input BCH and `F` all funding input BCH. The remaining checks enforce protected output BCH exactly `P`, no additional outputs except optional plain BCH change `C`, and plain BCH funding inputs. Consensus enforces `P + C <= P + F`, hence `C <= F`. The explicit bound was redundant. The protected-value equations are:

| Path | Protected input/output BCH equality |
| --- | --- |
| Ordinary BCH cancellation | predecessor unchanged; removed `1200 + S` returned |
| Token cancellation | predecessor unchanged; node `1200` + escrow `1200` returned as `2400` |
| BCH/BCH claim | vault `1200 + V` + node `1200 + S` = new vault `1200 + V - R` + reward `1200 + R` + allocation `S` |
| BCH/token claim | vault `1200` + node `1200 + S` + reserve gate `1200` = vault `1200` + reward `1200` + allocation `S` + reserve gate `1200` |
| Token/BCH claim | vault `1200 + V` + node `1200` + escrow `1200` = vault `1200 + V - R` + reward `1200 + R` + allocation `1200` |
| Token/token claim | vault `1200` + node `1200` + escrow `1200` + reserve gate `1200` = vault `1200` + reward `1200` + allocation `1200` + reserve gate `1200` |
| Allocation withdrawal | exact input BCH and tokens copied to the owner output |

These equations also hold for unfundable-head return, which follows cancellation's stake-return layout. All token amounts/categories remain independently exact, including same-category assets. Input/output cardinality and fee-input script constraints remain. The VM/consensus still rejects negative fees; the planner and signed-byte verifier additionally enforce the exact measured fee, so fees cannot consume protected value.

### Checks deliberately retained

AssetGate is unchanged. Its authentication of the controller and secondary node, owner-return output, offer ID/position and reserve recreation are necessary to exclude insertion-time release and prevent exhausted carrier diversion. Global still verifies reward schedule, reserve availability, exact payout and allocation identity; Node still verifies rank, stable funding-derived IDs and complete stake collateral. Every owner signature remains, as do funding signatures: fee funding may come from a different derived key, so it does not generally replace offer ownership authorization. BIP68 sequence/maturity and allocation ownership remain. No witness, shared UTXO or insertion position was added. Existing disjoint-predecessor concurrency remains tested.

## Creation approval investigation

Creation still needs two approvals with a suitable existing wallet `vout=0`, otherwise three. Both category genesis inputs must be distinct unspent `vout=0` coins: one at constrained Genesis, one carrying queue genesis authority. A single preparation transaction has only one output 0. Consuming the queue genesis coin to fund the constrained seed would also consume the future category-authority input. Combining both into a single category would change the queue authority model, which was excluded. Making the final child permissionless would require a separately designed constrained queue-funding covenant, rather than simply removing its owner signature. Presigning a package also depends on wallet support and still involves multiple transactions. These alternatives were not implemented without a separate security proof and wallet capability evidence.

Preparation transactions are therefore retained and included in measured totals. The final Genesis transaction is smaller because it embeds the reduced Root/Node/Global/Allocation bodies. No claim of one-approval vault creation is made. Every non-creation user action still has one approval and no preparation transaction.

## Validation and deployment

See `verification.json` for final outcomes and deployment identity. The focused VM suites include malicious NFT minting, extra authority, forged head/link/allocation, unauthorized claim/withdrawal, incorrect ownership, stake/reserve diversion and insertion-time gate reuse. Isolated native standard-policy/P2P tests cover all asset combinations, duplicate/stale/outpoint conflicts, disjoint insertion, premature rewards and relative maturity. Wallet/indexer regressions cover tip/reorg invalidation, changed intent/session, pending/uncertain signatures, lost broadcast acknowledgement and identical-byte recovery. Tests explicitly make standing-queue sync fail during claim/withdrawal preparation, and prove head verification survives missing unrelated tail display data.

A broad legacy frontend run and its reruns are reported separately in the verification record. Production publication is gated on focused security/relay, wallet/indexer, affected frontend/browser and build checks. No legacy full-node suite is run against the original node.
