# Public discovery, provider consistency and retained vaults

This is post-baseline BCH Blaze work. Existing contracts and compiled artifacts are unchanged.

## Diagnosis (2026-11-15)

`walletPeers()` previously selected only the first two hosts. Financial checks compared their tip hashes and MTP literally; a normal extension, unavailable peer, mempool propagation difference and genuine branch conflict could all look like persistent disagreement. The third configured host was unused. The indexer erased its snapshot on failure; list refresh replaced rather than retained display snapshots. The shared catalog was empty and creation never published a globally searchable discovery record.

The read-only [provider observations](provider-diagnostics.json) concern the supplied public V3 vault, not a wallet. Each host independently replayed the same genesis and current state transaction `667037e0a4fef18cc36fb5e5acb3ce522e0d6886be52a46440940464f40e0869`, including raw outputs, merkle/header linkage and no unconfirmed ancestry. However, Optnlabs and the other two hosts return **different block hashes at height 332453**. This is an actual chain divergence, not a demonstrated benign lag or stale wallet mempool. It must block signing while unresolved. A matching majority does not resolve that conflict. The diagnostic script can be rerun without wallet access or broadcasting.

## Provider policy

All distinct configured hosts are considered, in sequential pinned sessions. Every candidate independently verifies the requested data; agreement does not replace transaction/VM, token, merkle, header, MTP or ancestry checks. Even a source that cannot complete the requested UTXO/replay read contributes its available checked tip to branch-conflict detection.

Two sources must agree on the latest observed snapshot and all action-relevant evidence. A lower tip is excluded only after its hash is linked to the higher tip by the existing header verifier. Two lagging peers cannot overrule a known newer tip. A verified pending transition cannot be voted away by two empty mempools. Contradictory branches or verified input/ancestry double spends block immediately, including evidence from the third source. Missing data and propagation differences retry up to three full attempts with bounded backoff. No previous input verification is reused across attempts. Signing/submission revalidates sources; the final pinned broadcast check verifies the entire selected-input ancestry again and requires the selected snapshot hash to remain unchanged. Signed bytes remain journaled if a last-moment tip change prevents broadcasting.

Messages distinguish synchronization, missing second verification and conflicting blockchain evidence. Public messages omit wallet outpoints, scripts and addresses.

## Public index architecture

The continuously updated public index is **ordinary Electrum script history**, already served over WSS by the configured public servers. No creator API key, writable GitHub endpoint, browser-local publication service or separately hosted private indexer is required. Static GitHub Pages executes read-only queries against that public index.

New creation transactions advertise a fixed spendable P2SH marker (`OP_TRUE` redeem script) and an adjacent zero-value OP_RETURN carrying a canonical 90-byte binary announcement. OP_RETURN alone is not the index key: Electrum implementations can omit unspendable outputs from script indexing. The marker carries 1,000 BCH satoshis, explicitly disclosed in the creation UI, and is spendable by anyone. This is an additional public carrier, **not an increased miner fee**. The existing miner fee remains 10,000 satoshis per transaction. Atomic offer fees, ownership checks and approval count are unchanged.

The payload contains format version, direct/parent mode, registry version, both assets and immutable schedule/reward parameters. It contains no wallet derivation paths or credentials. Direct creation places it after the three protected genesis outputs. Chained creation and legacy creation put it in the existing preparation transaction, leaving the immutable three-output genesis covenants untouched. Parent mode derives the registry script from parent txid and parameters, then finds the genesis child in its history (bounded to 512 registry entries and stopping at the first matching child). Parent announcements without a child are retried on subsequent discovery; they are not presented as completed vaults.

Creation and preparation plan validation pin both metadata outputs exactly. Old journals lacking the opt-in `discovery` field reproduce their original builders without adding outputs. No signed transaction is rewritten to add metadata.

Discovery unions available provider histories and deduplicates canonical lowercase genesis txids. It returns at most 20 announcement records by default (maximum 50), supports a txid cursor, and never scans BCH blocks. The marketplace renders and replays at most 20 vaults per page. A history read is capped by ElectrumCore's 50,000-entry safety bound. Above that bound discovery fails closed with retained configurations available: this implementation is **bounded, not an indefinitely scalable index**. A malicious party can publish junk or spend marker outputs; invalid records consume page capacity and are skipped, never trusted as state. A future dedicated paginated index can replace the hint transport without changing financial verification.

## Discovery is not authorization

An announcement or shared catalog entry is only a public configuration hint. The independent AssetIndexer replays genesis, covenants and current lineage on the selected providers before financial state is authoritative. Confirmed proofs and full unconfirmed ancestry validation are unchanged. Malicious configurations cannot authorize spending. Discovered 0-conf genesis/lineage is explicitly provisional; no pending allocation gains maturity. Confirmation triggers a fresh replay. Eviction or reorg makes the current listing unverified; saved hints remain visible and no stale snapshot authorizes an action.

Financial buttons are disabled after a verification failure until a successful current refresh. A prior display snapshot is retained and marked stale/non-authoritative. On reload the snapshot cache is always treated as stale, never as action authority. The original signed IndexedDB operation journal remains separate and is not deleted or replaced by discovery/cache operations.

## Historical recovery and outages

The public historical seed catalog includes the supplied RegistryV3 genesis `fa5bae8625e61ec15a9d1527157f1e544d6d4bee9a1a268095099320e33e8c86` with its supplied BCH/BCH parameters. It is independently checked, not pretrusted. Creator journals already containing a public config and signed raw transaction repopulate saved listings at startup. Imported hints are saved before verification, so a provider outage does not erase a recoverable listing. Catalog/discovered configurations persist under the existing chain-specific key across reloads, wallet reconnects and deployments at the same origin. Invalid individual stored configurations do not discard the others.

Recovery does not require a transaction: use retained configuration/journal hints, refresh discovery, or import a public configuration. The seed catalog remains available during Electrum discovery outages. Detail/list verification retries while visible; discovery refreshes its head every minute. Users can load older pages explicitly. A removed discovery cursor restarts from the head instead of skipping records silently. The public index does not depend on whether Cashonize is connected.

**Historical limitation:** There is no chain-wide historical enumeration. Unannounced vaults created before this release are recovered only from available public seed configurations and creation journals/imports. This index is explicitly marked incomplete. Newly announced vaults created with this release's direct, chained or legacy paths are discoverable across browsers. An old deployed client that creates no announcement cannot be automatically indexed by this mechanism.

## Validation boundaries

Provider policy and discovery pagination/malformed-data tests are synthetic unit tests. Browser WSS fixtures use real compiled covenant VM checks and synthetic linked headers: they are not live chipnet evidence. Isolated BCHN 29.2 tests use temporary datadirs, separate RPC ports and distinct Alice/Bob keys; the original running node is not used. Browser profiles are independent and browsing requires no wallet. Physical Cashonize approval remains outside automated coverage.

Live evidence is limited to the timestamped public provider diagnostic replay and the production checks recorded separately. The observed genuine provider branch conflict prevents a safe live signing demonstration. A production marker history with no announcements proves endpoint access, not that a new live vault was created. Public discovery must not be described as live end-to-end verified until an actual announced chipnet vault is independently observed in a fresh profile.
