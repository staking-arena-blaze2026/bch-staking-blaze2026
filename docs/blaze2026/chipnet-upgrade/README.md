# November 2026 chipnet upgrade investigation

**Historical investigation:** the original findings and freeze below are retained. The [transaction restoration follow-up](restoration.md) records the explicit OptnLabs exclusion, fresh Imaginary/Ninja chain verification and completed tick-aware compatibility tests.

The observed fork is a **2027-preview consensus-rule split**, not ordinary Electrum lag or mempool propagation. The last common block, **332450**, has MTP **1794744504**, crossing the scheduled **1794744000** activation. The branches diverge at **332451**, the first block using the new rules. Optnlabs' subsequent header **332454** matches the old difficulty calculation and is rejected by the official preview with **bad-diffbits**.

**Not resolved. No live Atomic V4 creation is approved or claimed safe by this investigation.** No real transaction was signed or broadcast. No provider was removed, no known conflict was cleared, and no financial transaction rules or production deployment were changed.

## Sources and software support

- [Official November 14 notice](https://bitcoincashnode.org/en/newsroom/2026-11-14_opinion_on_faster_blocktime) links a chipnet-only preview, not the stable 29.2.0 binary.
- [Pinned preview source](https://gitlab.com/cculianu/bitcoin-cash-node/-/tree/3e6827e95c7a17497e09ac15556debd116dea1d0): the chipnet parameters use activation MTP 1794744000; the predicate tests the **previous** block's MTP. Target spacing changes from 600 to 60 seconds. The testnet minimum-difficulty delay changes from 1200 to 120 seconds.
- [Preview difficulty implementation](https://gitlab.com/cculianu/bitcoin-cash-node/-/blob/3e6827e95c7a17497e09ac15556debd116dea1d0/src/pow.cpp), [activation](https://gitlab.com/cculianu/bitcoin-cash-node/-/blob/3e6827e95c7a17497e09ac15556debd116dea1d0/src/consensus/activation.cpp), [chipnet parameters](https://gitlab.com/cculianu/bitcoin-cash-node/-/blob/3e6827e95c7a17497e09ac15556debd116dea1d0/src/chainparams.cpp).
- Stable **BCHN 29.2.0 does not implement these faster-block rules**. It records the tentative chipnet activation/expiry date, but retains the old rules. The existing local 29.2.0 node returns RPC **-100**, explicitly reporting software expiry. It was not restarted, upgraded, or given an expiry override. This expiry observation does not identify its current branch because its blockchain RPC is disabled.
- The signed preview is **BCHN 29.2.1-3e6827e95**. Ninja's public banner advertises BCHN 29.2.1. Imaginary and Ninja serve upgrade-compatible headers. Optnlabs advertises **Fulcrum 1.9.8**, versus **2.1.4** and **2.1.3** respectively, but its actual backend daemon version is **not externally established**. Do not equate an Electrum server version with its backend version or infer consensus validity from version strings alone.

The [final live snapshot table](live-check.md) records the last check. The [live observations](electrum-live.json) contain exact tip heights/hashes/MTP, the 332453 hashes, raw linked headers, PoW checks, public server capabilities and merkle-verified coinbase observations. The initial snapshot is preserved separately. Only public blockchain/server data was queried.

## Independent contextual validation, not a majority vote

The isolated preview downloaded and validated the P2P header chain through **332652**, including activation and the Imaginary/Ninja 332453 header. It calculated target interval 60 seconds after 332450. It was then disconnected from the network before local tests of the alternative public headers.

Optnlabs' 332451–332453 headers were individually accepted as competing **headers**. Therefore the differing hash at 332453 alone is not sufficient to declare that entire branch consensus-invalid. Its **332454** header provides the decisive contradiction:

| Property | Value |
| --- | --- |
| Hash | `00000000000004976ae5f40c5414662fe0dc926566b59fa6f5ae9e7048cbcbb4` |
| Parent timestamp | 1794750437 |
| Block timestamp | 1794751168 |
| Delay | 731 seconds |
| Required activated-rule nBits | `1d00ffff` (delay exceeds 120 seconds) |
| Served nBits | `1a273ab8` |
| Independent preview result | RPC -25, `bad-diffbits` |

Its own hash satisfies its advertised target. That does **not** make it valid: consensus requires the contextual nBits value, not simply sufficient PoW against any chosen target.

The read-only ASERT transcription in `scripts/blaze-chipnet-difficulty.py` agrees with both rule sets on all 150 sampled pre-activation headers. Every sampled post-activation Imaginary/Ninja header matches the preview rules. The Optnlabs post-activation sequence matches the **old** rules but does not satisfy the preview rules. The first preview mismatch is 332454. This is independently corroborated by the native preview rejection, not merely by the transcription. See [difficulty comparison](difficulty-rules-comparison.json).

Chainwork was inspected using `floor(2^256/(target+1))` per header. The arithmetic matches native BCHN cumulative chainwork through 332453 on both branches. The live JSON reports the claimed work after the common ancestor, but **work from a contextually invalid chain cannot establish the valid winner**. See [native chainwork cross-check](chainwork-crosscheck.json).

**Validation boundary:** the new reference was header-synchronized, **not fully block-synchronized**: block IBD reached 11905 while headers reached 332652. Header RPCs therefore show `nTx: 0` and confirmations -1. We do not claim full transaction/script/subsidy validation of either entire branch. Its full-block IBD was stopped rather than represented as a synchronized full-node reference. The coinbase payout change (approximately 25 BCH versus 2.5 BCH) is corroborating evidence, not a standalone excess-subsidy proof without fee validation. See [native validation record](preview-node-validation.json).

## Build provenance and isolation

Before execution, the exact archive SHA256 `9fe52bd83cd397f97810b0558b543fd746175c92b91263b4e14ad2feca9d8a9a` was checked against **two valid signatures**. Fingerprints were matched against BCHN's official signing-key list:

- Calin Culianu: `D465135F97D0047E18E99DC321810A542031C02C`
- im_uname: `BA578BC691D53253036D02C8A93E50646A20ED95`

The official build manifest pins source commit `3e6827e95c7a17497e09ac15556debd116dea1d0`. This is signature/hash verification, not a claim that we independently rebuilt the binary. GPG's personal web-of-trust was not established; the identity basis is the official key list and notice. Public signature/check logs are included.

The host is x86_64 with glibc 2.44; the executable requires at most GLIBC_2.34. Roughly 4.2 GiB disk and 1.3 GiB available memory were checked. The preview ran only under the ignored workspace artifact directory, with a fresh datadir, RPC 48442/P2P 48443, wallet disabled, block-only networking, 550 MiB pruning, dbcache 64 MiB, mempool 16 MiB, eight peers, one script-validation thread and `assumevalid=0`. It was shut down cleanly. No global binary, original datadir, regtest data, wallet, cookie or browser credentials were copied or replaced. The original process remained PID 524 using BCHN 29.2.0. See [provenance and requirements](build-provenance.json) and [read-only old-node result](existing-node-readonly.json).

## Operator action and recovery

[Concise operator report](operator-report.md) is prepared locally; it was **not sent**. The affected public stack is Optnlabs. An old/unupgraded backend, an activation override, or a stale/unreconciled Fulcrum index can explain serving the legacy branch; the exact internal cause needs operator RPC/log access.

The operator should verify its actual daemon version, chipnet configuration and `upgrade_status`, run a verified compatible preview/later release, and make the backend and Electrum index converge on the upgraded branch. Compare backend `getblockhash 332453` with the externally served header. Repair/reindex using the applicable backend/index procedures if those disagree. Bypassing software expiry is **not** a consensus upgrade. An updated version string alone is not evidence of resolution.

Resolution requires live, compatible linked headers and current transaction/UTXO proofs from the implicated providers. Staking Arena's conflict latch must not be manually cleared or a provider silently excluded. If the provider recovers, rerun the read-only audit and public vault replay first; then verify **all selected transaction inputs** on independent compatible providers. That recovery condition was not observed, so no post-resolution all-input success is claimed.

## Required Staking Arena follow-up before live testing

The existing verifier contains pre-upgrade block-count assumptions:

| Location | Required consensus-aware change |
| --- | --- |
| `src/electrum-wallet.ts:39`, `src/zero-conf.ts:33` | Coinbase maturity is **60000 ticks**, not always 100 actual blocks. A wholly post-upgrade coinbase needs 1000 one-minute blocks; boundary-spanning depth needs the actual interval mapping. |
| `src/zero-conf.ts:41` | Height-based BIP68 units remain **600 ticks per unit**, not one new one-minute block. |
| `src/zero-conf.ts:26`, `src/v3/protocol.ts:177`, `src/v3/wallet.ts:438`, shared keeper/wallet checks | Height-type nLockTime must be interpreted as legacy-height ticks under the activated rules, rather than comparing directly with physical block height. |

For the observed activation parent H=332450, `T(h)=600*h` through H and `T(h)=600*H+60*(h-H)` afterwards. Financial verification must derive and validate the activation boundary from the selected chain, not blindly hardcode this observed height. Coinbase maturity uses the next candidate block's ticks minus the source block's ticks; sequence-height locks use a 600-tick unit. These mappings require differential tests against the upgraded node, including sources spanning activation and 0-conf ancestry.

The preview preserves **512-second time-based CSV** semantics. Existing time-based staking allocations, ownership checks, token checks, approval count and 10,000-satoshi fee policy must not be shortened or relaxed. Script VM checks alone do not implement the changed chain-context maturity/finality rules.

Electrum protocol **1.6 is not synonymous with the consensus upgrade**. Existing exact 1.5 negotiation can remain supported. If the client later negotiates 1.6, it must also handle the changed `blockchain.block.headers` response (`headers` array instead of concatenated `hex`), per the [pinned protocol specification](https://github.com/cculianu/electrum-cash-protocol/blob/631ee9eccfc82baf61c9257611553502ed9081a2/protocol-methods.rst). Merely changing the version string would break the current range decoder.

## Read-only test result and conclusion

Public marketplace tests ran first with two fresh profiles, no wallet connection, no page errors and no signing/broadcasting. The known V3 vault remained visible with the actual conflict message and financial state withheld. Individual public-vault replay/input observations are recorded separately; they do not authorize a financial transaction or establish agreement across the fork. TypeScript checks passed for the new diagnostic script.

**Continue read-only viewing. Do not retry live Atomic V4 creation yet.** The provider conflict remains, and the application's tick-aware maturity/finality work is additionally required before claiming complete 2027-rule input verification. Runtime transaction/security code and endpoint configuration were left unchanged by this investigation.
