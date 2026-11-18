# Automatic wallet preparation on Mainnet and Chipnet

This post-baseline change preserves the linked-queue contracts, independent vault/queue CashToken categories, authenticated origins, full reward reserve and public announcement. The existing atomic creation transaction remains the final operation. Offer insertion remains one transaction and one approval.

## Planning and consent

The financial worker uses the selected application's network and its existing independently verified Electrum providers. It verifies wallet ownership, scripts, token contents, ancestry, spend availability and fee policy before constructing a complete projected sequence. Only token-free output-zero coins from distinct transaction IDs can become category origins. Projection transaction IDs never authorize spending: actual signed preparation transactions and their outputs must be independently verified on the selected network.

- Two origins: create directly, with one transaction and one wallet approval.
- One origin with sufficient independent funding: preserve it and self-send independent funding, then create; two transactions and approvals.
- No origins, or one origin without usable independent funding: split funding into an output-zero origin and a separate BCH output; self-send the separate output into another transaction's output zero; create. Three transactions and approvals. The first origin is preserved throughout the second preparation.

Preparation selects the fewest inputs in descending BCH value within its funding preference, preferring ordinary BCH over fungible token coins. If needed, fungible tokens are returned in separate ordinary wallet outputs, without burning tokens or turning token outputs into genesis origins. NFTs are excluded from funding discovery. All self-send outputs are controlled by the wallet's receive key. A wallet unable to cover the entire sequence, reserve, dust requirements or the bounded funding policy receives an error before any signature.

Fallback opens an accessible modal before preparation or signing. It explains the extra approvals and self-send, exact planned counts, size-priced extra and total miner fees, reserve commitment and total wallet BCH debit. Self-send principal is never called a fee. Cancel, Escape, changing form/route, wallet invalidation or network departure cancels pending consent without signing. Already completed preparations remain ordinary wallet funds and durable journal evidence.

The full sequence uses fixed-size Schnorr transaction estimates at the independently verified network relay policy. Every actual signed fee must equal its signed byte count times that policy. A changed remaining quote cannot silently inherit approval. Fresh consent includes already-paid preparation fees and completed approvals. A changed policy between review and signing invalidates authorization. Signed bodies and fees are never adjusted during retry.

## Recovery and isolation

The Mainnet and Chipnet workers, transports, journal databases, selected providers, public discovery markers and wallet address families remain separate. New operations explicitly carry their network; transplanted operations are rejected at every lookup. Wallet/session/network checks run again at the signing and broadcasting boundaries. Changing the session invalidates reusable approval evidence, while a returned signature is retained before further financial work.

Each preparation and the final creation are separate durable operations linked through deterministic continuation IDs. The next operation is reused after a crash, including a crash between child and parent journal writes. Initial inputs needed by the remaining sequence are reserved. Independent transaction-status and input/ancestry verification gate continuation. Confirmed preparation outputs are reused, without repeating signed steps. A late wallet response is persisted before validation, including invalid responses, and cannot be replaced with different signed bytes.

Explicit refusal permits a fresh unsigned review. Requested or uncertain signing blocks another request. Lost broadcast acknowledgement preserves the original bytes and requires reconciliation; only identical-byte rebroadcast is available. Confirmed competing spends retain evidence and stop continuation. Old `seed-funding` records are preserved as legacy evidence and never interpreted as new self-send operations. Recovery does not synthesize a new contract compatibility path.

## Verification boundary

Reproduce the dual-configuration matrix with `npm run test:queue:preparation`. It uses application Mainnet/Chipnet configurations over an exclusively local Electrum facade, fresh isolated standard-policy BCHN nodes and a second loopback P2P peer. The isolated chain clock is deliberately before Chipnet tick activation; upgraded tick/maturity behavior remains covered by the existing dedicated consensus tests. No public Electrum transport can be opened by this fixture. Synthetic Schnorr keys sign only isolated-chain transactions.

The matrix covers normal creation, one independent funding coin, zero origins, one origin without independent funding, all BCH/fungible-token asset combinations, same-category assets, and a wallet funded only by a fungible-token coin. It checks exact signed bytes/fees, distinct final origins, full reserves, cancellation before signing, refusal/review, lost acknowledgement, confirmed preparation followed by worker replacement, deterministic continuation reuse, changed-fee consent and rejection of cross-network journals. `preparation-results.json` records every measured transaction and P2P result; its fee rates are fixture policies, not public-network fee promises.

Frontend tests cover popup wording, costs, explicit Continue/Cancel, automatic two/three-approval progression on both networks, refusal and disconnect at every step, retained late signatures, form-change cancellation, selected network policy and stale authorization. Existing covenant, authenticated-origin, indexer, lifecycle/reorganization, wallet and asset-pair checks remain required.

No physical Cashonize approval or public Mainnet/Chipnet spending is claimed by these automated tests.

## Measured BCH/BCH examples

All rows below include public discovery and the full 40,000-satoshi reward reserve. The same signed transaction sizes were observed for both network configurations. Mainnet's fixture rate is deliberately 2 sat/byte; Chipnet's is 1 sat/byte. Real network policy is discovered afresh.

| Wallet origins | Transactions / approvals | Signed sizes (bytes) | Mainnet fixture fees (sats) | Chipnet fixture fees (sats) |
| --- | --- | --- | --- | --- |
| Two eligible origins | 1 / 1 | 732 | 1,464 | 732 |
| One origin plus independent funding | 2 / 2 | 185 + 732 | 370 + 1,464 = 1,834 | 185 + 732 = 917 |
| No origins | 3 / 3 | 219 + 185 + 732 | 438 + 370 + 1,464 = 2,272 | 219 + 185 + 732 = 1,136 |
| One origin without independent funding | 3 / 3 | 219 + 185 + 732 | 2,272 | 1,136 |

The existing wallet lifecycle fixture's atomic creation remains exactly 732 signed bytes, 732 satoshis at 1 sat/byte, and one approval, matching its pre-change evidence. Its insert/cancel/claim/withdraw transaction sizes and fees also match the previous report. All eighteen dual-configuration scenarios passed standard-policy admission and loopback P2P relay. Detailed token-backed measurements are in the JSON report.
