# Chipnet transaction restoration

This follow-up supersedes the transaction freeze in the original investigation. It is post-baseline BCH Blaze 2026 work. The explicit requested provider policy is **Imaginary + BCH Ninja**, excluding OptnLabs. Mainnet configuration, original services, wallet approvals, covenant bytecode, 512-second time CSV and the 10,000-satoshi transaction fee policy are preserved.

## Why OptnLabs is excluded

The previous fork evidence remains unchanged: [initial snapshot](electrum-initial.json), [last three-provider snapshot](electrum-live.json), [difficulty comparison](difficulty-rules-comparison.json), [native rejection](preview-node-validation.json) and [operator report](operator-report.md). OptnLabs served block 332454 with nBits `1a273ab8`, while the activated 120-second minimum-difficulty rule required `1d00ffff`. The signature-verified BCHN 29.2.1 preview rejected that header with **bad-diffbits**. A different 332453 hash, version string or provider majority alone was not the basis for exclusion. Its internal backend cause remains unknown; this follow-up does not claim OptnLabs has repaired its chain or recheck its present status.

The exclusion is deliberate and documented, replacing the earlier requirement to wait for recovery of all three providers. The Pages build and both production browser configurations select Imaginary/Ninja; browser configurations reject an OptnLabs override; the broadcast adapter also refuses it. Read-only forensic scripts retain access to all three providers. Browser conflict storage archives the original host set as `pre-restoration-conflict` before filtering only the excluded endpoint from active verification. Imaginary/Ninja conflict latches remain active until fresh independent verification resolves them; journals, vault configurations and signed recovery bytes are retained.

## Selected chain verification before enabling transactions

At **2026-11-16 22:53 UTC**, both providers served the same tip, height **334513**, hash `000000000000d82ea9fe62dfcd2084606e683c76566f6002da5838f2930614ea`. Both had linked headers, valid advertised PoW and the same activation parent at **332450**, MTP **1794744504**. All **150** sampled pre-activation and **2063** post-activation difficulty transitions per provider matched the pinned upgraded rules. See [fresh public observations](restoration-live.json) and [contextual difficulty calculation](restoration-difficulty.json).

The existing signature-verified isolated preview was restarted with no P2P peers, networking disabled, and no wallet. Native `submitheader` accepted the complete sampled chain through each selected provider tip, reporting **199593780 ticks** and a **60-second** next interval. Both agreed on chainwork. It was stopped cleanly afterwards. See [native current-header verification](restoration-native-headers.json), the [reproduction script](../../../scripts/blaze-chipnet-native-headers.py), and the original [binary provenance](build-provenance.json).

A subsequent fresh two-provider public-vault replay and **all current state/reserve input** checks passed with the new tick-aware verifier: [input evidence](restoration-inputs.json). No wallet was connected, and no public transaction was signed or broadcast. This is header synchronization and Electrum proof verification on the upgraded branch, not independent full-block IBD, whole-chain script/subsidy validation, or a real Cashonize end-to-end claim.

## Consensus compatibility

`src/consensus-clock.ts` derives the activation parent by binary searching selected-chain MTP at the scheduled chipnet activation. It verifies the crossing, links it to the exact current tip, and checks the independently validated upgraded-branch 332453 checkpoint. The observed activation height is not hardcoded as the tick boundary. Cached boundary evidence is peer-specific and must still link to the current tip; contradictory headers fail closed.

The mapping uses 600 ticks per physical block through the activation parent and 60 afterwards. Coinbase maturity is 60000 ticks against the next candidate block, including confirmed-only funding paths. BIP68 height units remain 600 ticks. Height nLockTime is scaled by 600 and uses a strict comparison against candidate ticks. Time CSV keeps its 512-second units and parent-block MTP anchor. Version 1 transactions do not enforce BIP68, and final input sequences preserve their absolute-locktime exemption during ancestry validation. Positive relative locks against unconfirmed parents remain blocked.

Fresh clocks flow through V1/V2/V3 verification, wallet signing validation, keeper validation and mempool projection. Broadcast permission still requires a verified active network session; Chipnet additionally requires upgraded-chain context and fresh finality before submission. Every selected wallet/covenant input is freshly checked on both selected providers during each operation. No new wallet/network declaration is inferred from a testnet extended key.

The [native compatibility report](consensus-compatibility.json) records **22** matching `testmempoolaccept` probes in a fresh isolated upgraded BCHN regtest. It covers legacy and boundary-spanning coinbases, 999/1000 post-upgrade block maturity, height nLockTime, all-final sequences, cross-activation BIP68, exact 9/10-block post-upgrade relative locks, unchanged time locks and zero-conf ancestry locks. A native tick-count comparison confirms the independently derived mapping. Only this disposable chain was mined or given mock time; original BCHN services and chain state were untouched.

## Focused validation and remaining boundary

The targeted provider-policy/coinbase tests, upgraded native differential test, V3 Chipnet model workflows, frontend network/configuration tests, root TypeScript check and production build are the necessary checks for this repair. The V3 model fixture now has a fixed pre-upgrade clock instead of changing consensus era with the host date. Its synthetic transaction success cases do not substitute for native consensus evidence. Captured legacy browser fixtures remain unable to establish upgraded-chain broadcast context; their explicit refusal checks reflect that boundary.

Transaction controls and the native worker are restored after successful live chain, native consensus and public-input checks. Both providers must remain online, agree, and verify the selected inputs for each transaction. Restored code does not itself establish a published deployment or a physical Cashonize approval, signing or broadcast result.

Reproduce the read-only selected-provider audit without replacing historical evidence:

```bash
CHIPNET_RESTORE_AUDIT=1 npx tsx scripts/blaze-chipnet-upgrade-audit.ts
CHIPNET_RESTORE_AUDIT=1 python3 scripts/blaze-chipnet-difficulty.py
npx tsx scripts/blaze-chipnet-restore-inputs.ts
```

The native compatibility test requires `ARENA_NETWORK=regtest` and `BCHN_TEST_BINARY` pointing to the signature-verified upgraded preview. It creates and deletes its own datadir on dedicated RPC/P2P ports 18458/18459.
