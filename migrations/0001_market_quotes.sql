CREATE TABLE market_candles (
  asset_id TEXT NOT NULL,
  date TEXT NOT NULL,
  open REAL NOT NULL CHECK (open > 0),
  high REAL NOT NULL CHECK (high > 0),
  low REAL NOT NULL CHECK (low > 0),
  close REAL NOT NULL CHECK (close > 0),
  volume REAL NOT NULL CHECK (volume >= 0),
  source TEXT NOT NULL,
  source_timestamp TEXT,
  ingested_at TEXT NOT NULL,
  PRIMARY KEY (asset_id, date),
  CHECK (high >= low AND high >= open AND high >= close AND low <= open AND low <= close)
);

CREATE TABLE refresh_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  trigger_type TEXT NOT NULL,
  status TEXT NOT NULL,
  asset_results_json TEXT NOT NULL,
  error_summary TEXT
);

CREATE INDEX market_candles_asset_date_desc ON market_candles(asset_id, date DESC);
