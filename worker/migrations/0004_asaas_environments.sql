-- Payment environment belongs to each order, not to the store's current mode.
-- Keeps older refunds and webhook notifications routed to the correct account.
ALTER TABLE orders ADD COLUMN asaas_environment TEXT NOT NULL DEFAULT 'sandbox';
INSERT OR IGNORE INTO store_settings (key,value) VALUES
  ('payment_mode','sandbox'),
  ('payments_enabled','false');
CREATE INDEX IF NOT EXISTS idx_orders_asaas_environment ON orders(asaas_environment, payment_status);
