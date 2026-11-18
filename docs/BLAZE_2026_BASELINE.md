# BCH Blaze 2026: pre-existing Staking Arena baseline

## Competition boundary

Development begins **2026-11-14 at 14:00:00 UTC**, or **15:00:00 Europe/Prague (CET)**. The clock was checked at 14:07:17 UTC before preparation; no hackathon forks were created early. Commit and tag timestamps have not been altered.

Both public hackathon repositories are genuine GitHub forks created after the competition start. All preparation commits in this repository use their actual timestamps.

## Original repositories and website

| Evidence | URL / exact revision |
| --- | --- |
| Original source (public) | https://github.com/scinklja/bch-staking |
| Source baseline | `0f2666c4002098c3534ddec9986b8f9114986119` |
| Source tag | https://github.com/scinklja/bch-staking/tree/pre-blaze-2026 |
| Original website repository (public) | https://github.com/scinklja/staking-arena-site |
| Website baseline | `e685e6bd62381c3a587b3cb1d0c79d2affc0f459` |
| Website tag | https://github.com/scinklja/staking-arena-site/tree/pre-blaze-2026 |
| Original website | https://scinklja.github.io/staking-arena-site/ |
| Baseline screenshots, demonstration, and verification | https://github.com/scinklja/bch-staking/releases/tag/pre-blaze-2026 |

The source baseline is the pre-cutoff `dev/staking-arena-v3` commit, authored and committed at **2026-11-14 09:37:16 UTC**. The original default branch, `master`, remains unchanged and points to an older checkpoint. The latest baseline deployment records identify frontend build source `550b273b46e3a4071df28a7966936ad52edb421f`; the source baseline additionally includes the deployment verification record. The website baseline was authored and committed at **09:35:28 UTC**.

All 59 reachable original source commits and all 16 reachable original website commits examined before tagging have author and committer times before the cutoff. Local branches were examined separately; eight additional local commits also predate the cutoff but are not silently incorporated into this deployed v3 baseline. Uncommitted and untracked local work has unverified pre-cutoff provenance, is preserved privately, and is excluded from the baseline and planned initial fork checkout. File modification times alone do not establish when work was developed.

Both annotated tags were created after the cutoff: source at **2026-11-14 14:12:13 UTC**, website at **14:12:41 UTC**. Their tagger dates record actual creation time; they reference existing pre-cutoff commits and do not assert pre-cutoff tag creation.

Original branch creation, updates, deletion and force pushes are blocked by active GitHub rulesets without bypass actors. The baseline tags are protected against updates and deletion. Actions are disabled in both originals. The original website retains its existing Pages branch configuration (`main`, `/`) and deployment. Original source files and website assets were not edited, and no history was rewritten. Local commit/push guards and a disabled push URL protect the original source checkout. Administrative owners can still change repository settings; the freeze is an enforced operational safeguard, not an assertion that GitHub settings are irrevocable.

## Hackathon repositories and deployment

| Item | Status |
| --- | --- |
| New source fork URL | https://github.com/staking-arena-blaze2026/bch-staking-blaze2026 |
| New website repository URL | https://github.com/staking-arena-blaze2026/staking-arena-blaze-site |
| New website URL | https://staking-arena-blaze2026.github.io/staking-arena-blaze-site/ — deployed and verified HTTP 200 |
| Source fork creation timestamp | **2026-11-14 14:34:11 UTC** |
| Website fork creation timestamp | **2026-11-14 14:34:13 UTC** |
| GitHub parent relationships | Source parent: `scinklja/bch-staking`; website parent: `scinklja/staking-arena-site` (`fork: true` verified through GitHub API) |
| Hackathon local development checkout | `/home/omarchy/bch-staking-blaze2026`, branch `blaze2026` |

The organization `staking-arena-blaze2026` was created at 2026-11-14 14:26:43 UTC; active owner membership for `scinklja` was verified. The clock was checked again at 14:34:09 UTC immediately before native fork creation. Both forks are public and retain the originals as their GitHub parents. No ordinary repository copies were substituted for forks.

## Features completed before the hackathon

These are existing capabilities and experiments, **not hackathon contributions**. Availability and verification differ by version; consult the original versioned reports.

