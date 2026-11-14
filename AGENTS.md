# BCH Blaze 2026 development

Read `docs/BLAZE_2026_BASELINE.md` before making changes. Existing staking capabilities are pre-hackathon work.

This is the native hackathon fork checkout, `/home/omarchy/bch-staking-blaze2026`. Develop and push only to `staking-arena-blaze2026/bch-staking-blaze2026`, branch `blaze2026` (or branches in this fork). `origin` must point to that fork. `upstream` is the frozen public original and must never receive development pushes. Do not change the original checkout or original website repository/deployment.

Do not import the original checkout's uncommitted changes as pre-existing work; their pre-cutoff provenance is unverified. Do not copy `.chipnet`, `.regtest`, wallets, cookies, environment files or browser credentials. Do not rewrite or backdate history. Keep real timestamps and record hackathon features separately from the baseline.

The existing original service uses its original directory and ports. For browser-only development here, run `npm run blaze:dev`, which uses public chipnet Electrum and port 5174. Do not run the legacy combined `npm run dev` without a separate private backend configuration. Full BCHN tests mutate chain state; use an isolated test environment rather than the original running node.

The website is deployed by the native `staking-arena-blaze2026/staking-arena-blaze-site` fork. Its workflow builds this fork's `blaze2026` branch on a schedule and on manual dispatch. For immediate publication after a source push, run `gh workflow run deploy.yml --repo staking-arena-blaze2026/staking-arena-blaze-site`. No deployment may overwrite `scinklja/staking-arena-site`.
