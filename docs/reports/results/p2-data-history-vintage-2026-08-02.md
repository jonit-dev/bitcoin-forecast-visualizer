PARTIAL

# P2 Data History Recovery and Vintage Archive — implementation evidence

Date: 2026-08-02
Status: `PARTIAL — implementation validated locally; live ALFRED/archive acceptance blocked`

## Command evidence

| Command | Result | Direct output summary |
| --- | --- | --- |
| `yarn test` | PASS | 27 files, 116 tests passed |
| `yarn lint` | PASS | `tsc --noEmit` exited 0 |
| `yarn build` | PASS | Vite transformed 2,112 modules and produced `dist/` |
| `yarn build:features` | PASS | 5,842 rows, `2010-07-18 → 2026-07-15` |
| `yarn validate:features` | FAIL as intended | `futuresOpenInterestUSD count=28 minimum=30` |
| `yarn check:freshness` | FAIL on stale baseline | required BTC/MVRV/on-chain/features lag 18d vs 3d caps; VOO lag 18d vs 7d |
| `yarn validate:data` | FAIL at known baseline | MVRV validator reports CoinMetrics mismatch count 5,722; feature validation is not reached |
| `yarn backtest` | PASS | quality and robustness gates pass; report `backtest-2026-08-02T22-00-14-848Z.{json,md}` |
| `git diff --check` | PASS | no whitespace errors |
| caller census | PASS | all seven updaters call `mergeByKey` and `appendVintageRecords`; macro calls `requireEnv`; `reconstruct:vintage` is registered and exported |
| obsolete-path search | PASS | no `fredgraph` URL or `REQUIRED_MAX_LAG_DAYS` remains |

## P2 acceptance mapping

1. Macro history from 2010: implementation requests all five series from the
   ALFRED/FRED observations endpoint with `observation_start`, `api_key`, and
   `realtime_start`; real row coverage is **not proved** because `FRED_API_KEY`
   is absent. No macro history or archive records were fabricated.
2. Growing open interest: merge-by-date preserves omitted vendor rows and
   omitted nested metrics; the offline fixture proves retention and incoming
   precedence. The checked-in cache remains at 28 OI feature rows, so the
   real daily-growth criterion is **not proved**.
3. Missing on-chain data: bounded three-day lookup preserves source dates and
   emits cap reasons; `regimeModel` fixture tests return `insufficient-data`
   and prove omitted-feature score neutrality. A live CoinMetrics-behind visual
   run is **not proved**.
4. Vintage reconstruction: pre- and post-revision fixture reconstruction
   passes, including the `macro-WALCL` archive naming alias. Real committed
   archives and a real revised series are **not present**.
5. Freshness: the cap unit test fails an on-chain source at five days against
   the three-day cap, and the current freshness command exits non-zero on the
   stale required baseline. The workflow receives `${{ secrets.FRED_API_KEY }}`
   and has no deployment step.

## Negative controls

Safe temporary-fixture controls produced the expected red assertions:

- plain assignment failed omitted-key retention;
- the old graph CSV URL failed the `observation_start` assertion;
- the old regime fallback returned `sideways-chop`, not `insufficient-data`;
- wholesale archive rewrite failed prior-byte preservation.

Observed red output, each with exit code 1:

```text
AssertionError [ERR_ASSERTION]: omitted-key retention: plain assignment dropped an existing key
AssertionError [ERR_ASSERTION]: old graph CSV request omitted observation_start (actual null, expected 2010-07-17)
AssertionError [ERR_ASSERTION]: legacy undefined comparisons returned a confident state (actual sideways-chop, expected insufficient-data)
AssertionError [ERR_ASSERTION]: wholesale rewrite changed prior archive bytes
```

## Archive and credential state

Archive evidence is fixture-only. The tests write only under temporary
directories; `src/data/vintages/` has no fabricated records and
`git check-ignore -v src/data/vintages/` exited 1, so future real records will
be commit-visible. `FRED_API_KEY` is absent from the local environment and
`gh secret list` returned no repository secrets. The exact live unblock is:

```bash
export FRED_API_KEY='real-fred-api-key'
yarn update:macro
```

Then verify the five `macro-*.ndjson` files, macro first dates/row counts, and
the real reconstruction before claiming the 2010/2018/2020/2022 acceptance.