- CashScript staking contracts, compiled covenant artifacts, regtest infrastructure and tests; bounded offer registries, escrow, ranked offers, scheduled activation/settlement and independent matured stake withdrawals.
- Legacy v1 frontend and chipnet browser indexer, public Electrum connectivity, state/proof validation, wallet transaction planning and recovery, and browser period processing subject to documented trust and availability limits.
- Generalized v2 assets: native BCH or fungible CashTokens for staking and rewards, including same-category tokens, separate escrow/reserve outputs, and local/imported vault discovery and recovery.
- Continuous v3 staking: accumulated scheduled rewards, ranked competing offers, caller-funded claims, independent stake locks, one reward payment per newly created offer, and BCH/token asset combinations.
- Experimental chipnet Cashonize/WizardConnect interface, atomic direct v3 vault creation from suitable confirmed genesis UTXOs, two-stage fallback, transaction recovery, and action-time state verification.
- Responsive v3 creation and offer tabs, known-vault catalog and saved/imported configurations, with v1/v2 navigation retained.
- Existing documentation and previously recorded local, regtest, browser and chipnet evidence. Historical README descriptions can lag later versioned reports; they are preserved rather than retrospectively edited in the original.

## Work developed during BCH Blaze 2026

Website cleanup: removed legacy header navigation, linked the logo to v3, and removed the v3 introduction, expandable warning and visible network controls. The page starts with creation/offer tabs. Automatic provider verification and protocol/wallet checks remain in place. This is a presentation change developed in the fork; existing staking capabilities remain baseline work.

Fast v3 vault creation: adaptive bounded funding discovery, verified unconfirmed genesis inputs, provisional pending lineage replay for offers/claims, visible preparation stages, and an explicit two-approval fallback without a confirmation wait. See [implementation and wallet capability evidence](blaze2026/fast-vault-creation.md) and [isolated BCHN results](blaze2026/zero-conf-results.json). No covenant bytecode changes. This is post-baseline work; the original direct creation and funded-action designs remain pre-hackathon capabilities.

One-approval chained genesis without wallet `vout=0`: RegistryGenesisV4 + RewardFundingV3 link parent preparation outputs, keep the reward reserve covenant-locked, and allow a permissionless child after a single Cashonize approval. Direct single-transaction creation is preserved when an eligible `vout=0` exists. See [design and evidence](blaze2026/chained-genesis.md) and [isolated BCHN results](blaze2026/chained-genesis-results.json). This is post-baseline work; existing deployed vaults and RegistryGenesisV3 remain compatible.

Persistent Cashonize connection: unified manager/relay ownership, restoration of the existing SDK pairing, bounded retries and passive late recovery, stable transaction workers and stale-authorization rejection. See [implementation, test coverage and platform limits](blaze2026/cashonize-persistence.md). This is post-baseline work; synthetic-wallet browser persistence checks do not establish real Cashonize or operating-system restart behavior.

Preparation after the cutoff comprises audit, original publication, baseline evidence/tags, freeze configuration, native fork creation, this documentation, local isolation, and independent deployment setup. The build script accepts a separate Pages project base while preserving the original chipnet build settings; no staking contracts, application behavior or covenant artifacts are changed.

Wallet funding discovery repair: distinguish legacy explicit wallet refusal from uncertain signing, release safe unsigned reservations without deleting journals, validate live session derivation, prioritize known funded children, begin with six addresses, and replace the v3 eight-input cap with a fee/size bound. See [diagnosis, implementation and validation limits](blaze2026/wallet-funding-discovery.md). This is post-baseline work; real Cashonize acceptance remains to be verified by the wallet owner.

Direct atomic offer registration: explicitly versioned RegistryAtomicV4 retains separate owner authorization while accepting direct wallet funding and safe owner change in one transaction. Legacy RegistryV3 vaults and their two-stage journals remain compatible. See [design, authorization and limitations](blaze2026/atomic-offers.md) and [isolated BCHN evidence](blaze2026/atomic-offer-results.json). This is post-baseline work; physical Cashonize approval remains unverified.

