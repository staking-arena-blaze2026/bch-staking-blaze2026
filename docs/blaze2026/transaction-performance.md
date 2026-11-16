# Vault creation and Atomic V4 latency

This is post-baseline Blaze work. No contract or covenant bytecode changed. No mainnet or chipnet transaction was signed or broadcast during this investigation. The user's successful real Cashonize tests establish compatibility, but their several-minute observations were not instrumented end-to-end baselines.

## Changes

- Wallet preparation, approval, signature retention, broadcast and journal updates retain a single transaction worker and the network-specific Web Lock. Public discovery, selected-vault sync and provider connection checks use independent read workers. Journal listings have a separate worker. Read workers reject financial/journal mutations and have broadcasting disabled.
- Background reconciliation performs network work in a read worker. Its result is applied under the financial lock only if the original journal is still byte-for-byte equivalent. Only status/configuration fields change; retained transaction bytes and plans are preserved.
- Funding discovery, source verification and vault replay read independent providers concurrently on separate ElectrumCore instances. All configured providers still participate, including a slow third provider that might report a conflict. Custom adapters without independent sessions retain sequential behavior.
- Within each pinned session, identical header requests share a promise. Complete linked header ranges can be reused only for the same network, endpoint and exact tip hash, with every requested proof anchor checked. No failed range is cached. Persistent immutable raw-transaction caching remains scoped to each peer.
- Fully confirmed replay evidence is bounded and reusable only for the exact configuration, peer and tip, after fresh reads of every relevant registry/reserve/escrow/allocation history, fresh cryptographically checked current outputs, and a final unchanged-tip check. Returned snapshots are copied. Pending ancestry is always replayed.
- The live, independently observed listunspent height supplies the root transaction's status lookup. Raw bytes, Merkle proof, header linkage, maturity, ancestry and final tip checks remain. Independent source scripts can be fetched concurrently.
- Atomic preparation no longer duplicates the full input verification immediately repeated by authorize. The worker still revalidates intent/state and independently verifies all sources immediately before approval and again after the signature, with a final pinned-provider check before broadcast. The UI does not add an extra offer replay before entering this verified preparation path.
- Valid returned signatures are persisted before network work or a post-return wallet-session rejection. Chained creation retains both the signed parent and locally validated permissionless child. An operation cannot substitute different signed bytes. Atomic offers keep one Cashonize approval.
- Pending (0-conf) is returned after the accepted broadcast and durable journal write. Offer UI refresh runs separately and does not delay this feedback. No confirmation wait was added.
- Worker timeouts are stage-specific: queued 30s, broadcast 45s, other active stages 180s, with a 10-minute request ceiling. Stage transitions reset the stage deadline; five-second progress updates show elapsed time. Timeout terminates the worker and rejects every pending request rather than leaving a live submission behind an abandoned promise. Late responses cannot resolve a new request. Saved signed journals require explicit reconciliation/retry; no automatic broadcast retry is introduced.

## Measurements

Read-only WSS probes used the configured real mainnet providers and the same public Atomic V4 vault. No wallet descriptors were used. These are component measurements, not complete create/offer transactions. Counts below are per two-run sample, including cold and warm reads; provider timing varies and block arrival can require a complete retry.

| Real mainnet component | Before | After |
| --- | ---: | ---: |
| First full public vault replay | 17.36s | 7.38s |
| Second public vault replay | 16.31s | 2.88s |
| First separate vault-input verification | 13.20s | 3.53s |
| Second separate vault-input verification | 12.65s | 3.61s |
| Header RPC requests, two samples | 228 | 136 |
| History requests, two samples | 24 | 16 |
| Merkle proof requests, two samples | 40 | 34 |
| Linked header range requests, two samples | 8 | 2 |

Raw evidence: [before](transaction-latency-before.json), [after](transaction-latency-after.json). `npx tsx scripts/blaze-transaction-latency.ts REPORT.json` runs the read-only probe with broadcasting disabled. It records method names/counts only, never request parameters.

An isolated BCHN test with a synthetic wallet adds 30ms to every Electrum RPC. The same test ran against pre-change `6ba10bb` in a detached fork worktree and the optimized source. It uses actual local transaction validation and synthetic signatures, with no external relay or Cashonize. Its custom regtest adapter does not implement the production transport's session header coalescing, and local RPC/CPU contention contributes to these wall times.

| Isolated operation | Approval readiness before → after | Signature to Pending before → after |
| --- | ---: | ---: |
| Direct vault creation | 4.35s → 3.40s | 2.21s → 3.24s |
| Atomic V4 offer | 12.05s → 4.29s | 9.06s → 3.12s |

The creation post-signature result regressed in this isolated sample; no claim is made that every phase improved. Source verification, local script validation, strict journal persistence and pinned-provider revalidation remain mandatory. Offer request counts fell from 502 to 402 in this adapter; extra independently fetched raw transactions are expected with separate peer caches. Raw evidence: [before](transaction-operations-before.json), [after](transaction-operations-after.json).

The 10–20s approval and <10s signature-to-Pending goals are not yet established end-to-end on Cashonize mainnet. Public-proxy timing cannot establish real wallet funding discovery, unconfirmed ancestry depth, SDK relay delay, human approval time, broadcast acceptance or browser refresh time. Slow/unavailable providers, fresh block arrivals, propagation disagreement and deep unconfirmed ancestry can exceed the goals; none authorizes reducing verification.

## Diagnostics and validation

`arena-wallet-timing` events provide operation/request attribution, stage duration and RPC method counts. Stages include worker queue, public-key derivation, funding discovery, independent provider verification, vault replay, construction, pre-approval revalidation, Cashonize request/response (including human wait), post-signature script validation, broadcast, journal write, signature-to-feedback, and UI refresh. Nested stages overlap; do not sum nested durations. Events exclude addresses, public keys, scripts, outpoints, raw transactions and RPC arguments. Existing wallet address-comparison UI remains user-visible and is not added to performance reports.

Tests cover separate read/financial transports, slow stages exceeding the old 120s timeout, stage timeout termination, late responses, network departure, wallet reconnect before/after approval, retained signatures, all-provider fork detection, exact-context header reuse and rejected proofs. Real-network browser probes use public data and prohibit broadcast. Isolated BCHN safety tests exercise single-approval Atomic registration, token combinations, chained creation, stale signed retention, reservations, conflicting spends, lost acknowledgements, eviction, identical retry, block arrivals and reorganizations. Original running nodes and their directories are untouched.

Validation completed: root/frontend TypeScript checks and the production Blaze build passed; the complete frontend suite passed 151 tests in 30 files, with 23 targeted signing/state/scheduling checks rerun after final changes. Eight isolated BCHN safety tests and the separate delayed-provider operation benchmark passed. Header/fork/discovery/policy checks passed. The [read-only browser concurrency report](transaction-browser-concurrency.json) records cold worker startup separately from a local financial authorization rejection while two mainnet replays are active; this probe never builds a spend or requests a signature. Fresh isolated safety artifacts are [Atomic V4](transaction-atomic-regression.json) and [chained creation](transaction-chained-regression.json); historical baseline reports remain intact.
