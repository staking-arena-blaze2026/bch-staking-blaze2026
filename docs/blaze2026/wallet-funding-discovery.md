# Wallet funding discovery repair (BCH Blaze 2026)

Post-baseline fork work. No covenant source or bytecode changes.

## Observed failure and established cause

The reported Cashonize balance is 812,333 satoshis. The user supplied an earlier journal entry for a **different**, rejected creation: `create: funding / review`, a 6,000-satoshi reserve, 809,333 satoshis of token-free inputs, and `Wallet authorization interrupted or refused: Error: User rejected the transaction`.

Previously every unfinished plan reserved its inputs. That rejected plan therefore left only **3,000 satoshis** selectable for the new 10 × 1,000-satoshi reserve. Both selectors failed, discovery continued through all 120 supplied addresses, and `chooseBch` produced the same generic error for inadequate available value and its unrelated eight-input cap. This explains the user's reported failure from their journal evidence; their browser storage was not inspected directly.

A second, independent reproduced defect: a wallet with 301 UTXOs totalling 812,333 satoshis (300 × 2,700 plus 2,333) needs 13 inputs to fund a 33,000-satoshi chained parent. The former cap rejected this fundable case too. There is no evidence that the eight-input cap was the cause in the user's actual wallet.

## Cashonize address compatibility

