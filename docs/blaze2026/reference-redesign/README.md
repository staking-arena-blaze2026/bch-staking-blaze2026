# Original artwork and visual redesign

Post-baseline frontend presentation work, developed 2026-11-17 in the native Blaze fork.

The supplied dashboard reference guides the parchment surfaces, serif type, pill controls and wide marketplace table. The user's final direction uses brown/beige tables and buttons over a background blending from grass green at the bottom through yellow into sky blue at the top.

Both original supplied images sit together at the left of the header: the grill logo, then the slogan banner extending slightly beyond the desktop page midpoint. They are also present in the fast startup catalog, fixing a real missing-logo issue: the former startup screen hid the full application while showing an unbranded list. Startup and React now share static local artwork markup and load the same stylesheet.

## Original assets

The website copies these downloads byte-for-byte, without regenerating, re-encoding or retouching them:

| Public asset under `frontend/public/assets/brand/` | Supplied Drive file | SHA-256 |
| --- | --- | --- |
| `stake-arena-logo-original.jpeg` | `1uiwF7BuIhO0vrkxJUHJ9kLobQOwyf75I` | `2f9bdf79cead1d7ae27215b806c569005d8565bd8e26db202ca059fa5108f71b` |
| `stake-arena-slogan-original.jpeg` | `1uf2NakXhjSrl437sEledzCX9Lc4lG28P` | `738cc7c84890d95a451d4275a31d6cb6b455017f6e6b6f692707cbeb2f3e41ae` |

SVG display masks hide surrounding checkerboard and margins while keeping the original JPEG pixels intact. The favicon also uses the original logo JPEG. No generated artwork is used by this implementation.

## Verification

- `npm run blaze:build`: TypeScript and Pages production build passed.
- App and public-index preview tests: 15 passed, including assertions that the initial catalog contains both original image references and retains its single shared index request.
- Existing V3Arena/App checks in the earlier layout pass: 51 of 52 passed together; the 500ms submitted-offer timing assertion passed when rerun alone after concurrent build/browser load ended. No threshold changed.
- `browser-check.json` covers initial loading with the application entry deliberately delayed, then normal application rendering, desktop/mobile sizing, exact header order and banner position beyond the page midpoint. Screenshots were reviewed locally. No wallet was connected and no transaction was requested.

The public catalog retains actual values and its existing four columns; sample vaults and status counts from the reference were not invented. Financial rules, wallet authorization and contracts remain unchanged. Publication targets only the native Blaze source and website forks.
