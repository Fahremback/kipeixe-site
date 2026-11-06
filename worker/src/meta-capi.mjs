// Kipeixe Meta Conversions API: server-verified events only.
// No sandbox/test payments can create Purchase, and a missing secret disables CAPI.
export const META_PIXEL_ID = '1152743323896193';
const META_API_VERSION = 'v24.0';

const toHex = bytes => [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');

async function sha256(value) {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

/** Build events from server-side evidence, not arbitrary client-supplied event names. */
export async function makeMetaOrderEvent({ name, orderId, amountCents, clientIp, userAgent, phone }) {
  if (!['InitiateCheckout', 'Purchase'].includes(name) ||
      !/^[0-9a-f-]{36}$/i.test(orderId) ||
      !Number.isInteger(amountCents) || amountCents <= 0) {
    throw Error('Invalid Meta server event');
  }

  const user_data = {};
  if (clientIp && /^[\da-f:.]{3,45}$/i.test(clientIp)) user_data.client_ip_address = clientIp;
  if (userAgent && typeof userAgent === 'string') user_data.client_user_agent = userAgent.slice(0, 400);
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length >= 10 && digits.length <= 13) {
    // Brazil numbers are normalized to E.164 before hashing; never send raw phone.
    const e164 = digits.startsWith('55') ? `+${digits}` : `+55${digits}`;
    user_data.ph = [await sha256(e164.replace(/\D/g, ''))];
  }
  if (!Object.keys(user_data).length) throw Error('Meta matching data missing');

  return {
    event_name: name,
    event_time: Math.floor(Date.now() / 1000),
    event_id: `${name}:${orderId}`,
    action_source: 'website',
    event_source_url: 'https://restaurantekipeixe.com.br/#cardapio',
    user_data,
    custom_data: { currency: 'BRL', value: amountCents / 100 },
  };
}

export async function sendMetaOrderEvent(env, options) {
  // Sandbox checkout or payments must never be counted as production conversions.
  if (options.paymentMode !== 'production' || !env.META_CAPI_ACCESS_TOKEN) return false;
  const event = await makeMetaOrderEvent(options);
  const result = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${META_PIXEL_ID}/events`, {
    method: 'POST',
    signal: AbortSignal.timeout(8000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: [event], access_token: env.META_CAPI_ACCESS_TOKEN }),
  });
  if (!result.ok) {
    console.warn(`Meta CAPI event ${event.event_name} failed: HTTP ${result.status}`);
    return false;
  }
  return true;
}
