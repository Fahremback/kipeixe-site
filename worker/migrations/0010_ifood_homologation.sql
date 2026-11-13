-- Separate sandbox evidence from real orders and prevent event reprocessing.
CREATE TABLE IF NOT EXISTS ifood_event_log (
  channel TEXT NOT NULL CHECK(channel IN ('test','production')),
  event_id TEXT NOT NULL,
  order_id TEXT,
  event_code TEXT,
  pickup_code TEXT,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(channel,event_id)
);
CREATE INDEX IF NOT EXISTS idx_ifood_event_log_order ON ifood_event_log(channel,order_id);
CREATE TABLE IF NOT EXISTS ifood_poll_state (
  channel TEXT PRIMARY KEY CHECK(channel IN ('test','production')),
  last_poll_ms INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ifood_test_quotes (
  quote_id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  fee_cents INTEGER NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ifood_test_orders (
  order_id TEXT PRIMARY KEY,
  origin TEXT NOT NULL CHECK(origin IN ('inside','outside')),
  pickup_code TEXT,
  tracking_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE orders ADD COLUMN ifood_pickup_code TEXT;