Reviewed Cashonize commit `ff731f9dacdc9b6ae0194292fa144da248f620b3`, [`wizardconnectStore.ts`](https://github.com/cashonize/cashonize-wallet/blob/ff731f9dacdc9b6ae0194292fa144da248f620b3/src/stores/wizardconnectStore.ts), and the installed WizardConnect SDK. Cashonize derives chain nodes from the active wallet's parent derivation, exports their xpubs as receive/change/defi, and derives one non-hardened address index below each. SDK children 0, 1, 7 correspond to these names. Staking Arena uses these exported nodes rather than guessing an account path. P2PKH scripts are `DUP HASH160 <hash160(compressed pubkey)> EQUALVERIFY CHECKSIG`; regular and token-aware CashAddr encodings resolve to that same script.

No source-level mismatch was found. Each newly derived app key is now compared with independent derivation from the live session xpub. Session changes still invalidate authorization. The app provides an opt-in, local-only first-receiving-address comparison and queried-address report. Do not paste xpubs or wallet credentials into public issue reports.

Read-only queries to two public chipnet providers found zero UTXOs at the public receiving address supplied by the user. This does **not** establish a wallet/account mismatch or missing wallet funds: BCH may be on other receiving/change children. The user's actual session xpubs and first app-derived address were unavailable for comparison. The supplied public address is intentionally omitted from committed diagnostics.

## Reservations and recovery

New operations explicitly distinguish never-requested unsigned plans, requested/uncertain signatures, and authenticated refusals. Unsigned plans do not lock funds indefinitely; `authorize` rechecks other reservations and inputs under the existing cross-tab Web Lock before marking a request outstanding. Signed, interrupted and unknown outcomes remain reserved. No pending operation is automatically deleted, consolidated or rebroadcast.

The installed SDK rejects its signing promise for both transport errors and wallet error responses. The client correlates the authenticated response sequence and recognizes Cashonize's exact `User rejected the transaction` refusal. Generic failures and broadcast-unknown errors never count as refusals.

For pre-marker journals, only the exact prior `signingFailed` rejection string, review stage, disabled wallet broadcasting, and absence of any signed bytes, txid or funding transaction establish the narrowly recognized legacy cancellation. Cashonize emits that literal in its dialog's `onCancel`, before calling its signing routine. Other legacy reviews remain conservatively reserved. The original operation and error are preserved; retrying it still requires fresh authorization and source verification.

## Selection, fees and discovery

- Token-free coins are sorted by descending value, minimizing the number of funding inputs; smaller unnecessary coins are skipped once funded. Only the chosen fungible category can contribute token carriers. NFTs and unrelated tokens remain excluded.
- Inadequate value, inadequate token units and excessive input count now have distinct errors. The eight-input application cap in the v3 builders is replaced by **54**: `(10,000 - 2,000) / 148`, rounded down. This reserves 2 kB for outputs/overhead and conservatively budgets up to 148 bytes per P2PKH input within the existing 10,000-satoshi fee. V3 creation checks serialized size against 10,000 bytes as well. BCHN's separate standard transaction ceiling is 100,000 bytes ([policy source](https://github.com/bitcoin-cash-node/bitcoin-cash-node/blob/v29.0.0/src/policy/policy.h)). The 54-input bound is an explicit app resource/fee policy, not a consensus or covenant limit. Legacy v1 builders keep their separate existing input bound.
- BCH/reward reserves, both chained fees, carriers, token change and minimum BCH change are retained. No silent consolidation or covenant edits.
- Create Vault starts at two addresses per advertised chain (six with all three paths). Public journal signer paths belonging to the live owner are added as funded-address hints, including deeper indices. Hints and previously funded keys are queried first, followed by receive/change/defi at increasing indices. Discovery still visits all supplied addresses when needed; a gap does not prove the rest empty. User-controlled expansion searches 40, then 200 per path.
- The initial small scan derives only needed children. Expanded scans reuse already derived public keys; journal hints are checked against the live xpub and stored signer before use. No cached balance authorizes spending.
- Two providers independently check discovered outputs and their confirmation heights. `getUtxosForLockingBytecode` reuses a transaction lookup for multiple outputs of that transaction within one call. Selected-input verification reuses one listunspent result per script within a pinned provider snapshot. Neither optimization shares trusted results across provider sessions.
- Selection validates pending ancestry as before. Invalid/immature/unverifiable candidates can be excluded and valid alternatives tried; contradictory provider/tip observations abort instead of masquerading as low funds. No confirmation wait is added.
- Funding reports distinguish discovered BCH, confirmation status, token-free BCH, eligible token carriers, reservations, released unsigned/rejected plans, unsupported assets, excluded source verification, candidate availability and input counts. Unclassified confirmation status is explicit rather than guessed. Detailed queried addresses remain opt-in and memory-only. Candidate balances are labelled as such until selected inputs pass verification.

## Creation architecture and verification limits

Both paths retain one wallet signing call: direct genesis with an eligible output zero, or a wallet-authorized parent followed immediately by its permissionless covenant child. Selected inputs are checked again at authorization and broadcast. RegistryGenesisV4 and RewardFundingV3 enforce the existing linked-parent, reserve-conservation and immutable-parameter rules unchanged.

Automated fixtures and isolated BCHN 29.2 tests cover discovery, selection, journal reservation/rejection, unconfirmed ancestry, direct/chained genesis, dependent offers/claims, recovery, conflict/reorganization behavior and the four asset combinations. Frontend tests cover session/path identity, one approval, transport interruption and synthetic Cashonize reconnection. These do not establish compatibility with the user's real Cashonize wallet or physical approval prompts. No real Cashonize transaction has been signed or broadcast in this work.

Timing/request measurements are in `funding-benchmark.json`. Its transport is an isolated local BCHN RPC-backed Electrum facade, not public Electrum or Cashonize latency. Preparation-only cases have zero actual prompts; the separate signing harness and frontend mock tests establish one signing call on supported creation paths. A user-approved real Cashonize creation after deployment remains the final live-wallet acceptance check.

## Recorded results

- 126 frontend tests passed (26 files). The final complete run used `npm test -- --testTimeout=20000` from `frontend/`; earlier simultaneous browser/build/regtest runs caused resource-pressure timeouts and were not counted as passes.
- 33 focused root funding/scan/recovery tests passed, with final funding-policy and reservation checks rerun after the final safety changes.
- Isolated BCHN 29.2 direct/zero-conf offer/claim and chained-covenant security tests passed. The fragmented-wallet test passed after correcting the fixture's own 301-output setup transaction fee (that large setup is not an app consolidation or production transaction).
- Fragmented fixture: old cap derived/queried 120 addresses and made 482 Electrum-facade requests, then refused 13 inputs. New discovery derived/queried six, made 74 requests through discovery/input verification and 122 through authorization, selected 13 of 301 inputs, and produced a 1,965-byte signed parent. The parent and permissionless child passed BCHN standardness/mempool checks and were broadcast only inside isolated regtest, with one local signing authorization and no intervening block.
- Observed fragmented discovery time: 57.75 s for the old failed search versus 14.90 s for the new verified selection; preparation through authorization 22.94 s. Normal one-input discovery queried six addresses, took 9.05 s (78 discovery requests; 126 through authorization), and reached authorization in 16.30 s. These samples include local RPC facade overhead and a machine that had recently experienced swapping; they are actual measurements, not latency guarantees or a controlled public-network speed comparison. See the JSON for full measurements.
- All four Chromium persistence tests passed: refresh/tab reopen with journal preservation; process restart using the same synthetic profile; offline/reconnect recovery; and revocation/disconnect isolation. The relay was simulated, with zero physical Cashonize signatures.
- Root TypeScript checks passed. Production build runs the frontend TypeScript check as well. Browser profiles and isolated regtest nodes were temporary test environments; no original service or wallet was modified.
- New run evidence is retained separately in `funding-chained-genesis-results.json` and `funding-zero-conf-results.json`; earlier evidence files are preserved.
