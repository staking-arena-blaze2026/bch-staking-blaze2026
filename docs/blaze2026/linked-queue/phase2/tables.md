# Before/after measurements

Baseline: `9726d5d`. Signed Schnorr transactions at 1 sat/byte. Bytes therefore equal miner fees in sats. VM operations and hash iterations below sum all inputs; per-input limits are in the JSON evidence.

## BCH/BCH: deterministic signed bytes and VM resources

| Action | Bytes/fee before → after | VM operation cost before → after | Hash iterations before → after | Inputs/outputs before → after |
| --- | ---: | ---: | ---: | --- |
| create | 5906 → 5544 | 279536 → 275489 | 265 → 246 | 2/3 → 2/3 |
| emptyInsertion | 3955 → 3613 | 385399 → 370765 | 121 → 109 | 3/4 → 3/4 |
| ordinaryInsertion | 2447 → 2355 | 304908 → 298166 | 73 → 70 | 2/3 → 2/3 |
| highestInsertion | 5593 → 5306 | 499734 → 486360 | 139 → 132 | 3/4 → 3/4 |
| cancel | 3985 → 3801 | 379837 → 341184 | 99 → 95 | 3/3 → 3/3 |
| claim | 5161 → 4874 | 418285 → 379894 | 92 → 87 | 3/4 → 3/4 |
| withdraw | 659 → 629 | 130905 → 108265 | 26 → 24 | 2/2 → 2/2 |

## BCH/token: deterministic signed bytes and VM resources

| Action | Bytes/fee before → after | VM operation cost before → after | Hash iterations before → after | Inputs/outputs before → after |
| --- | ---: | ---: | ---: | --- |
| create | 6128 → 5766 | 310853 → 306804 | 279 → 260 | 3/4 → 3/4 |
| emptyInsertion | 3955 → 3613 | 385379 → 370745 | 121 → 109 | 3/4 → 3/4 |
| ordinaryInsertion | 2447 → 2355 | 304902 → 298159 | 73 → 70 | 2/3 → 2/3 |
| highestInsertion | 5593 → 5306 | 499714 → 486340 | 139 → 132 | 3/4 → 3/4 |
| cancel | 3985 → 3801 | 379837 → 341183 | 99 → 95 | 3/3 → 3/3 |
| claim | 5591 → 5304 | 434900 → 396482 | 106 → 101 | 4/5 → 4/5 |
| withdraw | 659 → 629 | 130905 → 108265 | 26 → 24 | 2/2 → 2/2 |

## token/BCH: deterministic signed bytes and VM resources

| Action | Bytes/fee before → after | VM operation cost before → after | Hash iterations before → after | Inputs/outputs before → after |
| --- | ---: | ---: | ---: | --- |
| create | 5906 → 5544 | 279536 → 275489 | 265 → 246 | 2/3 → 2/3 |
| emptyInsertion | 4036 → 3694 | 388868 → 374234 | 128 → 116 | 3/5 → 3/5 |
| ordinaryInsertion | 2599 → 2507 | 308772 → 302030 | 82 → 79 | 2/5 → 2/5 |
| highestInsertion | 5674 → 5387 | 502881 → 489507 | 146 → 139 | 3/5 → 3/5 |
| cancel | 4334 → 4150 | 395401 → 356751 | 113 → 109 | 4/3 → 4/3 |
| claim | 5510 → 5223 | 434177 → 395789 | 106 → 101 | 4/4 → 4/4 |
| withdraw | 696 → 666 | 131040 → 108594 | 26 → 25 | 2/2 → 2/2 |

## token/token: deterministic signed bytes and VM resources

| Action | Bytes/fee before → after | VM operation cost before → after | Hash iterations before → after | Inputs/outputs before → after |
| --- | ---: | ---: | ---: | --- |
| create | 6128 → 5766 | 310853 → 306804 | 279 → 260 | 3/4 → 3/4 |
| emptyInsertion | 4036 → 3694 | 388848 → 374214 | 128 → 116 | 3/5 → 3/5 |
| ordinaryInsertion | 2599 → 2507 | 308766 → 302023 | 82 → 79 | 2/5 → 2/5 |
| highestInsertion | 5674 → 5387 | 502861 → 489487 | 146 → 139 | 3/5 → 3/5 |
| cancel | 4334 → 4150 | 395401 → 356750 | 113 → 109 | 4/3 → 4/3 |
| claim | 5940 → 5653 | 450792 → 412377 | 120 → 115 | 5/5 → 5/5 |
| withdraw | 696 → 666 | 131040 → 108594 | 26 → 25 | 2/2 → 2/2 |

## same token: deterministic signed bytes and VM resources