Public vault discovery and retained listings: new on-chain marker announcements use existing public Electrum script indexes, with independently replayed V3/V4 state, bounded pages, persistent recovery hints and stale display snapshots. Three-provider verification distinguishes proven extension, propagation/unavailability and security conflicts. Live diagnostics found an actual provider branch divergence; it remains a signing block. See [architecture and limits](blaze2026/public-discovery.md) and [public provider evidence](blaze2026/provider-diagnostics.json). This is post-baseline work; it is not a complete historical index or a claim of live wallet approval.

Read-only chipnet upgrade investigation: [activation evidence and operator report](blaze2026/chipnet-upgrade/README.md) identify the November 2026 faster-block consensus split and an Optnlabs header rejected by a signature-verified isolated BCHN 29.2.1 preview. The installed 29.2.0 node was expired and left untouched; the preview reference validated headers but did not finish full-block synchronization. Required tick-aware input verification is documented, not silently substituted into transaction rules. This investigation changes diagnostics/documentation only.

Minute-based v3 creation and offer forms: new release intervals and offer durations accept whole minutes, with minimums of 1 minute on Chipnet and 10 minutes on Mainnet. Inputs convert to seconds before transaction preparation; worker preflight also enforces public-network minimums for new requests. Existing vaults, offers, recovery journals and covenant rules retain their second-based values. This is post-baseline application policy.

Whole-unit staking and local release timing: offers use whole 512-second time units, release intervals retain network-specific minute steps, and local-time schedules distinguish verified MTP availability from wall-clock timing. See [representation, consensus boundaries and focused validation](blaze2026/time-units/README.md). This is post-baseline application work, without new covenant versions or migration logic.

Illustrated arena landscape and navigation stripe: generated responsive scenery adds soft hills, grass and atmospheric arena flags/walls, with all primary navigation and wallet controls in a brown top bar. See [visual changes, prompts and browser evidence](blaze2026/landscape/README.md). This is post-baseline visual work; financial and contract logic is unchanged.

## How judges can compare versions

1. Inspect the original source and website `pre-blaze-2026` tags and exact commit links; annotated tag timestamps are intentionally later than the referenced commits.
2. Verify each new repository's public GitHub `fork`, `parent.full_name` and `created_at` metadata. The source parent must be `scinklja/bch-staking`; the website parent must be `scinklja/staking-arena-site`.
3. Fetch the original source as `upstream` in the new source checkout, then compare the verified baseline with the submitted final commit:

   ```bash
   git fetch upstream tag pre-blaze-2026
   git log --reverse 0f2666c4002098c3534ddec9986b8f9114986119..FINAL_SHA
   git diff --stat 0f2666c4002098c3534ddec9986b8f9114986119 FINAL_SHA
   git diff 0f2666c4002098c3534ddec9986b8f9114986119 FINAL_SHA
   ```

4. Inspect original commit https://github.com/scinklja/bch-staking/commit/0f2666c4002098c3534ddec9986b8f9114986119 and website commit https://github.com/scinklja/staking-arena-site/commit/e685e6bd62381c3a587b3cb1d0c79d2affc0f459. Compare final contract sources, frontend, tests and documentation separately from compiled output.
5. Open the original website and the separately recorded final website side by side. Use baseline release screenshots/video and the live asset hash manifest if current blockchain state differs.

## Verification and demonstration limits

The audited original source was published only after Gitleaks 8.30.1 scans of all reachable remote source and site history, all 18 accessible source Actions run logs, and the retained Actions artifact (including its expanded trace) found zero findings. A custom historical blob/path scan and manual review checked credentials, wallet files, environment files, configurations, workflows, and redistribution indicators. Candidate credentials were test mocks or library code. No proprietary redistribution blocker was identified; dependency licenses remain applicable. This is a bounded audit of accessible material, not a guarantee about unavailable or deleted GitHub data. Private runtime wallets, cookies, ignored environment files, local patches and raw diagnostic backups are excluded from public evidence.

Checks rerun on a clean checkout of the exact source baseline: frontend production build and TypeScript checks passed; all **99 frontend tests in 22 files** passed; **2 v2 protocol unit tests and 1 v3 pure-model test** passed. Full BCHN integration tests were not rerun; they mutate chain state and were kept separate from the user's running environment. Existing integration reports remain historical evidence, not new test results.

