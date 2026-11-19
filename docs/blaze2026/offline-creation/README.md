# Offline Cashonize creation estimates

The Create Vault button can estimate costs when Cashonize is closed and the selected network has a previously authenticated pairing. The browser derives public receive, change and DeFi children from the SDK’s saved public paths. The existing last-address record binds the authenticated paths and transport identity to the network. New records store a fingerprint and the receive address. Public paths remain in the SDK session, and the discovery database continues to store its existing public address hints and provider-scoped evidence.

The queue worker uses the shared discovery scope, progressive path limits and complete sequence planner. It verifies the exact funding required by the proposed sequence and accounts for reserved inputs. A fallback refreshes candidate lists carried over from earlier requests before counting the full search, since unconfirmed funds can arrive at an unchanged tip. The offline estimate stays in memory. The worker reads journal reservations, and its estimate branch skips reconciliation, reservation writes, signing and broadcasting.

After acceptance, the existing 90-second restoration window starts. Reading the estimate carries no restoration deadline. The original pairing, selected network, form and page lifetime guard the request. A live plan is rebuilt from current funds and relay policy. Costs are compared using the exact unsigned sequence, source commitments, fees and vault parameters. A matching plan can proceed to fresh live signing authorization without another cost dialog. A changed plan needs a new review even when the displayed fees and approval count happen to match. The browser checks the live signing paths against Cashonize, which still requests every signature explicitly.

Browser tests simulate the wallet transport and use a worker reply fixture for the cost dialog. Isolated BCHN tests exercise the real shared planner, read-only journal behavior, exact fees, live preparation, signed recovery, and loopback P2P. No automated test broadcasts funds on a public network.

## Local measurements

One representative atomic run per network with an isolated BCHN node and a synthetic wallet. The numbers cover the planner and end at the first signing boundary. Reconnect-to-signing starts with a live wallet and excludes the time spent reopening Cashonize. The preview uses the same cached discovery and proof evidence as the preceding online run. These are component timings, with the funded path already known.

| Configuration | Offline estimate | After reconnect | Ordinary online creation |
| --- | ---: | ---: | ---: |
| Mainnet | 0.17 s | 1.14 s | 1.55 s |
| Chipnet | 0.19 s | 1.87 s | 1.86 s |

The ordinary online comparison against `8d1e0bc` used three runs per case and the same provider facade, funding and progressive boundaries. Both revisions used 66 Electrum requests on initial funding paths and 154 when the eligible origins were at indices 22 and 23. Wall-clock samples varied under host contention. The initial-address medians fell on both networks, while the mainnet late-address sample rose from 5.17 to 7.00 seconds. These runs establish request-count parity. They do not establish public-network latency parity or physical Cashonize response times.