| Action | Bytes/fee before → after | VM operation cost before → after | Hash iterations before → after | Inputs/outputs before → after |
| --- | ---: | ---: | ---: | --- |
| create | 6128 → 5766 | 310853 → 306804 | 279 → 260 | 3/4 → 3/4 |
| emptyInsertion | 4036 → 3694 | 388848 → 374214 | 128 → 116 | 3/5 → 3/5 |
| ordinaryInsertion | 2599 → 2507 | 308766 → 302023 | 82 → 79 | 2/5 → 2/5 |
| highestInsertion | 5674 → 5387 | 502861 → 489487 | 146 → 139 | 3/5 → 3/5 |
| cancel | 4334 → 4150 | 395401 → 356750 | 113 → 109 | 4/3 → 4/3 |
| claim | 5940 → 5653 | 450792 → 412377 | 120 → 115 | 5/5 → 5/5 |
| withdraw | 696 → 666 | 131040 → 108594 | 26 → 25 | 2/2 → 2/2 |

## Complete user actions

Includes queue/seed creation preparations. Creation totals exclude the separate 1,000-sat announcement output and protected vault/root/gate carriers, which are not miner fees. The insert row sums **two actions** (empty plus ordinary), hence two approvals. All other non-creation rows represent one action.

Timing is one synthetic local sample, not public-network or Cashonize latency. Calls are Electrum facade invocations, **not actual wire RPC counts**; see README. Preparation + authorization is approval readiness; human approval time is excluded.

| Assets | Action | Total bytes/fee before → after | Calls before → after | Authorization calls before → after | Readiness ms before → after | Signature-to-Pending ms before → after | Approvals before → after |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| BCH/BCH | create | 6694 → 6332 | 632 → 524 | 272 → 164 | 6190 → 2656 | 1632 → 1127 | 3 → 3 |
| BCH/BCH | insert | 6402 → 5968 | 672 → 466 | 328 → 122 | 9337 → 4301 | 1509 → 858 | 2 → 2 |
| BCH/BCH | cancel | 3985 → 3801 | 360 → 248 | 176 → 64 | 9288 → 1933 | 770 → 771 | 1 → 1 |
| BCH/BCH | claim | 5161 → 4874 | 364 → 248 | 178 → 66 | 8975 → 4246 | 853 → 678 | 1 → 1 |
| BCH/BCH | withdraw | 659 → 629 | 701 → 314 | 328 → 65 | 14232 → 1148 | 919 → 390 | 1 → 1 |
| BCH/token | create | 6989 → 6627 | 605 → 497 | 272 → 164 | 4608 → 1846 | 1912 → 1503 | 3 → 3 |
| BCH/token | insert | 6402 → 5968 | 672 → 466 | 328 → 122 | 9027 → 3543 | 1281 → 2115 | 2 → 2 |
| BCH/token | cancel | 3985 → 3801 | 360 → 248 | 176 → 64 | 5163 → 2042 | 1392 → 600 | 1 → 1 |
| BCH/token | claim | 5591 → 5304 | 444 → 290 | 218 → 68 | 6722 → 2679 | 744 → 2035 | 1 → 1 |
| BCH/token | withdraw | 659 → 629 | 749 → 338 | 352 → 69 | 10817 → 2023 | 409 → 643 | 1 → 1 |
| token/BCH | create | 6694 → 6332 | 605 → 497 | 272 → 164 | 2884 → 1802 | 2781 → 1287 | 3 → 3 |
| token/BCH | insert | 6992 → 6558 | 672 → 466 | 328 → 122 | 9646 → 3036 | 1287 → 1171 | 2 → 2 |
| token/BCH | cancel | 4334 → 4150 | 452 → 296 | 222 → 66 | 5353 → 1856 | 936 → 565 | 1 → 1 |
| token/BCH | claim | 5510 → 5223 | 464 → 302 | 228 → 70 | 5885 → 2201 | 1923 → 648 | 1 → 1 |
| token/BCH | withdraw | 696 → 666 | 733 → 334 | 344 → 69 | 11650 → 1398 | 1649 → 573 | 1 → 1 |
| token/token | create | 6989 → 6627 | 658 → 532 | 296 → 170 | 3925 → 2289 | 1916 → 2110 | 3 → 3 |
| token/token | insert | 6992 → 6558 | 768 → 526 | 376 → 134 | 8341 → 3942 | 1646 → 1499 | 2 → 2 |
| token/token | cancel | 4334 → 4150 | 512 → 332 | 252 → 72 | 4486 → 2304 | 573 → 743 | 1 → 1 |
| token/token | claim | 5940 → 5653 | 616 → 386 | 304 → 78 | 10917 → 2732 | 1639 → 963 | 1 → 1 |
| token/token | withdraw | 696 → 666 | 789 → 366 | 372 → 77 | 4704 → 1791 | 798 → 743 | 1 → 1 |
| same token | create | 6989 → 6627 | 605 → 497 | 272 → 164 | 2539 → 1880 | 2308 → 1744 | 3 → 3 |
| same token | insert | 6992 → 6558 | 672 → 466 | 328 → 122 | 5015 → 2974 | 1403 → 1624 | 2 → 2 |
| same token | cancel | 4334 → 4150 | 452 → 296 | 222 → 66 | 3631 → 1779 | 697 → 696 | 1 → 1 |
| same token | claim | 5940 → 5653 | 544 → 344 | 268 → 72 | 5526 → 2604 | 835 → 963 | 1 → 1 |
| same token | withdraw | 696 → 666 | 749 → 338 | 352 → 69 | 4550 → 1261 | 1075 → 678 | 1 → 1 |
