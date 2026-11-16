"""Check that Kipeixe menu photos are backed by verified user-owned image files."""
from pathlib import Path
import json
import re
import unicodedata

ROOT = Path(__file__).resolve().parents[1]

def normalize(value):
    return ''.join(ch for ch in unicodedata.normalize('NFD', value)
                   if unicodedata.category(ch) != 'Mn').lower().strip()

catalog = json.loads((ROOT / 'menu-data.js').read_text(encoding='utf-8')
                     .split('=', 1)[1].strip().rstrip(';'))
products = {f"{c['id']}|{normalize(i['name'])}"
            for c in catalog for i in c['items']}
source = (ROOT / 'product-images.js').read_text(encoding='utf-8')
match = re.search(
    r'window\.KIPEIXE_PRODUCT_PHOTOS\s*=\s*Object\.freeze\((\{.*\})\);',
    source, re.S
)
assert match, 'Missing product image mapping'
index = json.loads(match.group(1))
assert len(index) >= 40, 'Photo mapping unexpectedly lost too many linked items'
assert set(index).issubset(products), 'Photo mapping references a missing menu item'
assert all('/online/' not in value for value in index.values()), \
    'Unlinked online photo was put back into the menu'

for product, path in index.items():
    assert path.startswith('assets/produtos/kipeixe/'), (product, path)
    asset = ROOT / path
    assert asset.is_file(), f'Missing image {product}: {asset}'
    with asset.open('rb') as fp:
        signature = fp.read(12)
    assert signature[:4] == b'RIFF' and signature[8:] == b'WEBP', asset

# These photos come from the 05-Nov generator autosave and are linked by exact code.
for key, code in {
    'peixes|tilapia grelhada': '200',
    'peixes|tilapia a milanesa': '199',
    'peixes|tilapia a parmegiana': '201',
    'peixes|sashimi completo': '214',
    'peixes|tilapia a vinagrete': '215',
    'carnes|file mignon a parmegiana': '239',
    'frango|frango a passarinho': '245',
    'frango|espaguete a bolonhesa': '263',
    'porcoes|tilapia': '144',
    'porcoes|picanha': '141',
    'porcoes|calabresa': '129',
    'porcoes|feijao': '137',
    'porcoes|lambari': '019',
    'lanches|x-burguer': '269',
    'bebidas|heineken': '15',
    'sucos|maracuja': '58',
    'vinhos|jarra de vinho': '99',
}.items():
    assert index[key] == f'assets/produtos/kipeixe/salvo/{code}.webp', key

saved_images = {p.name for p in
    (ROOT / 'assets/produtos/kipeixe/salvo').glob('*.webp')}
referenced = {Path(p).name for p in index.values() if '/salvo/' in p}
assert saved_images == referenced, 'Stale unreferenced autosave images'

# Important: salmon, mixed drinks and soda labels were not linked to photos
# in the saved project, and must remain without illustrations.
for key in (
    'peixes|salmao ao molho fino',
    'peixes|surubi grelhado',
    'peixes|surubi a milanesa',
    'peixes|tilapia a brasileira',
    'porcoes|pacu em postas',
    'porcoes|surubi',
    'porcoes|frango a passarinho',
    'frango|frango a milanesa',
    'carnes|bisteca de porco',
    'bebidas|fanta uva',
    'bebidas|pepsi black',
    'sucos|manga',
    'coqueteis|mojito',
):
    assert key not in index, f'Unverified image returned: {key}'

html = (ROOT / 'index.html').read_text(encoding='utf-8')
assert html.index('src="product-images.js') < html.index('src="script.js')
assert 'product-images.js?v=20261116-comet-autosave' in html
print(f'PASS: {len(index)} source-linked menu photos / {len(products)} products; '
      f'{len(products) - len(index)} unpictured; 0 unrelated stock photos')
