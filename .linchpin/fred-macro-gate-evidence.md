# FRED macro experiment gate evidence

## Gate Evidence

| Gate | Result | Observed-red evidence | Exact command/result |
|---|---|---|---|
| fred-key | PASS | RED observed: missing FRED_API_KEY; exit 1 | `command: node --input-type=module -e "import('./scripts/lib/fredApi.mjs').then(({requireFredApiKey}) => requireFredApiKey(''))"`; result: RED observed: missing FRED_API_KEY; exit: 1 |
| fred-history | PASS | RED observed: the deliberately altered URL is missing observation_start; exit 1 | `command: node --input-type=module -e "import('./scripts/lib/fredApi.mjs').then(({fredObservationUrl}) => { if (!fredObservationUrl('WALCL', 'key').replace('observation_start=2010-07-17', '').includes('observation_start=2010-07-17')) throw new Error('missing observation_start') })"`; result: RED observed: the deliberately altered URL is missing observation_start; exit: 1 |
| point-in-time | PASS | RED observed: the future row was correctly excluded and the inverted assertion failed; exit 1 | `command: node --import tsx/esm --input-type=module -e "import('./src/lib/fredMacroFeatures.ts').then(({selectLatestAvailableMacroRow}) => { if (!selectLatestAvailableMacroRow([{date:'2020-01-01', availableAfter:'2020-01-31T00:00:00.000Z', metrics:{highYieldSpread:1}}], '2020-01-15')) throw new Error('future row was excluded') })"`; result: RED observed: the future row was correctly excluded and the inverted assertion failed; exit: 1 |
| differential | PASS | RED observed: candidate and baseline identities were equal; exit 1 | `command: yarn backtest:fred-macro --self-compare-negative-control`; result: RED observed: candidate and baseline identities were equal; exit: 1 |
| artifacts | PASS | RED observed: deleted report fixture is absent; exit 1 | `command: test -s docs/reports/results/btc-fred-macro-experiments.json.missing`; result: RED observed: deleted report fixture is absent; exit: 1 |
| registration | PASS | RED observed: arm missing from experiments backlog fixture; exit 1 | `command: node -e "if (['stress-interval','liquidity-median','shock-interval'].filter(value=>require('fs').readFileSync('docs/reports/experiments-backlog.md','utf8').replace('stress-interval','').includes(value)).length!==3) process.exit(1)"`; result: RED observed: arm missing from experiments backlog fixture; exit: 1 |
