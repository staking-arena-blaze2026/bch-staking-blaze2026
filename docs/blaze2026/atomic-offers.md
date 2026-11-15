# Direct atomic offer registration

Post-baseline BCH Blaze work. This document describes RegistryAtomicV4, not an upgrade to immutable RegistryV3 bytecode. The continuous protocol/state schema remains `version: 3`; new vault configurations explicitly add `registryVersion: 4`. Omitting that field selects the original contracts. Changing a configuration field cannot change a deployed vault: genesis, script and full state replay must agree.

## Covenant and authorization analysis

RegistryV3 action 0 fixes five inputs (state, escrow, reserve, exact commitment, exact BCH sponsor), three outputs, and a 10,000-satoshi difference between inputs and outputs. Input 3 must already be the exact stake (or exact tokens on a 1,000-satoshi carrier); the sponsor is exactly 10,000 sats for BCH staking or 9,000 for token staking, whose input carrier is released. No change output is permitted. Suitable pre-existing exact coins could technically register directly, but ordinary arbitrary wallet UTXOs cannot satisfy these constraints. General direct registration requires a successor covenant.

The separate `checkSig(authorization, pubkey(record.slice(0,33)))` is retained. WizardConnect hdwalletv1 supports multiple `inputPaths` in one transaction request. Cashonize's published `createSignedWizTransaction` signs a contract placeholder against that input's redeem script and signs P2PKH inputs against their locking scripts. The registry signature at input 0 and wallet signatures at inputs 3 onward are **different signatures**, produced under one transaction approval. All application-accepted signatures must use Schnorr ALL|UTXOS|FORKID (`0x61`). No wallet-input signature is copied into the registry. No private spending keys enter the application.

