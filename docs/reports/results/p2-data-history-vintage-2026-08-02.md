PARTIAL

# P2 Data History Recovery and Vintage Archive — implementation evidence

Date: 2026-08-02
Status: `PARTIAL — implementation validated locally; live ALFRED/archive acceptance blocked`

## Command evidence

| Command | Result | Direct output summary |
| --- | --- | --- |
| `yarn test` | PASS | 27 files, 121 tests passed |
| `yarn lint` | PASS | `tsc --noEmit` exited 0 |
| `yarn build` | PASS | Vite transformed 2,112 modules and produced `dist/` |
| `yarn build:features` | PASS | 5,842 rows, `2010-07-18 → 2026-07-15` |
| `yarn validate:features` | FAIL at known OI floor | `Error: feature coverage below minimum: feature=futuresOpenInterestUSD count=28 minimum=30` |
| `yarn check:freshness` | FAIL on stale baseline | `[Freshness] required stale or missing: btc lag=18 cap=3d status=stale; mvrv lag=18 cap=3d status=stale; onchain lag=18 cap=3d status=stale; features lag=18 cap=3d status=stale; voo lag=18 cap=7d status=fresh` |
| `yarn validate:data` | FAIL at known MVRV baseline | `[MVRV validation] FAILED: CoinMetrics mismatch count=5722; first={"date":"2010-11-14","local":{"date":"2010-11-14","mvrv":4.8874,"marketCap":1281896},"upstream":{"date":"2010-11-14","mvrv":4.8874,"marketCap":1281924},"mvrvDiff":0,"marketCapRelDiff":0.000021842168490487735}` |
| `yarn backtest` | PASS | quality and robustness gates pass; report `backtest-2026-08-02T22-41-25-326Z.{json,md}` |
| `env -u FRED_API_KEY yarn update:macro` | BLOCKED as required | `Missing required environment variable FRED_API_KEY for update:macro` |
| `yarn reconstruct:vintage --series WALCL --as-of 2024-03-01` | BLOCKED honestly | `No vintage archive found .../src/data/vintages/WALCL.ndjson` |
| `git diff --check` | PASS | no whitespace errors |
| vintage fixture tests | PASS | discovery parsing, deterministic bounded date selection, explicit realtime windows, source `realtime_start` preservation, append-only bytes, and pre/post-revision reconstruction |
| caller census | PASS | all seven updaters call `mergeByKey` and `appendVintageRecords`; macro calls `requireEnv`; `reconstruct:vintage` is registered and exported |
| workflow/secret inspection | PASS / BLOCKED | workflow wires `${{ secrets.FRED_API_KEY }}` with no deployment step; diff scan found no credentials; local key absent; `gh secret list` returned no rows |
| obsolete-path search | PASS | no `fredgraph` URL or `REQUIRED_MAX_LAG_DAYS` remains |

## P2 acceptance mapping

1. Macro history from 2010: the updater now discovers official ALFRED
   `vintage_dates`, selects a deterministic bounded set spanning
   `2010-07-17` through today, and requests each snapshot with
   `observation_start=2010-07-17`, explicit equal `realtime_start`/
   `realtime_end`, and `api_key`. Offline fixtures prove discovery, date
   selection, URL parameters, and source `realtime_start → observedAt`; real
   row coverage and archive contents are **not proved** because `FRED_API_KEY`
   is absent. No macro history or archive records were fabricated.
2. Growing open interest: merge-by-date preserves omitted vendor rows and
   omitted nested metrics; the offline fixture proves retention and incoming
   precedence. The checked-in cache remains at 28 OI feature rows, so the
   real daily-growth criterion is **not proved**.
3. Missing on-chain data: bounded three-day lookup preserves source dates and
   emits cap reasons; `regimeModel` tests return `insufficient-data` at exactly
   40% unavailable inputs with probability 1 and prove omitted-feature score
   neutrality below the threshold. A live CoinMetrics-behind visual run is
   **not proved**.
4. Vintage reconstruction: pre- and post-revision fixture reconstruction
   passes, including the `macro-WALCL` archive naming alias. Real committed
   archives and a real revised series are **not present**.
5. Freshness: the cap unit test fails an on-chain source at five days against
   the three-day cap, and the current freshness command exits non-zero on the
   stale required baseline. The workflow receives `${{ secrets.FRED_API_KEY }}`
   and has no deployment step.

## Sol finding repair mapping

1. Historical ALFRED acquisition: `scripts/update-macro-data.mjs` now performs
   vintage-date discovery and bounded historical requests instead of only the
   current `realtime_start`. `scriptGuards.test.ts` directly proves the offline
   request and parsing contract. Live retrieval remains blocked by the absent
   real credential.
2. Exact 40% regime boundary: `src/lib/regimeModel.ts` now uses an inclusive
   `>= 0.4` boundary. `regimeModel.test.ts` removes exactly
   `mvrvPercentile`, `mvrvLevel`, `realizedPriceDistance`, and `hashRate`, and
   proves `topState=insufficient-data` with probability 1.

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
`gh secret list` returned no repository secrets. `requireEnv` requires a
non-empty real registered FRED API key; the official API documentation
specifies a 32-character key. The exact live unblock is:

```bash
export FRED_API_KEY='<real-registered-32-character-fred-api-key>'
yarn update:macro
```

Then verify the five `macro-*.ndjson` files, macro first dates/row counts,
`yarn reconstruct:vintage --series WALCL --as-of 2024-03-01`, and the real
revised-series result before claiming the 2010/2018/2020/2022 acceptance.
