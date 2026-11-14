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
| New website URL | https://staking-arena-blaze2026.github.io/staking-arena-blaze-site/ (deployment being configured) |
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

Reserved for subsequent work performed exclusively in the verified new fork. No new staking features were implemented during this preparation. Record each new feature, its commits, tests and deployment here. Do not claim the capabilities listed above as hackathon work.

Preparation after the cutoff comprises audit, original publication, baseline evidence/tags, freeze configuration, native fork creation, this documentation, local isolation, and independent deployment setup. The build script accepts a separate Pages project base while preserving the original chipnet build settings; no staking contracts, application behavior or covenant artifacts are changed.

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
