# Verification levels and Cashonize recovery — 2026-11-16

This is post-baseline BCH Blaze fork work. No original repository, website, wallet or running node was modified. No mainnet/chipnet transactions were initiated. Normal-profile Cashonize acceptance remains pending with the wallet owner; the implementation is a tested release candidate, not a claim of a permanent real-wallet fix.

## Confirmed recovery failure mechanisms

Inspected installed `@wizardconnect/core` and `@wizardconnect/dapp` implementations, including `RelayClient.connect/disconnect/relay/publishSerialized` and `DappConnectionManager.updateConnection/onConnected/handleWalletReady/destroy`. The [official handshake documentation](https://docs.riftenlabs.com/wizardconnect/protocol/) distinguishes wallet readiness from transport availability.

The SDK emits a transport connection event on EOSE **or a five-second readiness fallback**. That does not establish a live authenticated wallet session. Existing `recover()` could exit because `reachable`, `connecting` or `callInFlight` was still set. Manual Retry reused this guarded path and the same manager. Its DappReady coalescer chained all later readiness publications behind an outstanding publication promise. SDK publication awaits all relay acknowledgements; a stalled acknowledgement can therefore retain that promise. Repeated handshake requests alone cannot escape it. These concrete stuck states are reproduced; without the user's live diagnostics we cannot assert which one caused every reported Cashonize failure.

## Recovery changes

- Manual Retry synchronously tears down the prior owner’s manager/relay listeners and timers, creates a fresh manager and RelayClient, and starts a genuine new subscription with **the same saved pairing**. It bypasses stale SDK liveness flags, pending readiness publications and automatic backoff. No new QR/pairing is generated.
- Automatic recovery retains event-driven probes, with manager/transport replacement after an unauthenticated handshake deadline (12 seconds initially, increasing to a 30-second cap). Offline browser state suspends transport attempts. A late connect completion is disconnected after cleanup. Abandoned instances cannot publish new ready probes.
- The original 30-second UI deadline spans replacements, so indefinite restoration cannot hide the Retry controls. Manual progress is shown explicitly; timestamped diagnostics identify replacements, transport readiness/loss, DappReady, WalletReady, identity validation and successful restoration. Transport readiness logs explicitly mention the SDK timeout fallback.
- Only the live, identity-matching WalletReady makes the owner connected. Saved paths and an existing manager do not authenticate it. Identity blocking, network separation, explicit disconnect and the existing SDK revocation grace remain. Manager changes invalidate transaction workers and abort stale signing requests. Pairings and signed journals survive ordinary transport failures.

`walletRestorationSdk.test.tsx` runs real SDK encryption, peer validation, timestamp handling, handshake management and persistence against a Nostr service capable of losing subscriptions and stalling acknowledgements. Tests include a nominally ready subscription with no WalletReady, initial restoration failure followed by automatic recovery, manual replacement, outages and reopening under StrictMode. Existing lifecycle tests cover browser offline/online and focus, changed identity, late handshakes, disconnect/revocation and interrupted signing.

`walletRecoveryWebSocket.test.tsx` additionally runs actual local WebSockets and Nostr REQ/EOSE/EVENT/OK messages with wall-clock timers. A subscription reports EOSE but drops all messages; replacement must increase REQ count and receive authenticated WalletReady. Manual recovery measured **1,565 ms**; automatic recovery **12,215 ms**, including its 12-second deadline. No signing request was sent. These are SDK fixture measurements, **not real Cashonize reconnect times**. Evidence: [wall-clock report](verification-recovery/sdk-wall-clock.json).

## Verification changes and safety boundary

1. Both the lightweight cold-start preview and React marketplace render validated public-index parameter hints immediately: list position, maximum reward, reward category and staking category. A subtle provisional label remains until live replay succeeds. Active counts stay placeholders until independently verified, expire after two minutes, and carry a last-verified timestamp in their tooltip. No counts were invented or copied into the index.
2. Read-only replay emits the first complete single-provider snapshot without waiting for the other providers. Vault details/queue label it provisional and disable financial controls. Independent replay continues asynchronously. Agreement promotes the snapshot; failures retain the display with an incomplete-verification warning. Previously independently verified state takes display precedence and retains its observation timestamp when refresh fails. Pending state remains separate from confirmed state. Display callbacks receive copies and cannot mutate authorization evidence.
3. All financial methods continue to await the existing independent provider quorum, conflict checks, linked headers, transaction/proof/ancestry validation, current source availability, intent/state comparison, wallet identity/network checks, actual signed-byte/output verification, journals and explicit wallet approval. No financial verification check was removed. Read-only workers cannot submit or update journals; provisional snapshots do not reconcile signed operations.

Provider status now uses a separate read worker, so it cannot delay the selected vault behind status verification. Selecting another vault cancels an abandoned selected read, preventing a slow independent provider from indefinitely queueing subsequent browsing. Marketplace replay remains bounded and separate from financial workers.

The only new reusable financial evidence is an already validated MTP window bound to **network, endpoint, height and exact terminal block hash**, with a 32-entry bound. That linked window is immutable for its terminal hash. Failed windows and calls lacking an expected hash do not cache. Live tips, UTXOs, histories, Merkle proofs and pending ancestry are still checked. Existing confirmed replay evidence remains bound to exact config/peer/tip, fresh history identities and current output identities; pending replay is never reused. Funding discovery still caches hints, not spending authority. Pre-approval and post-signature availability checks remain deliberately separate.

## Performance evidence

Public read-only Chromium comparisons use the exact same three-vault index revision on both builds, fresh browser contexts and disconnected wallets. The before website manifest identifies source `9027262e0ae6c1411792b9943b2be8c7751a854c`. Before is hosted Pages; after is the local production build, so host delivery and changing public-provider latency are confounders. Concurrent test load also affects elapsed times. Detail measurements use a separate cold page load, not a warmed marketplace replay.

| Measurement | Before, two runs | After, two runs |
| --- | --- | --- |
| Marketplace first row | 2.86 / 1.47 s | 1.90 / 0.90 s |
| All three rows' public parameters | 26.53 / 19.52 s | 2.62 / 3.00 s |
| Cold single-provider detail | Not exposed | 12.71 / 11.72 s |
| Cold independently verified detail | 33.30 / 26.09 s | 13.37 / 13.37 s |

Exact results are in [before](verification-recovery/marketplace-before.json) and [after](verification-recovery/marketplace-after.json). The public-parameter wait is removed. The five-second cold-detail goal is **not met** in these public-provider runs; full cryptographic replay is retained. A first one-vault run rendered parameters in 1.00 / 1.03 seconds, but it is not used as the three-vault comparison.

An isolated BCHN regression with synthetic wallet signatures and 30 ms delay per RPC measures preparation plus pre-approval separately from signature-to-Pending. This does not measure Cashonize UX or authorize real spending.

| Measurement | Before | After |
| --- | --- | --- |
| Create Vault approval readiness | 4.24 s | 2.25 s |
| Atomic V4 offer approval readiness | 3.43 s | 2.52 s |
| Creation signature to Pending | 2.15 s | 1.37 s |
| Atomic offer signature to Pending | 3.21 s | 2.21 s |
| Creation header RPCs | 159 | 115 |
| Atomic offer header RPCs | 252 | 142 |

Live tip subscription, UTXO, history and Merkle-proof request counts remain unchanged in these transaction runs. MTP window reuse accounts for the reduced header work. See [before](verification-recovery/transactions-before.json) and [after](verification-recovery/transactions-after.json). Timings are individual measured runs, not percentile guarantees.

## Acceptance still required

The user will test the published release with their existing normal-browser Cashonize pairing. Do not clear localStorage or re-pair as a shortcut. Repeat refresh and tab close/reopen, wallet close/reopen, network interruption/restoration and background/focus. If restoration stalls, click Retry and check for immediate “Manual Retry triggered; replacing transport and manager with saved pairing”, a new transport/subscription attempt, WalletReady and identity validation before “Connected to Cashonize”. Do not sign any transactions during this check. Record real reconnect times and privacy-safe diagnostics. Permanent-fix acceptance stays open until this succeeds.

## Regression notes

Isolated BCHN checks cover all asset pairings for atomic offers, chained genesis and zero-conf dependent creation/offers/claims, together with coinbase maturity, funding reservations, conflicting provider evidence, changing tips, stale signed plans and reorgs. Fresh node evidence is retained in this report's directory; older evidence files are preserved. The replay regression now asserts structured unavailable/conflict categories and retention of the previous display snapshot, while continuing to require synchronization to throw before any authorization.

The first broad run exposed a legacy RPC-dependent transport test without a configured disposable node; `scripts/test-isolated-protocol.ts` now runs it in an isolated node, where it passes. No original service was used. The first full frontend run also encountered two 5-second test timeouts during concurrent verification on a memory-constrained machine; the final suite uses a 15-second test-runner timeout, without changing application deadlines.

Final frontend run: **185 passed in 34 files**, with zero failures. All 25 selected protocol cases passed after the documented reruns; 17 verification-evidence checks, root/frontend TypeScript, contract artifact checking and the production build passed. See [validation record](verification-recovery/validation.json).