Source inspection: [Cashonize signer](https://github.com/cashonize/cashonize-wallet/blob/master/src/utils/dapp/wizSigning.ts), [request/approval adapter](https://github.com/cashonize/cashonize-wallet/blob/master/src/stores/wizardconnectStore.ts), and installed WizardConnect core 0.2.5 / dapp 0.2.2. These are API/source checks, not a claim that a physical Cashonize approval or the currently hosted wallet build was exercised.

## Successor layout and accounting

RegistryAtomicV4 preserves the original state, ranking, release timing, owner cancellation/refund, independent allocations and withdrawal rules. Registration restricts new records to `maxWins = 1`. It accepts 1–16 direct wallet inputs after the three protected role inputs and 0–2 owner-only change outputs after the protected outputs. The 16-input bound keeps script validation and fee/size policy bounded; plans also enforce a 10,000-byte transaction budget.

The state and role outputs remain at 0/1/2. Escrow increases by exactly S; reserve remains unchanged. Registration input tokens may only be fungible tokens in the staking category; exact introspection category equality excludes mutable/minting NFT capabilities and nonempty NFT commitments are rejected. Empty-commitment immutable NFTs are indistinguishable from fungible-only UTXOs in [CashTokens introspection](https://cashtokens.org/docs/spec/chip/). Therefore the wallet planner rejects **all** NFT source metadata before approval, reconstruction rejects NFT-bearing sources, and ALL|UTXOS signatures bind actual source serialization. Adding an NFT after review invalidates the saved plan and signatures. The covenant alone cannot prohibit an owner from intentionally authorizing a burn of such an indistinguishable NFT; the application never constructs that operation. Input/output fungible sums require exact conservation, independently of consensus allowing token burns. Change scripts must equal P2PKH(hash160(record owner)). BCH and token change below the 1,000-satoshi application floor are rejected rather than silently burned or added to the fee.

For BCH staking, wallet BCH pays S plus 10,000 sats, with the rest returned. For token staking, existing escrow retains its existing 1,000-satoshi carrier; wallet BCH pays 10,000 sats plus a 1,000-satoshi token-change carrier when needed. All remaining wallet BCH returns as change. Protected reserve amounts and carriers remain untouched, including when staking and reward token categories match. Fee and carrier costs are distinct in review text.

RegistryAtomicGenesisV4 and RegistryAtomicLinkedGenesisV4 pin the new registry body for legacy factory and linked creation, respectively. Existing RegistryGenesisV4 still creates RegistryV3: its version number never implied atomic offer support. Original contract artifacts and bytecode are retained. `node scripts/compile-v3.mjs --check` verifies every artifact; recompilation does not rewrite timestamps when content is unchanged.

## Signing, state races and recovery

New atomic offers have `registrationMode: 'atomic'`, `step: 'action'`, and no funding-step journal. The existing database/schema remains readable without migration. Intent, source state, input outpoints, review plan, signer paths, signed bytes, txid and observed status stay durable. New atomic selection and authorization reserve both legacy funding-parent and registration-plan inputs if those inputs reappear. Old funding/action journals keep their fields and paths; no signed record is deleted, replaced or automatically resubmitted.

Preparation discovers funds in six-address batches using the existing cached hints, starting with two children per shared path in the browser. No exhaustive 120-address scan was added. Both providers verify selected inputs and pending ancestry. Before approval and broadcast the atomic plan is independently reconstructed against the latest verified vault state and compared with its saved transaction identity. A stale plan requires a new explicit review. Authorization is never transferred to the rebuilt plan.

Returned signed bytes are verified and durably retained without network I/O before the browser checks for session changes. Retention never broadcasts. Reconnection invalidates submission, while the signed bytes remain recoverable. A final state or input check failure also retains signed bytes. Uncertain submission reconciliation checks whether that exact transaction is in verified history, pending lineage, absent, or superseded. Only an explicit identical-byte retry is allowed; there is no replacement transaction or second signature.

The existing independent-provider indexer replays unconfirmed ancestors and executes covenants before exposing provisional state. It rebuilds on synchronization rather than trusting cached pending state. Ranked offers and claims use that state without requiring mining; the unchanged MTP/released-buffer conditions still govern payout. The UI refreshes after registration, shows transaction/state IDs and provisional status, and retries verification through periodic reconciliation if providers have not yet converged. Recovery controls are collapsed during normal use.

## Verification evidence and limits

Run isolated node tests (fresh temporary datadir, separate RPC port, no original chain state):

```
ARENA_NETWORK=regtest npx tsx --test --test-concurrency=1 tests/blaze-atomic-offer.test.ts tests/blaze-atomic-assets.test.ts
```

The JSON evidence records the node version, five asset cases, signed transaction sizes, fee, one local signing invocation per registration, provider requests and timings. Local signing invocation counts are not measured physical wallet approvals. Timings use a BCHN-backed local Electrum facade and synthetic fixture public keys; they are not public Electrum, phone, relay or click-to-Cashonize benchmarks. Browser derivation bounds and one-request signing are checked separately in frontend tests.

Actual Cashonize interaction with the new transaction remains unverified. No user's chipnet transaction was signed or broadcast. Existing real pending offers/journals were neither read from browser storage nor modified by this work.

The browser emits memory-only `arena-wallet-timing` events for initial public-address derivation and elapsed wallet preparation until the signing request. These contain aggregate timings and the operation name, with no keys or addresses. The final JSON benchmarks are diagnostic local measurements, not a controlled public-network latency comparison: chain history and host load differ between cases.

## Final local verification

- `npm run test:atomic`: passed both isolated BCHN integration tests, including all five asset cases and recovery/conflict/reorg scenarios; standard-policy `testmempoolaccept` runs before every application broadcast in the main fixture.
- `npx tsx --test tests/atomic-funding.test.ts`: three tests passed, including exact funding, NFT exclusion, dust handling and legacy parent reservations.
- Root TypeScript check and `npm run blaze:build`: passed.
- Focused frontend UI/signing checks: 37 tests passed; the final signing rerun passed all 14 tests. The earlier full frontend run passed the other 25 files and exposed the UI snapshot assumption subsequently fixed and rechecked.
- V3 Playwright browser suite: all four tests passed (loopback WSS workers, provisional state, reorg/reload recovery and desktop/mobile layouts). This uses synthetic chain fixtures; BCHN results above are separate actual node execution.

The additional NFT probe deliberately constructs a transaction which BCHN accepts if the owner intentionally authorizes burning an empty immutable NFT. The application rejects that transaction as differing from the reviewed inputs before broadcast. This records the introspection boundary rather than claiming a nonexistent consensus restriction.
