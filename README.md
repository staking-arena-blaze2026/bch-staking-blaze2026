# Staking Arena — BCH chipnet integration

**BCH Blaze 2026: [pre-existing baseline, hackathon changes, and judging comparisons](docs/BLAZE_2026_BASELINE.md).**

Hackathon development uses branch `blaze2026` in this fork. Run `npm run blaze:dev` for the browser frontend on port 5174; see the linked document before using the historical backend startup instructions below.

Generalized assets v2 is developed separately on `dev/generalized-assets-v2-implementation`.
It supports BCH or fungible CashTokens for both staking and rewards, including
same-category token vaults, with separate state, staking escrow and reward reserve
outputs. See the [architecture, accounting, layouts and limitations](docs/generalized-assets-v2.md)
[local BCHN verification](docs/generalized-assets-v2-results.json), and the
[complete verification report](docs/generalized-assets-v2-verification.md).
Use the opt-in `#/v2` browser page; deployed v1 covenants and the public website
are unchanged. No new public-wallet or chipnet compatibility claim is made.
Run `npm run node:start` and `npm run test:v2` to reproduce verification without
chipnet funds; `npm test` includes both covenant families and legacy regressions.

Chipnet is now the primary integration environment. See [chipnet startup, wallet flows, network checks and verification limits](docs/chipnet.md). `npm run dev` now uses `.chipnet/frontend/config.json` and localhost BCHN RPC 48332. Mainnet is prohibited; regtest data and tests remain reference material. The [live chipnet audit](docs/chipnet-e2e-verification.json) records 10 confirmed project transactions through reward payment and independent withdrawal; [local VM tests](docs/chipnet-local-verification.json) are recorded separately. The historical setup sections below describe the retained regtest environment; use `ARENA_NETWORK=regtest` explicitly to run it.

The React frontend can index chipnet directly in a browser worker over public WSS and automatically activate/settle periods without wallet signatures, BCHN or an application API. Browser processing is mandatory while the site is open and verified; closing/suspending the browser or losing providers stops progress. Guaranteed unattended operation requires an independent keeper. Scheduled offer cutoffs are frontend policy, not covenant-enforced upper deadlines. See [browser startup and trust limits](docs/browser-electrum.md) and [browser settlement, fees and chipnet evidence](docs/browser-settlement.md). The optional Node/API development environment still starts with `npm run dev`; open http://127.0.0.1:5173.

Wallet-authorized chipnet Create Vault and Make an Offer are under development on `dev/browser-wallet-transactions`. See [usage and irreversible funding/recovery restrictions](docs/browser-wallet-transactions.md) and [verification results and the remaining live-wallet release gate](docs/browser-wallet-verification.md). The user authorized an experimental chipnet release without further tests. These flows are labeled as not yet verified end to end with a real wallet.

Staking Arena v0.3.0 backend development is on `feature/keeper-indexer`: see [keeper/indexer architecture, operation and limitations](docs/keeper-indexer.md). The read-only Node API supports chipnet Electrum, and the BCHN/regtest keeper workflow remains available through the shared transaction builder; the v0.2.0 covenants are unchanged. The independent adversarial review remains deferred; browser settlement development is on `dev/browser-electrum-indexer`.

Verified on Omarchy / Arch Linux, x86_64. This project includes the original infrastructure example and a bounded staking architecture experiment. Read [the architecture and limitations](docs/staking-architecture.md) before using the prototype. It is not a production staking platform. The [cancellation deadline investigation](docs/cancellation-deadlines.md) includes a BCHN-mined counterexample to UTC upper-bound cancellation checks and an irrevocable period-state experiment.

The [16-offer authenticated registry](docs/registry.md) adds protocol-assigned sequence numbers, UTC-gated immutable activation snapshots, fixed UTC reward periods, upfront S×W CashToken escrow, independent per-win allocations and maturity, future-only cancellation, full-roster ranking and collateral accounting. Offer eligibility freezes at actual on-chain activation; delayed execution does not shift the UTC schedule. Each win atomically pays its BCH reward and creates a token-funded allocation withdrawable by its owner independently of all registry phases. It remains a regtest experiment with documented genesis, asset and withdrawal limitations.

## Restart after VM boot

