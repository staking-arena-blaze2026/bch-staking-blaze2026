# Compact vault controls and offline claims

Post-baseline work developed 2026-11-17 in the native Blaze fork.

The two main navigation pills are approximately 60% of their previous desktop dimensions, with responsive sizing on small screens. The original grill logo is raised slightly; its JPEG is unchanged. The default bottom “Verified” message is omitted. A compact Claim reward panel sits directly below Make an Offer. The selected vault's My Offers section renders its owned offers directly in a bounded scrolling panel, using the existing canonical ownership filtering, statuses, cancellation and withdrawal actions.

## Claim while paired offline

Claim reward now uses the same bounded, memory-only reconnect intent as Create Vault and Make an Offer. A saved compatible pairing permits a click while offline; no wallet signing call happens before an authenticated live session returns. The 90-second deadline, pairing generation/network/identity checks, route/form scope and unmount cancellation remain enforced by `restoreWalletRequest`.

After reconnection, the selected vault is independently refreshed. Changed state, funding outpoints, scheduled release context, pending spends or an ineligible winning reward reject the request before wallet approval. The live wallet receives the same final authorization check used by the existing deferred offer flow. Connected claims retain their previous current-state and winning-offer verification path. Every transaction still requires explicit wallet approval; no spending intent is persisted across reload. Contracts, fees and reward accounting are unchanged.

## Banner asset

The user authorized a similar replacement banner to remove the comma and repair the lower-right corner. The built-in imagegen tool created a genuinely transparent parchment banner, inspected visually and encoded with preserved alpha into `frontend/public/assets/brand/stake-arena-slogan-v2.webp`. It replaces the hand-masked JPEG banner in both startup and React headers and displays about 10% wider on a full desktop layout, constrained on smaller screens to keep the wallet area clear.

Prompt used with the original banner as the edit target:

> Edit the supplied parchment slogan banner for the Stake Arena website. Preserve its illustrated tan/beige parchment, brown outlines, curled scroll ends and bold black serif lettering, with a similar wide silhouette. Render exactly two lines: line 1 MAKE THE BEST STAKE; line 2 TO GET A PIECE OF THE CAKE. No comma, punctuation or extra words. Repair the entire lower-right parchment corner so it is solid intact parchment with no holes, blue wedges or background protruding inside the banner. Remove all checkerboard background, replace exterior only with genuine transparent alpha, no gray, white or blue backdrop. Keep generous full lettering and complete scroll ends without clipping. Output a clean, tightly framed transparent banner suitable for placing on a sky-blue website background. This is a banner only; do not add a logo or utensils.

The original downloaded logo and banner remain preserved. No real wallet signing or public spending was used for validation.

## Validation

The 72 focused vault, owned-offer, startup-preview and wallet-request unit tests passed. The existing 500ms submitted-offer render check retains its threshold; expensive accessibility selector queries now sit outside its render-timing interval. Production TypeScript/build and the isolated fixture browser check passed, including smaller navigation, compact claim placement, scrolling offer-list styles and desktop/mobile layouts. The first browser attempt hit a click timeout under concurrent build load; the unchanged browser check passed when rerun on the completed build.
