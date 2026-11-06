-- Uber Direct is opt-in and remains disabled until the organization is approved.
INSERT OR IGNORE INTO store_settings (key,value) VALUES ('uber_enabled','false');

CREATE TABLE IF NOT EXISTS uber_quotes (
  id TEXT PRIMARY KEY,
  uber_quote_id TEXT NOT NULL,
  address TEXT NOT NULL,
  fee_cents INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  order_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_uber_quotes_expiry ON uber_quotes(expires_at);

ALTER TABLE orders ADD COLUMN uber_quote_id TEXT;
ALTER TABLE orders ADD COLUMN uber_quote_fee_cents INTEGER;
ALTER TABLE orders ADD COLUMN uber_delivery_id TEXT;
ALTER TABLE orders ADD COLUMN uber_status TEXT;
ALTER TABLE orders ADD COLUMN uber_tracking_url TEXT;
ALTER TABLE orders ADD COLUMN uber_dispatch_error TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_uber ON orders(uber_delivery_id);
