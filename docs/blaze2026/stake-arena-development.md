# Stake Arena Blaze Development

We have started Stake Arena development shortly before Blaze, but have made substantial improvements in the 8 days of the hackathon:

## 1. Completely redesigned on-chain offer queue

The old prototype used a bounded registry with a maximum of 16 lifetime offer registrations. The Blaze version introduces an authenticated **sorted linked-list** queue, where individual offers are represented by separate utxos.This removes the caps, allows **parallel insertions** at different positions, and avoids repeatedly processing the entire queue for claims and withdrawals to find the best offer.

[Linked-queue architecture](https://github.com/staking-arena-blaze2026/bch-staking-blaze2026/blob/blaze2026/docs/blaze2026/linked-queue/README.md?utm_source=chatgpt.com)

## 2. Simplified transactions and substantially reduced fees

[Atomic genesis and fee measurements](https://github.com/staking-arena-blaze2026/bch-staking-blaze2026/blob/blaze2026/docs/blaze2026/linked-queue/atomic-genesis.md?utm_source=chatgpt.com)

## 3. Automatic public vault discovery

[Zero-confirmation discovery](https://github.com/staking-arena-blaze2026/bch-staking-blaze2026/commit/f7285ff31431f05a5b087ac7ddca5170aa807019?utm_source=chatgpt.com)

## 4. My Offers, cancellation and stake recovery

Status tracking, cancellation, and owner-controlled withdrawal of matured stakes. Safer handling of rejected, unsigned, signed, and interrupted operations.

[Latest submission recovery improvements](https://github.com/staking-arena-blaze2026/bch-staking-blaze2026/commit/0db5be19f612552e6d1f1ba94d6fd9105f82f5cc?utm_source=chatgpt.com)

## 5. Website redesign

## Future development:

1. Investigate the options for reducing preparation transactions in the vault creation process. Reducing token categories, using templates the same way BCH guru does and/or XO templates.
2. Partial offer fills.
3. Further improve the performance of the offers queue, possibly using the JEDEX system.
4. Investigate the feasibility of packaging the queue as a reusable component and using it in the Penny Picker project.
5. Investigate better ways to work with onchain time (schedule start, reward release interval).