On this VM, `staking-arena-dev.service` is installed as a persistent user service and enabled at boot. User lingering is enabled, so it starts before login and stays running when terminals close. It uses the same saved configuration and launcher described below. No terminal command is needed after reboot.

```bash
systemctl --user status staking-arena-dev
systemctl --user restart staking-arena-dev
journalctl --user -u staking-arena-dev -n 40 --no-pager
```

To stop it now, use `npm run dev:stop` or `systemctl --user stop staking-arena-dev`. A deliberate stop does not trigger automatic restart; it will start again on the next boot. To disable future boot startup, run `systemctl --user disable --now staking-arena-dev`. To restore it, run `systemctl --user enable --now staking-arena-dev`.

The unit template is [scripts/staking-arena-dev.service](scripts/staking-arena-dev.service), installed at `~/.config/systemd/user/staking-arena-dev.service`; it assumes this checkout is `~/bch-staking` and the project's Node 24 installation is available through mise. To install it again on this layout, copy the template there, run `systemctl --user daemon-reload`, `loginctl enable-linger "$USER"`, then `systemctl --user enable --now staking-arena-dev`.

For manual foreground startup:

```bash
cd ~/bch-staking
FRONTEND_HOST=0.0.0.0 npm run dev
```

Use `mise exec --` before npm if your terminal has not activated the project's Node 24 version. `FRONTEND_HOST` defaults to `0.0.0.0`, so plain `npm run dev` also works. In Windows Chrome, use **http://localhost:5173** if your existing QEMU forwarding maps Windows port 5173 to guest port 5173; otherwise use its existing Windows-side port. This command does not modify QEMU forwarding or publish a site. `FRONTEND_HOST=127.0.0.1 npm run dev` restricts the UI to the guest's loopback interface.

The launcher starts BCHN, waits for regtest RPC, loads the existing `dev` wallet if needed, starts the read-only indexer and waits for its health check, then starts Vite and verifies the API proxy. It reads **`.regtest/frontend/config.json`** and its existing checkpoint. Missing configuration, checkpoint, wallet or dependencies produces an error; startup never generates replacements, mines blocks, creates vaults, or resets the chain. Normal indexer synchronization preserves checkpoint history and atomically saves updates. BCHN RPC stays on **127.0.0.1:18443**, the indexer on **127.0.0.1:3100**; only the UI listens on `0.0.0.0:5173`. The browser accesses the read-only API through Vite's `/api` proxy.

Healthy instances from this checkout and configuration are reused. Repeating `npm run dev` while everything is running reports their status and exits without creating duplicates. Concurrent launchers serialize startup; the existing checkpoint writer lock also prevents independent indexers from sharing the checkpoint. Unrelated processes and listeners with incompatible bindings are left untouched and reported as conflicts.

**Ctrl+C** stops only services started by that invocation, in reverse order. Services already running before that command remain running. To stop all services started by any development launcher, including after a launcher crash, use:

```bash
npm run dev:stop
```

`dev:stop` uses recorded process identities, requests graceful shutdown and never deletes blockchain, wallet or checkpoint data. Repeated stop is safe. Manually started services are left running; use `npm run node:stop` separately to stop a manually started BCHN. If a service started by a foreground launcher exits unexpectedly, it reports the failure and shuts down its other owned services; run `npm run dev` again to recover. The installed user service restarts the launcher after failures, with a limit of five starts per five minutes. A force-killed launcher can leave healthy services behind; a new invocation reuses them and `dev:stop` can still stop them.

Logs are appended to `.regtest/dev/BCHN.log`, `.regtest/dev/indexer.log` and `.regtest/dev/Vite.log`; BCHN's own log remains `.regtest/regtest/debug.log`. Health checks:

```bash
curl -fsS http://127.0.0.1:3100/health
curl -fsS http://127.0.0.1:5173/api/health
ss -lntp '( sport = :18443 or sport = :3100 or sport = :5173 )'
```

If dependencies are missing, run `mise exec -- npm ci` and `mise exec -- npm --prefix frontend ci`. `npm run frontend` is a compatibility alias for the same launcher and honors `FRONTEND_HOST`.

