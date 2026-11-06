CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  eyebrow TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER,
  variants_json TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id, sort_order);

CREATE TABLE IF NOT EXISTS store_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_limits (
  ip TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, window_start)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  subject TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE orders ADD COLUMN scheduled_for TEXT;
ALTER TABLE orders ADD COLUMN paid_at TEXT;
ALTER TABLE orders ADD COLUMN acceptance_deadline TEXT;
ALTER TABLE orders ADD COLUMN closed_reason TEXT;
ALTER TABLE orders ADD COLUMN refund_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED';
ALTER TABLE orders ADD COLUMN payment_id TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_deadline ON orders(fulfillment_status, acceptance_deadline);

INSERT OR IGNORE INTO store_settings(key, value) VALUES
  ('orders_enabled', 'true'),
  ('delivery_enabled', 'false'),
  ('delivery_fee_cents', '0'),
  ('opening_hours', '{"0":{"open":"09:00","close":"23:40"},"1":{"open":"09:00","close":"23:40"},"2":{"open":"09:00","close":"23:40"},"3":{"open":"09:00","close":"23:40"},"4":{"open":"09:00","close":"23:40"},"5":{"open":"09:00","close":"23:40"},"6":{"open":"09:00","close":"23:40"}}');
