-- iFood Entrega Fácil / Shipping. Disabled until merchant onboarding and credentials.
INSERT OR IGNORE INTO store_settings(key,value) VALUES ('ifood_enabled','false');
INSERT OR IGNORE INTO store_settings(key,value) VALUES ('delivery_provider','uber');

CREATE TABLE IF NOT EXISTS ifood_quotes (
  id TEXT PRIMARY KEY,
  external_quote_id TEXT NOT NULL,
  address_json TEXT NOT NULL,
  fee_cents INTEGER NOT NULL CHECK(fee_cents >= 0 AND fee_cents <= 30000),
  expires_at TEXT NOT NULL,
  order_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ifood_quotes_expiry ON ifood_quotes(expires_at);

ALTER TABLE orders ADD COLUMN delivery_provider TEXT;
ALTER TABLE orders ADD COLUMN ifood_quote_id TEXT;
ALTER TABLE orders ADD COLUMN ifood_address_json TEXT;
ALTER TABLE orders ADD COLUMN ifood_order_id TEXT;
ALTER TABLE orders ADD COLUMN ifood_status TEXT;
ALTER TABLE orders ADD COLUMN ifood_tracking_url TEXT;
ALTER TABLE orders ADD COLUMN ifood_dispatch_error TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ifood_order_id ON orders(ifood_order_id);
