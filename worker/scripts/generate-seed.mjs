import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(resolve(here, '../../ai/catalog.json'), 'utf8'));
const quote = value => value === null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const out = ['-- Generated once from the published menu; later panel edits are preserved.'];
for (const [categoryOrder, category] of catalog.categories.entries()) {
  out.push(`INSERT OR IGNORE INTO categories (id,title,eyebrow,sort_order) VALUES (${quote(category.id)},${quote(category.name)},${quote(category.description || '')},${categoryOrder});`);
  for (const [productOrder, item] of category.items.entries()) {
    const variants = (item.variants || []).map(v => ({
      label: v.label || v.name, priceCents: Math.round(v.price * 100),
    }));
    const priceCents = item.price === null ? 'NULL' : String(Math.round(item.price * 100));
    out.push(`INSERT OR IGNORE INTO products (id,category_id,name,description,price_cents,variants_json,sort_order)
      VALUES (${quote(item.id)},${quote(category.id)},${quote(item.name)},${quote(item.description || '')},${priceCents},${quote(JSON.stringify(variants))},${productOrder});`);
  }
}
writeFileSync(resolve(here, '../migrations/0003_seed_catalog.sql'), out.join('\n') + '\n');
console.log(`Gerado catálogo: ${catalog.categories.length} categorias e ${catalog.categories.reduce((n, c) => n + c.items.length, 0)} produtos.`);
