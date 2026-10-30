# Price gap repair — closed

Updated: 2026-09-09. **Done, merged into `master`, deployed to production and verified.**
This file is kept only as a short record; the durable account is the backlog entry
`## 2026-09-09 — Production candle continuity repair validation` in
`docs/reports/experiments-backlog.md`. Nothing here is outstanding.

## What was wrong

`functions/_shared/marketDataRepository.ts` queried `ORDER BY date DESC LIMIT 8`
regardless of the requested `since`, so the market-data and forecast endpoints
dropped every candle between the bundled tail and the newest eight rows. In
production that omitted August 18 – September 1 for BTC (15 candles) and nine
sessions for each ETF, putting a 20.33% move into adjacent chart candles and
inflating blended daily volatility by about 22.6%. The browser had a second
defect: it discarded repair rows older than the bundled tail, so browser and
server could render different history. Production D1 already held the missing
candles, so this needed complete reads, not a backfill.

## What shipped

| Commit | Content |
| --- | --- |
| `fb648dc` | Diagnostic evidence (pre-existing) |
| `519c915` | Bounded ascending pagination, shared continuity guard, browser/server parity, adaptive worker backfill, stronger smoke check, frozen golden fixtures |
| `7ce1f3f` | Unscheduled NYSE closures in the market calendar, found by review of `519c915` |
| `8f83802` | Outage recovery writes only missing dates behind the routine window; ETag, `observedLatestDate` and smoke-constant drift fixes, all from the same review |
| `7767d7b` | Review outcome recorded in the backlog entry |

Design decision worth remembering: the authenticated HTTP backfill endpoint the
red worker tests proposed was **deliberately not implemented**. The incident
needed complete reads, and the scheduled refresh now widens its own source
window to the first hole or stored tail (clamped to 400 days), so an outage
recovers without exposing a new writable surface.

Review caught two real defects. First, in `519c915`: the market calendar knew
only recurring holidays, so any unscheduled closure (Sandy, days of mourning)
looked like a missing candle, and the guard would have truncated the whole
series after it. Assessed end to end the tracked VOO history stopped at
2012-10-26 and GLD at 2006-12-29. `7ce1f3f` adds the closure table and a test
asserting all three tracked datasets stay contiguous, so a future closure fails
`npm test` with the exact date to add instead of freezing the deployed chart.

Second, a repair window wider than 31 days reads bitcoin from Yahoo rather than
CoinGecko, and the refresh wrote every returned row. Closing one long hole would
have restated correct CoinGecko candles in Yahoo's aggregation and rounding,
and the next ordinary run would have reverted only the trailing week, leaving a
provider seam mid-series — the same spurious daily return this work removes.
`8f83802` restricts writes behind the routine window to genuinely missing dates,
covered by a test that fails without it.

## Verification

- 231 tests, `npm run lint`, `npm run build` pass. Backtest quality gate and
  block-bootstrap robustness audit pass, byte-identical to the pre-change run.
- No forecast constant and no tracked dataset under `src/data/` changed.
- Production after deploy: `/api/market-data?asset=btc&since=2026-08-10` returns
  30 contiguous rows (Aug 11 → Sep 9) where it previously returned 8 starting
  Sep 2; VOO and GLD return 22 sessions each; all three report
  `continuity.complete: true` and `status: current`.
- Largest adjacent BTC move over the repaired window is now +7.26%, not 20.33%.
- 30-day probability up is 23.98%, matching the diagnostic's predicted 23.95%
  for repaired inputs (28.18% on the gapped series).
- `npm run market-quotes:smoke` passes for all three assets.

## Follow-ups (not blocking)

- Re-audit forecast calibration once several weeks of contiguous live data exist.
- A point-in-time VOO/GLD backtest on repaired history is still outstanding.
