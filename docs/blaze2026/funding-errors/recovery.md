# Explicit resolution of old signed wallet funding

Post-baseline work on the hackathon fork. The short error now identifies the **old** request holding funds and offers **Resolve old request**. The previous full diagnostic remains available under Technical details.

## User flow

1. Keep the new vault form as entered and choose **Resolve old request** from its blocker or Transaction recovery.
2. A separate **Resolve old signed request** dialog explains that this does **not** create the new vault. It quotes one wallet approval, the wallet self-send amount and its network fee. Only the network fee leaves the wallet.
3. Continue and approve the new self-send in Cashonize. Canceling the review or refusing the wallet request leaves the old signed bytes and reservation intact.
4. Wait for a blockchain confirmation. The app checks independent providers automatically; Check resolution status also works after reload. If a signed resolution was not observed after an interrupted submission, Retry signed resolution submits only that already-approved wallet self-send, never the old transaction. A mempool acknowledgement alone does not release the old reservation.
5. Once independently confirmed, the old signature cannot spend the same inputs. The old journal is marked resolved by that confirmed transaction, retaining its signed bytes and history. Choose **Continue Create Vault** to obtain a fresh creation quote and approve the new vault. Its reward amount, release count and other form values remain unchanged while this page stays open. Recovery status survives reload; after a reload, review or re-enter the new vault form before continuing.

For the reproduced 867,701-satoshi layout, at a 1 sat/byte policy, the recovery spends the old signed input of 865,001 satoshis and returns 864,816 to the wallet, paying a 185-satoshi fee. The separate 1,200-satoshi wallet continuation input stays unspent. After confirmation it and the new output zero provide two genesis origins, so the new 9,600-satoshi vault is created atomically with one more approval. Total modeled wallet debit across both transactions remains 13,917 satoshis. These measurements use isolated synthetic signers; the live quote always uses freshly verified inputs and fee policy.

## Eligibility and safety

- Only old `queue-funding`/`seed-funding` creation journals with retained, identity-matching signed bytes are eligible.
- Actual signed outpoints must match the recorded sources. The current live descriptor must control the old request, and independent providers must verify every source/continuation reference as an unspent, token-free P2PKH wallet input.
- Covenant, NFT, token, unknown-script or historical covenant references stop automatic resolution and retain the manual inspection path. A missing transaction response by itself never releases funds. Independent providers also check the covenant addresses in the signed transaction for any existing funds, including deposits absent from the journal; any such funds stop automatic resolution. The check repeats before clearing references after confirmation. If funds arrived meanwhile, the confirmed self-send is recognized but old covenant references stay protected; its ordinary returned wallet funds remain available for separate creation.
- Other active reservations are respected. Only the specifically selected old request is ignored when constructing this explicitly approved replacement; it remains reserved for other actions until resolution confirms.
- The new transaction spends the old signed inputs and sends BCH back to the original wallet. It never broadcasts the old transaction, consumes covenant outputs or deletes signed evidence. The review is bound to the old journal's identity, signed bytes, sources, continuation references and history. Sources, references, session, network, fee policy and signing authorization are checked again before spending.
- New resolution outputs remain reserved while pending. Confirmed resolution updates the old journal before freeing the new outputs; interrupted writes can be reconciled idempotently. A reorganization restores protection when the old sources reappear.
- If the old transaction confirms first, the new resolution cannot spend its inputs. The app reports the conflict and keeps existing covenant outputs protected. It does not advance the old covenant automatically.
- Status inspection and automatic polling never sign or rebroadcast. An explicit Retry identical transaction checks current status first and does not resend an already observed transaction.

The authenticated two-category queue, direct atomic creation, ordinary preparation fallback and explicit Cashonize approvals remain unchanged.

## Validation

[Recorded results](recovery-test-results.json): 65 focused frontend tests and 21 funding/reservation/recovery cases pass across focused runs (15 existing cases and six new recovery cases), plus the existing isolated queue-wallet integration test. The new real BCHN recovery cases run under both mainnet and chipnet application configurations. They reproduce the exact 866,201 reserved / 1,500 available split, exercise review cancellation and duplicate prevention, sign/relay the replacement, retain the old bytes/history, prevent early reuse, confirm resolution and then sign/relay a new vault with a 9,600-satoshi reserve. They also test reorganization restoration, the old transaction winning the race, protected covenant output survival and wrong-network refusal. Dedicated cases detect untracked covenant deposits before recovery and during confirmation; the final confirmation cases were rerun after the last backend change.

Production browser checks use a synthetic dialog event in a fresh unpaired profile with public sockets blocked. They verify clear separation from the new vault, exact fee display, Continue/Cancel behavior and 320/390-pixel layouts on mainnet and chipnet. They do not establish physical Cashonize signing; no public funds are broadcast during testing.