The opt-in **`npm run test:dev`** checks real startup, simultaneous/repeated startup, Ctrl+C ownership, repeated stop, each service's interruption/recovery and port conflicts. All three service ports must be free before running it. It uses the existing saved chain/configuration, never mines, verifies the complete checkpoint and config remain unchanged, and leaves services stopped. See [verification results](docs/dev-startup-verification.md). The older `npm run node:start` remains available for infrastructure tests; unlike `dev`, it may create the initial wallet and mine maturity blocks on first use. Do not use `npm test` as a startup command: integration tests append blocks.

## Commands

```bash
mise exec -- npm run node:status
mise exec -- npm run mine -- 10
mise exec -- npm run compile
mise exec -- npm run compile:registry
mise exec -- npm run typecheck
mise exec -- npm test
bash scripts/node.sh rpc getbalance
bash scripts/node.sh rpc getrawtransaction TRANSACTION_ID true
```

Tests consume test BCH and append local blocks each run. The period, allocation and legacy registry tests wait on actual UTC boundaries without changing the node clock; allow several minutes for the full suite. They require the node to be running. Do not run multiple integration tests or scans concurrently.

## Files and installation

- `contracts/`: current Registry, StakePool and per-win StakeAllocation covenants, plus retained legacy experiments.
- `src/`: cookie-authenticated JSON-RPC client and CashScript `NetworkProvider` implementation.
- `tests/`: actual BCHN lifecycle, full-roster ranking, token escrow, independent allocations, snapshots, reserves, maturity and replay tests.
- `scripts/`: node lifecycle, mining and verified BCHN installation.
- `artifacts/`: compiler output.
- `docs/`: verification evidence, setup report and latest transaction IDs.
- `.regtest/`: private local node data, wallet and cookie; excluded from Git, directory mode 700.
- `downloads/`: downloaded archive and isolated public GPG keyring, excluded from Git.
- `~/.local/opt/bchn-29.2.0/bin/`: installed binaries; `~/.local/bin/` contains links.

Existing Git and mise were retained. Node 24.22.2 was installed with `mise use node@24`; `mise.toml` pins the project version without changing the global Node version. npm dependencies are recorded in `package-lock.json`.

Reinstall dependencies with `mise install && mise exec -- npm ci`. On another Arch machine without Git/mise/GnuPG/curl/ripgrep, install these through Arch packages first (`sudo pacman -S --needed git mise gnupg curl ripgrep`), after a normal full system upgrade. No system packages were removed during this setup.

Install BCHN with `bash scripts/install-bchn.sh`. The installer downloads the official 29.2.0 binary and clear-signed checksum manifest, imports the pinned upstream signer fingerprint, checks the GPG signature and fingerprint, then checks SHA-256 **before** extracting or installing. The initial installation used the same archive and manifest from the official download server's `releases/latest/` directory. Evidence is in `docs/signature-verification.txt` and `docs/checksum-verification.txt`.

Signer fingerprint: `D465135F97D0047E18E99DC321810A542031C02C`, published in the official tagged source's `contrib/gitian-signing/keys.txt`. GPG reports unknown owner trust because no personal web-of-trust certification was made; the signature is cryptographically valid and the fingerprint matches upstream. Trust originates in the official HTTPS sources, not an independent out-of-band identity check.

Sources:
- https://github.com/bitcoin-cash-node/bitcoin-cash-node/releases/tag/v29.2.0
- https://docs.bitcoincashnode.org/doc/index.html
- https://raw.githubusercontent.com/bitcoin-cash-node/bitcoin-cash-node/v29.2.0/contrib/gitian-signing/keys.txt
- CashScript provider interface and Electrum implementation inspected in installed `node_modules/cashscript/dist/network/` (0.14.0).

## Isolation and provider design

Every CLI invocation explicitly selects this project's data directory and regtest. `connect=0`, `listen=0`, `dnsseed=0`, `discover=0`, UPnP/NAT-PMP disabled prevent automatic peers or inbound P2P connections. RPC binds IPv4 localhost only and uses BCHN's generated cookie; no fixed password is stored. Startup also calls `setnetworkactive false` to disable P2P processing. No public blockchain or preexisting wallet was opened. Keep this configuration private to regtest.

