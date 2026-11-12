# DRAM valuation and options research

- `model.py` — DRAM ETF fair-value model (revenue x historical-margin DCF for SK hynix, Samsung, Micron; peak-length scenarios weighted 15/70/15; holdings build-up).  Method fixed 2026-11-12 ("v1").
- `log.csv` — one row per run (inputs, outputs, prices).  Appended by the weekday 6:41am ET scheduled task.
- `backtest/` — option-selling backtests (Databento OPRA 3:45pm snapshots).  Raw data is not stored here (licensed; repo is public); rerun `pull_databento.py` with an API key in DATABENTO_API_KEY.
