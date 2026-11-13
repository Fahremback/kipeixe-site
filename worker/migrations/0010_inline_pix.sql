-- QR Codes Pix de uso único, com prazo curto e conciliação por identificador.
-- O código só é entregue ao comprador autenticado pelo token do pedido.
ALTER TABLE orders ADD COLUMN pix_qr_id TEXT;
ALTER TABLE orders ADD COLUMN pix_payload TEXT;
ALTER TABLE orders ADD COLUMN pix_image TEXT;
ALTER TABLE orders ADD COLUMN pix_expires_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_pix_qr_id ON orders(pix_qr_id);