The standard CashScript Electrum provider speaks the Electrum protocol, not BCHN JSON-RPC, and does not supply a default regtest endpoint in 0.14.0. The reference BCHN adapter implements the SDK interface over local RPC, checking the configured chipnet or regtest identity. Public Node/browser Electrum is available separately as documented below. It uses `scantxoutset` with raw locking scripts, merges matching mempool outputs and filters spent outputs with `gettxout`. `txindex=1` enables raw transaction retrieval after confirmation. There is no Electrum service to start.

This adapter suits a small private chain: scans are not an address index, must not overlap, and do not offer Electrum subscriptions. The BCH-only adapter explicitly rejects CashToken UTXOs; the separate token-aware adapter supports the existing token contracts and regression tests. Scan/mempool queries are not an atomic snapshot. Use a serial development workflow. Coinbase maturity filtering is not provided for arbitrary mining-address queries; contract funding in this example uses mature wallet funds.

## Troubleshooting

- Use `mise exec --` to avoid the globally configured Node 26.
- Startup logs: `.regtest/regtest/debug.log`. An RPC connection error usually means `npm run node:start` is needed.
- BCHN 29.2.0 does not accept `-daemonwait` or the `networkactive` config option. Start uses `-daemon` plus a bounded readiness poll. `connect=0` must be inside `[regtest]`.
- TypeScript 7 needs explicit `types: ["node"]` in this project; Node type definitions match Node 24.
- RPC port 18443 must be free. Inspect with `ss -lntp`; do not terminate unrelated processes.
- Insufficient funds: `npm run mine -- 101` creates mature regtest funds.
- Scan already in progress: wait for the other test/scan to finish.
- npm may report esbuild's install script as pending approval. The installed platform binary was sufficient and tsx was executed successfully; no blanket install-script approval was enabled.
- Never delete `.regtest` while the node is running. Deleting it discards this environment's test chain and wallet.

## Independent static website hosting

Staking Arena can be served from Cloudflare Pages while this VM is shut down. See [Cloudflare setup and deployment steps](docs/cloudflare-pages.md) for GitHub build settings, `VITE_API_BASE_URL`, account configuration and historical snapshot behavior. The current default is the [browser Electrum reader](docs/browser-electrum.md); use `VITE_INDEXER_MODE=off` for an explicitly offline preview. The browser guide contains current backend-free verification. The production default makes no API requests. Compiled releases are published separately to the existing GitHub Pages artifact repository; local development and VM port forwarding remain available.

### Electrum read-only chipnet API

Run `ARENA_PROVIDER=electrum ARENA_NETWORK=chipnet npm run arena -- config/electrum-chipnet.json`
without BCHN or RPC credentials. The example pins a real chipnet vault; keeper and broadcasts
are disabled in this mode. See [Electrum configuration, verification and trust limits](docs/electrum.md).

### Browser Electrum indexing

A production frontend build now defaults to direct chipnet WSS indexing when no API URL is configured.
Install root and frontend dependencies, then run `npm --prefix frontend run build` and
`npm --prefix frontend run preview`. Use `VITE_INDEXER_MODE=electrum` for direct browser reads during Vite development.
The worker shares validation/replay with Node, uses IndexedDB, and coordinates tabs without a hosted API.
Marketplace display defaults to `VITE_MIN_DISPLAY_CONFIRMATIONS=0`; set it to `1` or higher at build time for confirmation-gated vaults and offers. Spending and settlement still require confirmed inputs. See [0-conf visibility, regtest validation and limits](docs/zero-confirmation-visibility.md).
See [browser configuration, trust assumptions and verification](docs/browser-electrum.md).


### V3 continuous queue development

The separate `src/v3` / `contracts/v3` covenant family releases scheduled rewards
into a virtual accumulating buffer. Offers rank continuously by exact S*T/R and
claims always pay the live head. Each win creates a separate relative stake lock.
V1/v2 vaults retain their existing covenant and frontend behavior.

See [the v3 architecture, timing, accounting and limitations](docs/staking-arena-v3.md)
and [the scenario-by-scenario verification record](docs/staking-arena-v3-verification.md).
Use `npm run node:start`, `npm run test:v3`, and the frontend `#/v3` route for local
regtest development. V3 builders and browser connections reject public networks.
No chipnet/mainnet deployment is authorized or included.
