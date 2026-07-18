# Economy Metric Definitions

The administrator economy metrics (`GET /api/v1/admin/metrics/economy`) are
computed **only** from authoritative database records — never from the
process-local counters in `lib/metrics.ts`, which are resettable operational
telemetry and are never financial or item-accounting truth.

## Window and arithmetic

- The window is a required half-open `[start, end]` in UTC ISO 8601, bounded to
  a maximum of **90 days** (`WINDOW_TOO_LARGE` otherwise); `start` must precede
  `end` (`INVALID_WINDOW` otherwise).
- All Gold sums use exact `BigInt` integer arithmetic and are serialized as
  decimal strings (ADR 0001). Quantities are integers.
- An optional `itemSlug` filter narrows item-scoped figures; an optional
  `locationSlug` is accepted for forward compatibility.

## Definitions

| Field                 | Source & definition                                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `totalGold`           | Current sum of every `CurrencyAccount.balance` (as of the query, not the window).                                                                                                                               |
| `goldSources`         | Sum of positive `CurrencyTransaction.amount` created within the window.                                                                                                                                         |
| `goldSinks`           | Sum of the absolute value of negative `CurrencyTransaction.amount` within the window.                                                                                                                           |
| `marketplaceGross`    | Sum of `MarketplaceSale.grossPrice` for sales in the window.                                                                                                                                                    |
| `marketplaceTax`      | Sum of `MarketplaceSale.tax` for sales in the window.                                                                                                                                                           |
| `marketplaceShipping` | Sum of `MarketplaceSale.shippingFee` for sales in the window.                                                                                                                                                   |
| `marketplaceVolume`   | Count of `MarketplaceSale` rows in the window.                                                                                                                                                                  |
| `npcSpending`         | Absolute value of the sum of `NPC_PURCHASE` ledger debits in the window.                                                                                                                                        |
| `itemsGenerated`      | Sum of `ItemTransfer.quantity` where `fromCharacterId IS NULL` (world → player) in the window.                                                                                                                  |
| `itemsDestroyed`      | Sum of `ItemDestruction.quantity` in the window.                                                                                                                                                                |
| `activeListings`      | Count of `MarketplaceListing` rows currently `ACTIVE` (as of the query).                                                                                                                                        |
| `medianUnitPrice`     | Median of per-unit sale price (`grossPrice / quantity`) over sales in the window. Below **five** comparable sales this is `null` ("insufficient market history"), matching the player-facing summary threshold. |

## What metrics never do

Metrics are read-only. No metric value automatically changes prices, grants
compensation, resolves reports, mutes users, or triggers any admin mutation.
Every economic action is an explicit, reasoned, audited operation.
