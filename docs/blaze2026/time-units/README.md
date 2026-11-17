# Whole-unit staking and local release timing

Post-baseline application work in the Blaze fork. No covenant version or bytecode changes, migration, or historical-format support added.

## Staking representation

The offer form's canonical input is a whole number U, from 1 through 65,535. Native number-input controls increment by one. New-offer validation rejects out-of-range values and seconds that are not exact multiples of 512 before wallet transaction preparation.

The existing transaction/registry format stores duration = U * 512 seconds. The allocation builder encodes 0x400000 + ceil(duration / 512), exactly 0x400000 + U for every new offer. No rounding occurs for new offers. Queue ordering continues to compare exact integer cross-products of stake, seconds, and reward, with earliest registration breaking ties; a common factor of 512 preserves the ordering of S * U / R. Displayed priorities use U.

Form conversion, queue offer details, submitted-offer rows, wallet confirmation labels and My Offers show whole units, exact conventional duration and seconds. Withdrawals still require the allocation owner's signature, full collateral and each allocation's independently confirmed MTP anchor.

## Release intervals and local dates

Reward intervals remain minutes: Chipnet minimum/step 1; mainnet minimum/step 10. The form, worker and public-network wallet preparation validate these constraints before transaction construction. Calendar input uses the browser's timezone; serialization and contracts retain Unix seconds. Nonexistent spring-forward local times are rejected, and interval arithmetic uses elapsed Unix seconds across daylight-saving changes. Local display uses Intl.DateTimeFormat with the browser's timezone and date-specific timezone abbreviation/offset.

## Release availability

MTP comes from the existing independently verified indexer snapshot, calculated from selected-chain headers. Browser time only displays local time and distinguishes a future wall-clock schedule from waiting for blockchain time.

For verified MTP M, the greatest final timestamp locktime is M - 1. Unlocked count is:

    clamp(floor((M - 1 - epoch) / periodSeconds), 0, periods)

The pot is unlocked count times release amount, minus rewards already paid (derived from remaining reserve), bounded between zero and remaining reserve. This is the same model and BIP113 boundary used by transaction construction. Equality M = boundary remains awaiting blockchain time. Several releases can unlock together; queue readiness is a separate condition.

Release status and pot totals are unavailable/unverified when independent verification is missing, the observation is over 30 seconds old, the observation timestamp is in the future, or state is pending/provisional. Visible vaults refresh on a 15-second cadence when no operation is running. Every financial action continues to verify independently before approval/broadcast.

The expanded schedule/history displays each boundary in local time. Available boundaries feed the shared pot; historical claims are deducted from its aggregate total. There is no execution countdown.

Consensus references: [BIP68](https://github.com/bitcoin/bips/blob/master/bip-0068.mediawiki), [BIP113](https://github.com/bitcoin/bips/blob/master/bip-0113.mediawiki).

## Validation

Focused frontend tests cover input limits/steps, exact CSV encoding, priority ties, time decomposition, interval policy, local date parsing, spring/fall daylight-saving changes, BIP113 equality, accumulated releases, paid rewards and unavailable/stale observations. Wallet tests reject non-unit durations before state reads and transaction construction.

tests/blaze-time-units.test.ts creates a disposable isolated BCHN regtest node, creates an atomic vault, registers 12-unit and 1-unit offers, claims both rewards, rejects premature/non-owner withdrawals, and withdraws the short allocation while the long allocation remains locked. It reconstructs the wallet from retained journals between submission and reconciliation, then verifies the long allocation's separate maturity and withdrawal. It never uses the original running node or private runtime directories.

Validation completed on 2026-11-17:

- Focused frontend/wallet suite: 97 tests passed across time-policy, V3Arena, My Offers, submitted offers, state verification and wallet signing.
- Disposable BCHN integration: 1 test passed, including both independent CSV withdrawals and journal reconstruction.
- Browser checks: 2 tests passed (desktop/mobile layout and retained inputs; native unit controls, exact conversion, local DST schedule and expanded release history).
- Production Pages build, including frontend TypeScript checks: passed.

Commands:

    npm --prefix frontend test -- --run tests/time-policy.test.ts tests/V3Arena.test.tsx tests/myOffers.test.tsx tests/submittedOffers.test.tsx tests/v3StateVerification.test.ts tests/v3WalletSigning.test.ts --maxWorkers=1
    ARENA_NETWORK=regtest node --import tsx --test tests/blaze-time-units.test.ts
    npm run blaze:build
    npm --prefix frontend run test:v3:browser -- --grep 'tabs preserve|whole-unit controls'

These checks use local test signatures. They do not assert a new real Cashonize approval or a public-chain financial transaction.