Fresh read-only browser evidence captured the original v3 creation and offer pages, mobile layout, v2 recovery and v1 marketplace. HTTP 200 and chipnet identity on two providers at height 332318 were observed, with no page errors. No wallet was connected and no transactions were signed or broadcast. Live blockchain state, provider availability, browser local records and wallet approval behavior cannot be frozen by Git tags. Wallet signing and complete end-to-end funding/claim flows were not reverified during preparation. The captured demonstration is dated after the cutoff and shows the pre-cutoff compiled website; it is not a claim of pre-cutoff video recording.

The v3 public catalog initially has no shared vault configurations; discovery depends on known/imported records or an external maintained catalog. Existing source documentation records further experimental restrictions. Preserve the original website and these evidence assets throughout judging.

## Hackathon development and deployment

`origin` is `https://github.com/staking-arena-blaze2026/bch-staking-blaze2026.git`; `upstream` fetches the original source, with upstream pushes deliberately disabled. The default development branch is `blaze2026`, created from the exact baseline. The configured push default and origin refspec target the hackathon fork. The original dirty checkout and runtime services are preserved, and private runtime files were not copied.

```bash
cd ~/bch-staking-blaze2026
git remote -v
git status --short --branch
codex
```

Have Codex read this document and `AGENTS.md`; make all future changes in this fork. Install dependencies using `npm ci --ignore-scripts` and `npm --prefix frontend ci --ignore-scripts`. Run `npm run blaze:dev` for browser-only chipnet development on http://127.0.0.1:5174, separate from the existing original service. This uses public Electrum and does not require a local wallet or BCHN. The legacy combined `npm run dev` requires a separate private backend configuration before use here; do not copy original wallet/node state or interrupt its services.

`npm run blaze:build` preserves the pre-existing public-only chipnet production configuration and builds with `/staking-arena-blaze-site/` as the Pages base. The website fork's `deploy.yml` workflow checks out this repository's `blaze2026` branch, installs both lockfiles, builds, records generated assets and the exact source SHA in `release.json`, commits compiled output to its own `main`, and deploys only its own Pages. No cross-repository token or wallet credentials are stored. Its Actions job is guarded to run only in the new website repository.

Source updates are checked every five minutes; GitHub may delay scheduled workflows. To publish immediately after pushing source changes:

```bash
gh workflow run deploy.yml --repo staking-arena-blaze2026/staking-arena-blaze-site
```

The original website remains at its original URL. Browser local state and wallet sessions may differ at the organization's distinct Pages origin, so imported configurations and wallet connections may need to be re-established.

## Completed fork verification (2026-11-14)

