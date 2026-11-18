# Compact vault detail layout

Post-baseline presentation work in the Blaze fork.

- Vault details includes the existing Claim reward action, the actual winning reward amount, and the caller-fee explanation. The separate Claim panel is removed.
- Make an Offer and Queue appear side by side above 850px. Smaller screens stack the two panels, and the ranking table scrolls within its panel.
- Waiting offers is renamed Queue.
- My Offers uses compact 12px buttons with horizontal, non-wrapping labels. Filters wrap between buttons on narrow screens.
- The displayed Baked status/filter is renamed Matured. The indexer's internal status and actual confirmed MTP withdrawal checks are unchanged; allocation timing and disabled withdrawal behavior remain visible.

Reward values come from the verified top offer, rather than a fixed example. Claim requests retain their expected-head binding, available-reward check, wallet authorization and saved-pairing restoration behavior. Unfundable-head handling remains available. Empty queues have a disabled claim button and no fabricated winning reward.

Validation uses the existing QueueArena behavioral suite and a local two-provider WSS blockchain fixture. No original checkout, deployment, runtime wallet or live chain is modified by the checks.

Completed validation: 20 QueueArena tests passed, the production build and frontend TypeScript checks passed, and the browser integration test passed. The browser authenticated a synthetic vault through two local WSS providers, verified claim placement, checked desktop side-by-side positioning at 1024/1672px and stacked layouts at 320/390/768px, and checked non-wrapping 12px My Offers labels at 320/390/1672px. It displayed Matured while correctly keeping an unconfirmed allocation's withdrawal disabled. No browser transaction broadcast occurred.

Evidence: browser-results.json, vault-1672.png, vault-390.png and my-offers-mobile.png.
