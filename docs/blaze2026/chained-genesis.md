# One-approval covenant-controlled vault genesis — BCH Blaze 2026

Post-baseline work in the native Blaze fork. Mainnet remains disabled. No public chipnet transaction was signed or broadcast during verification.

## Authorization contract

Create Vault uses **exactly one** Cashonize/`manager.signTransaction` approval in both supported creation modes:

1. **Direct** (unchanged): wallet already holds a verified token-free `vout=0`. One transaction establishes the CashTokens category and vault outputs.
2. **Chained** (new default when no eligible `vout=0` exists): the wallet signs only the parent preparation transaction. The application immediately builds and broadcasts a permissionless child. No second signature and no confirmation wait.

The legacy two-approval factory path (`createLegacy` / RegistryGenesisV3) remains available only as an explicit optional control. It is no longer the default fallback.

WizardConnect still has no dependent-transaction package field; the child requires no wallet signature because both preparation outputs are covenant-locked.

## Covenant design

New contracts (existing RegistryGenesisV3 / RegistryV3 / AssetRoleV3 unchanged):

| Contract | Role |
| --- | --- |
| `RegistryGenesisV4` | Parent `vout=0` carrier (12,000 sats). `create()` requires input 1 to be the same parent’s `vout=1`, then enforces the immutable vault layout. `refund()` returns the carrier to the owner with an external fee. |
| `RewardFundingV3` | Parent `vout=1` full reward reserve. `fundGenesis()` is permissionless only as input 1 beside the committed genesis locking bytecode from the same parent. `recover()` returns the reserve to the owner with an external fee. |

Security properties verified on BCHN 29.2:

- Preparation outputs are not freely spendable.
- Parent outputs are cryptographically linked (same `outpointTransactionHash`, indices 0 and 1).
- Immutable vault parameters cannot be altered at genesis.
- Reward funding cannot be redirected to an arbitrary address.
- Substituting an unrelated funding input is rejected by builder and covenant checks.
- Diverting the reserve fails VM verification and `testmempoolaccept`.
- Owner recovery of an abandoned parent preserves the carrier and reserve; the withheld child then becomes unspendable.
- No backend key or custodial operator is required.

## Discovery

Fund discovery for the chained path only requires sufficient BCH and reward assets. It does **not** exhaustively search for a wallet-owned `vout=0`. Progressive adaptive discovery (recently funded keys first, six addresses per batch, early stop) is unchanged. Selected inputs are still independently verified before signing.

## Evidence

- `ARENA_NETWORK=regtest npx tsx --test tests/blaze-chained-genesis.test.ts` — isolated BCHN 29.2 security/integration results in `chained-genesis-results.json`.
- `tests/blaze-zero-conf.test.ts` — preserves direct one-tx path and records chained one-approval / two-tx behavior.
- Frontend signing tests count one manager call for direct and chained creation; legacy still requires two explicit calls.

## Remaining risks

- Parent accepted / child rejected leaves covenant-locked outputs until the owner recovers or retries the identical child bytes. Recovery needs an external 10,000-sat fee coin per recovered output.
- Electrum cannot prove network-wide mempool acceptance; the broadcast provider remains authoritative.
- Physical Cashonize prompts were not exercised; approvals are counted via the local signing harness and mock manager.
