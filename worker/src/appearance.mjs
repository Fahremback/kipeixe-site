import { emptyAppearance, validateAppearance } from '../../appearance-config.mjs';

const key = 'appearance_v1';
export async function getAppearance(env) {
  if (!env.DB) return emptyAppearance();
  const record = await env.DB.prepare('SELECT value FROM store_settings WHERE key = ?').bind(key).first();
  if (!record?.value) return emptyAppearance();
  try { return validateAppearance(JSON.parse(record.value)); }
  catch (error) { console.warn('Invalid stored appearance:',error.message); return emptyAppearance(); }
}
export async function saveAppearance(env, data) {
  const appearance = validateAppearance(data);
  await env.DB.prepare(`INSERT INTO store_settings(key,value) VALUES (?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(key,JSON.stringify(appearance)).run();
  return appearance;
}
