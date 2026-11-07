-- Speed up historical activity lookup without altering existing orders.
CREATE INDEX IF NOT EXISTS idx_audit_order_history
  ON audit_log(subject, id DESC);
CREATE INDEX IF NOT EXISTS idx_orders_history_filters
  ON orders(created_at DESC, payment_status, fulfillment_status);
