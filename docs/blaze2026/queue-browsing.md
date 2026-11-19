# Queue browsing and transaction verification

The public index publishes a provisional waiting-offer count alongside each vault. A count carries its network, genesis transaction ID and observation time. The publisher reconstructs the current queue from one provider, updates the oldest observations first, and retains the previous count after an unavailable or inconsistent read. The browser uses the newest published or locally saved count. A dash indicates that no count is available.

The browser uses two read workers for the visible page and a separate worker for the selected vault. Each worker owns its Electrum transport. Timed refreshes sample the tip and the vault, node and root script statuses. Matching statuses and tip allow short-lived reuse of the structurally validated snapshot. Changed observations fetch the unspent outputs again. Browser actions refresh the display after submission, and navigation cancels obsolete reads. Queue and release-time observations remain provisional.

My Offers matches active entries to the connected receive key, or derives that key from the saved pairing's network-specific public branch while the wallet is offline. Local journal entries appear as Pending until the queue reports them or history classifies them. Archive reads run separately and check independent providers. The network-specific archive stores only confirmed history checkpoints for the particular owner and vault. Each peer checks the cached block against its current branch and verifies new relevant transactions. Withdrawals in the mempool are rechecked, and a replaced checkpoint or changed confirmed history triggers a rebuild. A withdrawal appears as eligible after the allocation is confirmed and mature, and both peers report it unspent.

Cancellation preparation reconstructs the reported queue to locate the offer and its predecessor, then quotes the exact spend. Authorization independently checks the selected controller, node, escrow and fee inputs, plus the immutable vault origin. A new withdrawal can use its claim transaction ID to locate the allocation directly. Authorization authenticates the origin and claim inputs, and rechecks allocation availability and relative maturity. Older journal requests without a claim ID can resolve it from the node script history.

Authorization and broadcast each check current spendability and fee policy because the wallet approval can outlive either observation. Within a pinned verification session, ancestry checks reuse hash-validated transaction bytes and linked header evidence. A final tip check covers the dependent reads and detects a change while verification was running.

## Read-only measurements

Single cold samples from the development machine on November 19, 2026. Each network sample used a published vault with one waiting offer. Counts include Electrum session setup. Public-provider latency varies.

| Network | Provisional read | Full independent sync |
| --- | ---: | ---: |
| Mainnet | 9 requests, 4.44 s | 78 requests, 7.37 s |
| Chipnet | 9 requests, 2.54 s | 410 requests, 14.56 s |

The provisional reads made zero transaction or Merkle requests. The initial marketplace counts came from the published index and required zero Electrum requests. A read-only publisher run recorded counts for five Mainnet vaults and one Chipnet vault. An isolated BCHN wallet regression measured nine Electrum facade calls for cancellation preparation and seven for withdrawal preparation with a claim ID.
