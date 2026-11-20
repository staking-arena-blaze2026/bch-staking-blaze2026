# Stake Arena
*PvP staking protocol*

---

By turning passive yield farming into an active bidding market, users compete to lock up BCH or CashTokens in exchange for rewards.

This is not only a standalone product, but also a component to novel stablecoin design.

### How It Works

1. **Vault Creation:** A creator deploys a vault, funds it with reward assets, defines the maximum reward emitted per period (e.g., per block or per day), and specifies which asset (BCH or a specific CashToken) stakers must lock to compete.

   The rewards could even be a basket of tokens by leveraging the soon to launch Fun(d)Tokens platform.

2. **Competitive Bidding:** Stakers select a vault, specify the exact reward amount they want to claim, and place a bid by committing how much they are willing to stake and for how long. The bids can be revoked at any time.

3. **Priority Queue Ranking:** Every entrant is automatically ranked in the on-chain queue based on their commitment per unit of reward requested:

   *Priority Score = (Stake Amount × Lock Duration) / Requested Reward*

4. **Reward Dispensing & Lockup:** When the release interval triggers, rewards are released from the vault into a pot, from which they can be claimed. The highest-ranking bidder receives their requested reward immediately, and their committed stake is time-locked on-chain for their pledged duration. Any remaining reward stays in the pot and can be claimed by the second highest bidder. An option to choose partial reward claims will be added at a later point.

### Core Use Cases

- **Native BCH Time-Lock Incentives**
  - *The Upgrade:* Serves as a PvP market-priced alternative to yield generating locking mechanisms like Badgers, Blockpoints/Sequin, and fBCH cupons.
  - *The Mechanism:* BCH holders can be directly incentivized with BCH or tokens for time-locking their BCH, allowing the open market to discover the price for locked liquidity.

- **High-Conviction Token Airdrops**
  - *The Upgrade:* Eliminates Sybil claims,  faking participation to farm airdrops, and "claim-and-dump" behavior common in zero-cost, equal-distribution airdrops.
  - *The Mechanism:* Tokens are distributed strictly to participants willing to lock the most capital for the longest duration, ensuring initial supply lands in the hands of the most committed backers while avoiding direct sale IPO like legal issues.

- **Dynamic, Supply-Scaled Token Sinks**
  - *The Upgrade:* Solves the inflation problem of expanding-supply tokens (such as Badgers), where static, fixed-cost sinks eventually fail to offset new emissions.
  - *The Mechanism:* Because Stake Arena is PvP, rising staked token supply naturally drives users to outbid one another with larger stakes and longer lockups. This token sink dynamically scales the demand side alongside market supply, actively constricting circulating volume.

- **Zero-Interest, Redemption-Protected Stablecoin Minting**
  - *The Upgrade:* Replaces unpredictable and variable borrowing interest rates (such as those in PUSD and other LiquityV2 derivatives) with predictable opportunity cost. Replaces constant unpredictable redemption risk with clear, fixed terms.
  - *The Mechanism:* Instead of competing by paying ongoing interest fees, users compete for stablecoin minting privileges by time-locking their BCH. Borrowers secure 0% interest liquidity while locking capital on-chain.

    Because there is a locking period picked by the borrowers at minting time and a real market-based cost to picking a long period, this can lead to a natural redemption protection period mechanism.

---
