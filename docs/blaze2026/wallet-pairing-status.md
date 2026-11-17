# Saved pairing, live wallet status and bounded requests

Developed in the native Blaze fork after the baseline. Existing transaction construction, independent verification, signature approval, journaling and conflict protection are pre-existing work.

A saved authorized WizardConnect pairing now has its own UI status. Restoration and temporary loss of liveness show **Cashonize paired · Wallet offline**, retain automatic recovery and expose manual Retry. Only a fresh authenticated WalletReady permits **Connected to Cashonize**. Invalid/revoked pairings require a new pairing. Transport connectivity and cached derivation paths do not grant live authorization.

After a compatible authenticated handshake, receive address index 0 is independently derived from the accepted chain xpub and checked against the SDK key. The optional display cache contains the network and wallet identity (authenticated relay peer plus accepted paths). The header shortens the address and labels it **Last connected address** while offline, including after reload. Explicit disconnect, replacement and invalidation clear the cache. Financial code never reads the address cache.

Create Vault and Make an Offer accept an offline click when a pairing exists. Other form, verification, capacity, pending-operation and vault-state restrictions remain. The click preserves form values, accelerates restoration and displays **Open Cashonize to continue**. One component-level operation lock prevents duplicate clicks. No financial preparation or signing occurs while waiting. Claims, withdrawals and recovery retain their live-wallet availability restrictions.

The pending request exists only in memory, with a 90-second absolute deadline. It binds the pairing, pairing generation, network and form/navigation revision. Disconnect/re-pair, changed identity/network, edits, expiry and component unmount invalidate it. Reload restores the pairing without restoring a spending request. After restoration, the current client must pass live network authorization. Offers independently refresh and compare the clicked state, source inputs, pending spends and reward-release count; changed state is shown for another review. Creation selects and verifies current wallet inputs through the existing worker.

The bounded request check travels to the live signing boundary and runs again after asynchronous preparation/authorization, so late preparation cannot initiate approval after expiry. Actual transaction terms, inputs, outputs, change and fees remain in the validated plan and explicit Cashonize signing prompt. Existing network/identity revisions, independent input/output/fee verification and wallet-broadcast-disabled rules remain enforced. A signature returned after interruption/expiry is journaled before rejecting submission; nothing automatically resubmits it or replays an expired intent. The normal explicit recovery UI remains available.

## Validation boundary

Regression coverage includes paired online/offline status, authenticated address caching, reload, cache clearing, automatic encrypted SDK restoration, transport replacement, explicit disconnect/revocation, wrong identity/network, offline create/offer, unchanged/changed vault state, duplicate clicks, edited/expired/unmounted requests, delayed authorization, explicit simulated wallet approval, and signed-journal retention after interruption. Browser tests use an isolated synthetic wallet transport which prohibits signing. No real BCH transaction or real Cashonize signature is requested for validation. These tests do not claim acceptance on the wallet owner's physical Cashonize browser.

## Changed files

- `frontend/src/usePersistentWallet.ts`: saved-pairing status/generation and verified display-address cache.
- `frontend/src/WalletConnect.tsx`: distinct status labels, offline Retry, address label and restoration hints exposed to the browser client.
- `frontend/src/walletTransactions.tsx`: separate pairing/restore API and optional bounded-request check.
- `frontend/src/walletRequest.ts`: memory-only restoration/deadline checks and relevant offer-state fingerprint.
- `frontend/src/V3Arena.tsx`: separate availability from authorization, preserve forms, serialize requests and reverify restored offers.
- `frontend/src/browserWalletClient.ts`: retain every existing live check and additionally enforce the request check at asynchronous approval boundaries.
- `frontend/tests/{WalletConnect,V3Arena,v3WalletSigning,walletRequest}.test.*` and `frontend/tests/wallet-browser/persistence.spec.ts`: regression and safety coverage.
- `docs/BLAZE_2026_BASELINE.md` and this report: separate hackathon work and validation boundaries.

`frontend/src/walletNetwork.ts` was reviewed and remains unchanged; its live network/identity assertions still gate signing. Existing unrelated local changes are excluded from this work.

## Test results

- Focused final run: **94 passed in four files**, including offline create/offer continuation through simulated explicit approval, wrong wallet/network, request expiry during preparation or approval, cached-address isolation and retained signatures. Command: `npm --prefix frontend test -- tests/V3Arena.test.tsx tests/WalletConnect.test.tsx tests/walletRequest.test.ts tests/v3WalletSigning.test.ts --testTimeout=15000`.
- Broader 13-file wallet/safety run: **126 passed, one optional live-relay test skipped**; one existing 500 ms presentation timing assertion failed under concurrent Chromium/resource pressure. The subsequent focused final run above passed every V3Arena test, including that unchanged timing assertion. The 15-second per-test runner timeout accommodates this machine; the 500 ms assertion remains unchanged. Coverage includes `walletNetwork`, `walletDerivation`, `walletSigning`, `walletRelay`, encrypted SDK restoration, local WebSocket recovery, worker scheduling and state verification.
- Browser coverage uses a fresh temporary profile and synthetic transport; signing is prohibited. The previous assumption of indefinitely reusing one manager was corrected to assert bounded automatic transport replacement with the saved pairing. This matches existing production recovery; replacement behavior was not changed by this feature.
- Subsequent deadline hardening: **32 passed** (`walletRequest` 13 and `v3WalletSigning` 19), including a backwards wall-clock adjustment. Expiry uses both wall-clock and monotonic elapsed deadlines. The current four focused files therefore have **95 passing cases across the final runs**.
- Final Chromium run: **5/5 passed** with `npm --prefix frontend run test:wallet:browser`, covering refresh/tab reopening, persistent browser-profile process restarts, ten minutes of automatic offline recovery, disconnect/revocation/profile isolation, and offline creation expiry/input preservation/reload with zero signing requests. All five passed together on the final run.
- `npm run blaze:build`: passed, including frontend TypeScript checking and the separate Blaze Pages production base. Existing bundle-size warnings remain informational. `git diff --check`: passed.
- Push CI additionally exercised the complete frontend suite: 217 passed and one optional test skipped; its only failure was an unrelated stale `browserIndexer` assertion expecting three default Chipnet providers. The existing consensus policy has two approved providers. The follow-up changes that test to assert the exact Imaginary/BCH Ninja endpoints and reject excluded OptnLabs explicitly; no provider or financial policy is changed. All five isolated BCHN CI jobs (tip verification, public discovery, zero-conf, chained genesis and atomic offers) passed.
- Provider-assertion follow-up: `npm --prefix frontend test -- tests/browserIndexer.test.tsx` passed all **6 cases** locally.
