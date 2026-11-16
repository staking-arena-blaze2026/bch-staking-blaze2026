# 1,000 scheduled reward releases

This is post-baseline BCH Blaze 2026 work. The V3/V4 release ceiling increases to 1,000; the sixteen lifetime offer slots, ranking, max-wins and allocation rules are unchanged. A daily schedule lasts 1,000 days (approximately 2.74 years).

## Compatibility and contract identities

Original `artifacts/Registry*.json` files remain byte-for-byte intact. Their hashes are pinned in `tests/fixtures/legacy-v3-artifact-hashes.json`. The compiler writes updated registry artifacts to `artifacts/releases1000/` and checks those against current sources. Shared asset, stake-allocation, sponsor and funding covenants are unchanged.

The immutable release count determines the artifact family: counts 1–16 retain their exact historical locking scripts, and 17–1,000 use the updated scripts. This preserves all existing vault identities, factory preparations, journal recovery, indexing, registrations, claims, cancellations and withdrawals without a migration or a new protocol version. New short schedules deliberately continue using the historical contracts. Existing vaults cannot change their count or acquire a larger reserve.

Genesis reconstructs a canonical minimal Script integer push for the count, including signed-magnitude padding and OP_1 through OP_16. Epoch/interval arithmetic retains the final timestamp ceiling of 2,147,483,647 (2038-01-19 03:14:07 UTC). The cap remains at most 1,000,000 raw units per release, so the largest reserve is 1,000,000,000 raw units, safely within both the existing four-byte reserve field and Script arithmetic.

The reward calculation remains `cap × min(count, floor((final timestamp − epoch) / interval)) − rewards already paid`. Builders use MTP − 1, preserving strict timestamp finality: MTP must exceed the release boundary. Missed releases accumulate; rewards remain in the upfront reserve until claimed, including after the final release. Parameters stay script-bound and immutable.

Public announcements retain the existing schema/bytes for historical counts. An internal announcement encoding schema 2 uses a two-byte count for extended schedules (91 payload bytes rather than 90); this is discovery serialization, not a new staking protocol. Both public discovery implementations understand both encodings and independently verify vault lineage. The preview accepts the same 1,000-release ceiling. No marker, offer queue or ranking rule changes.

The creation form displays the 1–1000 range, exact upfront reserve, duration in seconds/days, estimated UTC end date and MTP dependency. Invalid counts, intervals and timestamp overflow disable creation with explicit errors. Production builds strip source/debug fields from nested compiled artifacts too.

## Focused verification

- `ARENA_NETWORK=regtest node --import tsx --test tests/release-limit.test.ts`: counts 1, 16, 17, 100, 365 and 1,000 in V3/V4, exact genesis identities, canonical integer encoding, linked genesis, direct validation, BCH/token reserve arithmetic, count rejection and timestamp boundaries. Native tests use a disposable datadir and ports 18568/18569, never the original node. They check real mempool acceptance, MTP boundaries, accumulation, claims, cancellation/refund, matured allocation withdrawal and unchanged 16-offer capacity.
- `tests/blaze-public-discovery.test.ts`: independent creator/offer wallets discover both historical four-release and extended 1,000-release V3/V4 vaults, replay pending/confirmed lineage and update the public index.
- Existing `tests/v3-indexer.test.ts`, `tests/v3-adversarial.test.ts`, `tests/public-discovery.test.ts`: historical vault replay and genesis validation, malicious transitions and discovery regressions.
- Frontend focused files: `V3Arena.test.tsx`, `publicIndexPreview.test.ts`, `v3Config.test.ts`, `WalletConnect.test.tsx`, `v3WalletSigning.test.ts`, `publicVaultIndex.test.ts`.
- Root/frontend TypeScript checks, `node scripts/compile-v3.mjs --check`, and the public `npm run blaze:build` release.
- `frontend/scripts/verify-release-limit.mjs` checks the compiled local/live creation form, all requested counts, reserve/duration/end date, rejection of 1,001, a fresh wallet pairing dialog, public listing discovery and independent replay of confirmed legacy mainnet vault `c14b3170fd156ee0b5cdefba0241981407a481caa08d7169b2e07ea5caccb2e5`. It blocks broadcasts and does not connect a physical wallet or sign transactions.

## Results

19 release-limit tests, 8 existing protocol/compatibility tests, one isolated discovery integration (four old/new V3/V4 vaults) and 79 focused frontend tests passed. Artifact reproducibility, root/frontend type checks and production build passed. The local production browser passed with zero page errors/broadcasts, all six counts, rejection of 1,001, wallet pairing and independently verified confirmed legacy mainnet state. See `test-results.json`, `local-browser.json` and `discovery-regtest.json`.

Run RPC-dependent adversarial/indexer/discovery checks through `ARENA_NETWORK=regtest node --import tsx scripts/test-isolated-protocol.ts tests/v3-adversarial.test.ts tests/v3-indexer.test.ts tests/public-discovery.test.ts`.

## Limits

No existing on-chain vault or real funds are modified by verification. Physical Cashonize approval is not simulated by opening the live pairing dialog; SDK/wallet transaction compatibility is exercised by focused tests. Wall-clock estimated dates can differ from MTP availability. There are still only sixteen lifetime offer registrations, even across a 1,000-release schedule. These checks are focused regression/consensus evidence, not an independent contract audit.

## Changed files

- `contracts/v3/RegistryV3.template.cash`, `RegistryAtomicV4.template.cash`, `RegistryGenesisV3.template.cash`, `RegistryGenesisV4.template.cash`, `RegistryAtomicGenesisV4.template.cash`, `RegistryAtomicLinkedGenesisV4.template.cash`.
- The six corresponding compiled files in `artifacts/releases1000/`; original compiled files stay intact.
- `scripts/compile-v3.mjs`.
- `src/v3/model.ts`, `protocol.ts`, `discovery.ts`, `public-discovery.ts`, `public-index.ts`.
- `frontend/src/V3Arena.tsx`, `publicIndexPreview.ts`, `frontend/vite.config.ts`.
- `frontend/tests/V3Arena.test.tsx`, `publicIndexPreview.test.ts`, `frontend/scripts/verify-release-limit.mjs`.
- `tests/release-limit.test.ts`, `tests/blaze-public-discovery.test.ts`, `tests/fixtures/legacy-v3-artifact-hashes.json`.
- `docs/BLAZE_2026_BASELINE.md` and the report/evidence in this directory.
