# Minimal marketplace UI (BCH Blaze 2026)

This post-baseline presentation change makes the bare website URL canonicalize to
`#/v3/offers`, preserving the URL query and selected network. Make an Offer is the
first tab and logo destination. Create a Vault remains at `#/v3`; existing vault,
v2 and legacy vault deep links remain supported. The legacy marketplace is also
reachable explicitly at `#/v1`.

Known vaults uses a semantic four-column table with a native link extending across
each row. Keyboard users can focus the link and press Enter. On small screens,
rows stack labelled values. Display numbers are page positions (20 per page), not
on-chain identifiers; links and all internal operations still use genesis hashes.
Refresh immediately follows the heading; paging and public-index continuation
controls follow the rows. Import and transaction recovery remain expandable.

Amounts use the independently verified configuration's immutable `cap`, never
remaining reserve or claimable buffer. BCH uses eight decimals. Without trusted
token metadata, amounts remain integer raw units and assets use an abbreviated
CashToken category, never an inferred ticker or decimals. The detail page retains
full category IDs and raw-unit descriptions.

Offer counts use `rankings(state, false).length` from the existing independent
marketplace replay. Cancelled, refunded and completed records are excluded.
Missing, expired (over two minutes), restored or failed snapshots do not produce
numeric counts. Replayed provisional state is explicitly marked `0-conf ·
provisional`. Public-index metadata and local pending journals cannot supply
counts. The lightweight startup preview also displays only verification
placeholders. Verification failures remain concise; the detail page exposes retry
and full context.

The permanent wallet compatibility panel and mainnet paragraph are removed.
Connected incompatible wallets receive a contextual error. Wallet session checks,
source verification, approval requirements and signing/broadcast boundaries are
unchanged. No protocol, covenant, indexer, queue formula, journal or financial
transaction implementation changes are included.

Validation covers exact BCH/token formatting; four column headings; tab order;
paging numbers and genesis links; verification placeholders; exclusion of inactive
records; explicit provisional labels; stale snapshot withholding; public discovery;
wallet persistence/signing/recovery; native keyboard links; desktop and mobile
layouts. Browser protocol tests use synthetic loopback WSS fixtures and compiled
covenant validation, without a BCHN process or real funds. The production build
uses the existing native Blaze workflow. `frontend/scripts/verify-minimal-marketplace.mjs`
checks a fresh browser profile, manifest, root routing, full-row click, keyboard
navigation, create page and network switching without connecting a wallet.

Local validation on 2026-11-16: frontend suite **176 passed in 33 files**, plus
the subsequently added verified-token/empty-queue case passed separately; **9/9**
V3 WSS browser tests and **2/2** static browser tests passed. Root/frontend
TypeScript checks and the Blaze production build passed. Desktop (1360 px) and
mobile (390 px) marketplace screenshots were reviewed. No real wallet was
connected and no BCH transaction was initiated. Production acceptance records
are generated separately by the read-only verification script after deployment.
