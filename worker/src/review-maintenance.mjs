import { paymentConfig } from './asaas-environments.mjs';

/**
 * Resolve orphaned checkout attempts after even the maximum Asaas checkout
 * lifetime (24h) has passed. They have no provider ID to track. We do not
 * suppress an uncertain payment: production requires a successful, read-only
 * provider search with no payments linked to the external reference.
 */
export async function expireOrphanedPaymentReviews(env, now = new Date()) {
  if (!env.DB) return 0;
  const rows = (await env.DB.prepare(`SELECT id,asaas_environment FROM orders
    WHERE payment_status='REVIEW' AND fulfillment_status='AWAITING_PAYMENT'
      AND refund_status='NOT_REQUIRED' AND checkout_id IS NULL
      AND payment_id IS NULL AND pix_qr_id IS NULL
      AND datetime(created_at) < datetime(?, '-48 hours')
    ORDER BY created_at ASC LIMIT 12`).bind(now.toISOString()).all()).results;
  let resolved = 0;
  for (const row of rows) {
    if (row.asaas_environment !== 'sandbox') {
      try {
        const account = paymentConfig(env, row.asaas_environment);
        if (!account.key) continue;
        const response = await fetch(`${account.url}/payments?externalReference=${encodeURIComponent(row.id)}&limit=10`, {
          headers: { access_token: account.key, Accept: 'application/json', 'User-Agent': 'Kipeixe-Orders/2.1' },
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) continue;
        const result = await response.json();
        if (!Array.isArray(result?.data) || result.data.length > 0) continue;
      } catch (error) {
        console.warn('Orphan checkout reconciliation deferred:', row.id, error?.name);
        continue;
      }
    }
    const updated = await env.DB.prepare(`UPDATE orders SET
      payment_status='EXPIRED', closed_reason='Checkout antigo sem pagamento confirmado',
      updated_at=CURRENT_TIMESTAMP WHERE id=? AND payment_status='REVIEW'
      AND fulfillment_status='AWAITING_PAYMENT' AND refund_status='NOT_REQUIRED'
      AND checkout_id IS NULL AND payment_id IS NULL AND pix_qr_id IS NULL
      AND datetime(created_at) < datetime(?, '-48 hours')`)
      .bind(row.id, now.toISOString()).run();
    if (updated.meta?.changes) {
      resolved++;
      await env.DB.prepare('INSERT INTO audit_log(actor,action,subject,details) VALUES (?,?,?,?)')
        .bind('sistema', 'STALE_PAYMENT_REVIEW_EXPIRED', row.id,
          JSON.stringify({ reason: 'No checkout/payment reference after 48h; provider payment lookup empty',
            environment: row.asaas_environment })).run();
    }
  }
  return resolved;
}