The initial setup source commit is [`6b5132b97666eddd35eab7fb26e569e1c398ea64`](https://github.com/staking-arena-blaze2026/bch-staking-blaze2026/commit/6b5132b97666eddd35eab7fb26e569e1c398ea64). Its [source CI run](https://github.com/staking-arena-blaze2026/bch-staking-blaze2026/actions/runs/43606034543) passed frontend unit tests, static builds/browser checks and Electrum fixture checks. In the new local checkout, the public production build, root TypeScript check, all 99 frontend tests in 22 files, and three v2/v3 protocol unit tests passed. No full BCHN integration or live wallet transaction tests were rerun. The browser-only development command was verified at HTTP 200 on port 5174 while the original service remained on port 5173.

The [first Pages workflow](https://github.com/staking-arena-blaze2026/staking-arena-blaze-site/actions/runs/43606071323) succeeded. It built the initial setup source SHA above and recorded compiled website commit [`cdb1bd5f54d2a49e77c088e97ad7f68723948a79`](https://github.com/staking-arena-blaze2026/staking-arena-blaze-site/commit/cdb1bd5f54d2a49e77c088e97ad7f68723948a79). Later documentation-only commits and deployments may follow; the live [release manifest](https://staking-arena-blaze2026.github.io/staking-arena-blaze-site/release.json) always identifies the exact currently deployed source commit and asset hashes. Website workflow runs identify both their input website configuration revision and the subsequently generated compiled-output revision.

The new website returned HTTP 200, all 25 production files matched the release manifest, and browser checks observed no page or HTTP errors. All four v3 staking/reward asset choices, direct-creation text, creation/offer navigation, reload, mobile layout and v1/v2 routes were verified. Two providers verified chipnet identity at height 332322 during the initial browser capture. No wallet was connected, and no signing or broadcast was tested. Worker-level WebSocket instrumentation separately verified read-only network requests and rejected any broadcast attempt.

Fresh evidence is committed alongside this document:

- [Browser report](blaze2026/public-browser-verification.json), [worker network report](blaze2026/worker-network-verification.json), and [asset comparison](blaze2026/public-asset-verification.json).
- [v3 creation screenshot](blaze2026/hackathon-v3-create.png), [offer screenshot](blaze2026/hackathon-v3-offers.png), and [mobile screenshot](blaze2026/hackathon-v3-mobile.png).
- The original demonstration video, original screenshots and baseline test results remain attached to the original [baseline evidence release](https://github.com/scinklja/bch-staking/releases/tag/pre-blaze-2026). That release's preparation report reflects its publication time, when organization access was still pending; this document records the subsequently completed fork setup.

Both new forks preserve their inherited `pre-blaze-2026` tags, protected against changes/deletion. Their default development branches are protected against deletion and force pushes while allowing ordinary development. Anonymous public access, actual GitHub creation timestamps, native parent relationships, local remotes and baseline ancestry are verified. The source fork's inherited manual Pages workflow is disabled; only the website fork has Pages configured.

A source diff against the baseline confirms no changes to `contracts/`, `src/`, `artifacts/`, `frontend/src/`, `frontend/tests/` or `tests/`. The original source's uncommitted patch still matches its private backup; no ignored wallet/node/environment data was copied. The original site remains accessible with its baseline index unchanged. Sensitive-data scans of the setup commits found no secrets. Future features must be developed and documented exclusively in the hackathon fork, under the reserved work section above.

Dual-network correction: Mainnet is now the default development/live-testing priority within one website, with V3/Atomic V4 transaction paths and explicit Cashonize signing approval. Chipnet remains selectable with original records and listings retained, and is temporarily transaction-disabled pending the documented consensus/provider repair. See [implementation, network separation and validation boundary](blaze2026/dual-network.md). Earlier chipnet-only build descriptions above are historical. The current `blaze:dev`/`blaze:build` default V3 to mainnet and keep chipnet available through the selector; no original repository or website is migrated.

Fast public marketplace indexing: static, schema-versioned, network-separated candidate pages replace per-visitor generic-marker history scans. The native Blaze website workflow automatically scans new and legacy announcements on every run, persists catch-up checkpoints and retains listings through provider outages. Dedicated network markers retain the existing carrier, fee and wallet approval path. Background verification stays separate from discovery, with bounded read workers and unchanged financial authorization requirements. See [architecture, measurements, acceptance and limitations](blaze2026/fast-public-index.md). This is post-baseline work; existing contracts, mainnet vault history and chipnet investigation are preserved.

Wallet transaction performance: financial preparation/submission is isolated from discovery and background reconciliation; independent providers run on separate transports, reusable evidence is bound to exact chain context, signed creation bytes are retained before network checks, and worker stages expose privacy-safe timings with recoverable timeouts. See [measurements, safety checks and live-wallet limits](blaze2026/transaction-performance.md). This is post-baseline work; Cashonize mainnet end-to-end targets are not claimed from synthetic or public read-only measurements.

Automatic saved-pairing restoration repair: event-driven wallet handshakes and serialized transport recovery continue with capped exponential backoff after the initial UI deadline; live handshake and revocation boundaries remain explicit. See [diagnosis, SDK round-trip coverage and live acceptance limits](blaze2026/cashonize-auto-restoration.md). This is post-baseline work.

Immediate submitted-offer visibility: a journal-backed unranked display separates broadcast acknowledgement from independent queue verification, with bounded automatic propagation retries, shared-snapshot journal reconciliation and retained signed recovery evidence. See [implementation and validation boundary](blaze2026/submitted-offers.md). This is post-baseline work; no mainnet spending or live Cashonize approval was used for validation.

Minimal marketplace UI: the default and logo route now open Make an Offer, with a four-column responsive vault list, page-position numbering, independently verified active counts and category-identified rewards. Permanent wallet/mainnet warning prose is removed while transaction checks remain unchanged. See [presentation and verification boundaries](blaze2026/minimal-marketplace.md). This is post-baseline frontend work.

Frontend branding: renamed the website to Stake Arena across navigation, page titles, loading/error messages and the wallet connection display name. This is post-baseline presentation work.

Tiered display verification and saved-pairing recovery replacement: public parameter hints survive frontend startup, read-only vault replays publish a provisional snapshot before independent agreement, provider status cannot queue ahead of selected-vault reads, and validated exact-tip MTP windows are reused without caching live spend availability. Manual Retry replaces stalled SDK managers/transports with the existing pairing; bounded automatic replacement covers silent subscriptions and stuck readiness publications. Real SDK encryption and local WebSocket regressions exercise these failures. See [measurements, safety boundary and pending live Cashonize acceptance](blaze2026/verification-recovery.md). This is post-baseline work; the wallet owner's normal-profile acceptance remains required.

Saved-pairing acceptance follow-up: the wallet owner confirmed few-second restoration after refreshing with Cashonize visible in a separate browser window, using a newly paired session. Actual Cashonize wallet-SDK/public-relay tests reproduced its intentional hidden-tab suspension and a retained WalletReady replay edge; recovery now requires a fresh post-probe readiness message. The original session was re-paired before diagnostics, so its exact failure remains unestablished. See the verification/recovery report for this distinction and the browser-wallet availability limitation.

Marketplace total rewards: the public preview and marketplace now show “Total max reward”, calculated exactly as reward per period × number of releases, and omit the visible provisional label from that amount. This is post-baseline presentation work; transaction rules and remaining-reserve calculations are unchanged.

Public About page and repository introduction: the supplied Stake Arena document is preserved verbatim in root `ABOUT.md`, rendered on the wallet-independent `#/about` route and used as the primary root README content. The previous technical README is preserved byte-for-byte in `docs/README-legacy-development.md`. Navigation and document styling are post-baseline presentation work; vault, wallet and transaction implementations are unchanged.

Marketplace presentation cleanup: removed the manual vault configuration import/share panel from the V3 offer interface and the “MAINNET — REAL BCH” header/footer text. This is post-baseline presentation work.

Create Vault presentation cleanup: removed the V3 introduction, detailed creation-path explanation, private funding diagnostics panel and optional legacy factory control. This is post-baseline frontend work; default creation and transaction verification remain unchanged.

Create Vault presentation cleanup follow-up: removed the manual “Search more wallet addresses” button. This is post-baseline frontend work.

Chipnet consensus compatibility and transaction restoration: explicit Imaginary/BCH Ninja provider policy excludes OptnLabs while retaining the prior bad-diffbits evidence. Tick-aware coinbase maturity, relative height locks and finality checks were implemented and tested against the signature-verified upgraded BCHN preview in an isolated regtest. Fresh selected-provider contextual header verification and all current public-vault state/reserve input checks passed before restoring transaction controls. See [restoration report and validation limits](blaze2026/chipnet-upgrade/restoration.md). This is post-baseline work; full-block Chipnet IBD and real Cashonize signing are not claimed.

Extended reward schedules: V3/V4 creation supports up to 1,000 scheduled releases with canonical Script integer encoding, two-byte extended discovery counts, exact reserve/duration/end-date display and retained original artifacts for all historical vault identities. Sixteen lifetime offer registrations and MTP reward mechanics remain unchanged. See [implementation and focused compatibility verification](blaze2026/release-limit/README.md). This is post-baseline work.

Saved pairing versus live wallet status: the header now distinguishes an offline saved Cashonize pairing from an authenticated connection, remembers a network/identity-bound receive address for display, and accepts bounded offline Create Vault / Make an Offer requests. Restoration retains all live authorization and independent transaction checks, cancels changed/expired intents and never persists a deferred spending request across reload. See [behavior, safety boundaries and validation](blaze2026/wallet-pairing-status.md). This is post-baseline frontend work.

My Offers, cancellation and owner stake withdrawal: public-catalog replay with canonical ownership filtering, network-specific last-wallet identity, five-state offer display, combined cancellation/unused commitment recovery, owner-approved matured withdrawals and safe unsigned recovery on both supported public networks. Existing contracts and legacy allocation accounting remain unchanged. See [behavior, recovery boundaries and verification](blaze2026/my-offers/README.md). This is post-baseline work.

Original artwork and visual redesign: the supplied logo and slogan banner are displayed together from the original JPEG bytes in both startup discovery and the full application. The layout, brown/beige tables and controls, and grass-green/yellow/sky-blue background follow the user's visual direction. Startup discovery retains the same branding instead of hiding it behind an unbranded list. See [implementation, asset provenance and verification](blaze2026/reference-redesign/README.md). This is post-baseline presentation work; financial and wallet rules are unchanged.

Vault detail and wallet header cleanup: a borderless eight-row summary shows total/remaining reserves, the reward pot and schedule; routine protocol/MTP/queue diagnostics and verbose fee prose are removed, and the claim action uses a short label. The offer panel scrolls normally. Wallet status and its last address are grouped above smaller re-pair/disconnect controls in a separate header column, with the manual saved-connection retry button and pairing helper prose removed. Automatic restoration, transaction verification and signing approvals remain unchanged. This is post-baseline frontend presentation work.

Vault-detail cleanup validation: the production build, 40 vault unit tests, 25 wallet unit tests, isolated fixture-backed vault-layout browser check and synthetic offline-wallet recovery/layout browser check passed. The latter checked compact controls and banner non-overlap at 320, 390, 768, 1024 and 1672 pixels. No original BCHN state or real wallet was used.

Compact vault controls and offline claims: smaller navigation pills, a raised original grill logo, a repaired comma-free transparent parchment banner, a compact claim panel under the offer form, and an inline scrolling My Offers list replace the previous presentation. A paired offline claim now uses the existing bounded wallet restoration policy and independently rechecks the winner/state before approval; navigation, expiry, session changes and reload cancel deferred requests. See [implementation, banner prompt and authorization boundaries](blaze2026/compact-vault-ui.md). This is post-baseline work; contract and fee rules are unchanged.

Banner palette refinement: the slogan uses a slightly darker, less saturated parchment treatment to match the original logo's banner. This is post-baseline CSS presentation work.

Linked-list queue replacement: new constrained genesis, a unique non-minting vault-state NFT, a persistent empty-list root and controlled distributed minting at individual offer nodes replace the public sixteen-registration marketplace. BCH stakes remain in nodes; token stakes use independent offer escrows. Exact ranking, release accounting, owner cancellation/withdrawal, size-priced caller fees, network-separated discovery, wallet journals and the frontend are implemented independently of the historical contracts. Adversarial review additionally closed an insertion-time asset-gate release gap. See [architecture, invariants, measured costs, verification and limits](blaze2026/linked-queue/README.md). This is post-baseline work; isolated BCHN/P2P and synthetic-wallet evidence do not establish physical Cashonize or public-network transaction acceptance.

Linked queue Phase 2 optimization: reuses exact reviewed transaction plans with fresh independent-source authorization, removes standing-queue traversal from claims and withdrawals, and reduces covenant witness bytes through authenticated delegation and consensus-implied checks. The queue authority, ranking, protected assets, size-priced fees and one-approval non-creation actions remain enforced. See [before/after measurements, proofs and validation](blaze2026/linked-queue/phase2/README.md). This is post-baseline work; one-approval vault creation and real-wallet/public-network latency improvements are not claimed.

Atomic linked-queue creation: ordinary wallet output-zero inputs create independent vault/queue categories, reserve, covenants, public listing, change and fee in one transaction and one approval. The genesis seed covenant and preparation/recovery stages are removed; complete authenticated-origin checks preserve the unique non-minting vault authority. Atomic offer insertion remains unchanged. See [design, UTXO limitations and validation](blaze2026/linked-queue/atomic-genesis.md). This is post-baseline work.

Automatic linked-queue wallet preparation on both public networks: a complete pre-signing quote and explicit extra-approval modal precede ordinary wallet self-sends when distinct output-zero origins are missing. Direct atomic creation remains one transaction/approval; minimal fallback uses two or three. Network-tagged durable operations, reserved continuation funding, deterministic recovery, exact signed-size fees and session checks preserve the existing category/authentication architecture. See [implementation and test boundaries](blaze2026/linked-queue/automatic-preparation.md) and [isolated dual-configuration measurements](blaze2026/linked-queue/preparation-results.json). This is post-baseline work; synthetic BCHN/P2P verification does not establish real Cashonize approval.
