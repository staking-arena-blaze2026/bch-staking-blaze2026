# Technical report for the Optnlabs chipnet Electrum operator

Prepared 2026-11-15T16:01:46.679Z. Not sent automatically.

Your public endpoint `wss://electrum-chipnet.optnlabs.com` serves a branch incompatible with the November 15, 2026 chipnet upgrade. This is not inferred from a two-provider vote.

- Common last block: **332450**, `00000000000015fed5ba357ba4baa1f9a283e9446b6ebc12de63152421764051`.
- Its MTP is **1794744504**, crossing activation **1794744000**. The changed rules apply to block **332451**.
- Your block **332454**, `00000000000004976ae5f40c5414662fe0dc926566b59fa6f5ae9e7048cbcbb4`, has timestamp **1794751168**, parent timestamp **1794750437**, delta **731 seconds**.
- Upgraded chipnet requires compact target **1d00ffff** after a delay over **120 seconds**. Your header instead specifies **1a273ab8**, exactly matching the old 600-second ASERT rules.
- The official, checksum- and signature-verified BCHN **29.2.1 preview**, commit `3e6827e95c7a17497e09ac15556debd116dea1d0`, accepted your first three competing headers but rejected 332454 with RPC **-25 / bad-diffbits** in an isolated offline validation. Thus initial competing headers alone are not the proof; the later contextual difficulty failure is.

Official notice: https://bitcoincashnode.org/en/newsroom/2026-11-14_opinion_on_faster_blocktime

Source rule: https://gitlab.com/cculianu/bitcoin-cash-node/-/blob/3e6827e95c7a17497e09ac15556debd116dea1d0/src/pow.cpp

Reproduce the public evidence from this checkout:

```sh
npx tsx scripts/blaze-chipnet-upgrade-audit.ts
python3 scripts/blaze-chipnet-difficulty.py
```

Read-only Electrum request: `{"id":1,"method":"blockchain.block.header","params":[332454]}`.
Returned public header:

```text
00c00520d5423caafedc04640e12592b4f439fad4b12234f886cb8c1a5480c0000000000665b0f83ec05aaf0ffc260ba70a1e6d849ad285ae1f185a0eb939c2fc6c591fdc0baf96ab83a271a5d1602fd
```

Please inspect the backend's `getnetworkinfo`, `getblockchaininfo` (including `upgrade_status`) and `getblockhash 332453`, then compare with Fulcrum. Upgrade to the officially announced chipnet-compatible build or later compatible release; verify activation/network settings and repair backend/index branch consistency as necessary. Do not use `expire=0` as a consensus upgrade. The endpoint advertises Fulcrum 1.9.8, but its actual backend version is not externally established: an old backend, wrong activation configuration, or unreconciled index remains for you to distinguish.

The reference was header-synchronized, not fully block-synchronized; we do not claim full transaction/subsidy validation. No real transaction was signed or broadcast. Staking Arena retains the conflict and blocks signing pending genuine provider recovery.
