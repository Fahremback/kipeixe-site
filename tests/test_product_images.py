"""Validate exact user-linked photos and clearly tagged illustrative menu pictures."""
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
def read_frozen(name):
    m = re.search(rf'window\.{re.escape(name)}\s*=\s*Object\.freeze\((\{{.*?\}})\);',
                  source, re.S)
    assert m, f'Missing photo registry {name}'
    return json.loads(m.group(1))

index = read_frozen('KIPEIXE_PRODUCT_PHOTOS')
illustrative = read_frozen('KIPEIXE_ILLUSTRATIVE_PHOTOS')
assert len(products) == 109
assert len(index) == len(products), 'Menu item without a photo'
assert set(index) == products, 'Mapping contains missing, duplicated or extra menu items'

# Strictly retain the 47 original relationships proved by the generator backup.
source_doc = (ROOT / 'assets/produtos/kipeixe/SOURCES.md').read_text(encoding='utf-8')
original = {}
for line in source_doc.splitlines():
    if line.startswith('| ') and 'assets/produtos/' in line:
        pieces = line.removeprefix('| ').removesuffix(' |').split(' | ')
        assert len(pieces) == 3, line
        key, provenance, photo = pieces
        original[key] = photo
assert len(original) == 47, 'Source-owned photos unexpectedly changed'
for key, photo in original.items():
    assert index[key] == photo, f'Original photo replaced: {key}'
    assert key not in illustrative, f'Original photo marked illustrative: {key}'

assert len(illustrative) == 62
assert set(illustrative) == products - set(original)
assert all(v is True for v in illustrative.values())

for key, url in index.items():
    assert url.startswith('assets/produtos/'), (key, url)
    image = ROOT / url
    assert image.is_file(), (key, image)
    with image.open('rb') as file:
        signature = file.read(12)
    assert signature[:4] == b'RIFF' and signature[8:12] == b'WEBP', image

# Explicit examples of generic food, correct branded drinks and original intact photos.
for key, photo in {
    'peixes|salmao ao molho fino': 'assets/produtos/online/salmon.webp',
    'peixes|surubi a milanesa': 'assets/produtos/online/fried-fish-fillets.webp',
    'porcoes|pacu em postas': 'assets/produtos/ilustrativas/postas-de-peixe-generico.webp',
    'porcoes|molho rose': 'assets/produtos/ilustrativas/molho-rose.webp',
    'saladas|palmito': 'assets/produtos/ilustrativas/palmito-na-salada.webp',
    'lanches|x-egg': 'assets/produtos/online/bacon-egg-burger.webp',
    'bebidas|pepsi black': 'assets/produtos/kipeixe/refrigerante-pepsi-black.webp',
    'vinhos|120 santa rita sauvignon blanc':
        'assets/produtos/ilustrativas/vinho-branco-generico.webp',
    'coqueteis|pina colada': 'assets/produtos/online/pina-colada.webp',
}.items():
    assert index[key] == photo, key
    assert key in illustrative

# Visual audit: reject specific mismatches (not only file existence).
corrected = {
    'carnes|bisteca de porco a tropeira': 'bisteca-com-acompanhamentos.webp',
    'frango|frango a milanesa': 'frango-a-milanesa-real.webp',
    'peixes|sinfonia de kipeixe': 'sinfonia-ingredientes.webp',
    'porcoes|banana a milanesa': 'banana-empanada-real.webp',
    'porcoes|file mignon': 'porcao-file-mignon.webp',
    'porcoes|frango a passarinho': 'porcao-frango-a-passarinho.webp',
    'sucos|uva': 'suco-de-uva-sem-alcool.webp',
}
for key, filename in corrected.items():
    assert index[key] == 'assets/produtos/ilustrativas/' + filename, key
    assert key in illustrative, f'Corrected reference must stay labeled illustrative: {key}'
    assert (ROOT / index[key]).stat().st_size < 300_000, key

for key, bad in {
    'porcoes|banana a milanesa': 'fried-banana.webp',
    'sucos|uva': 'grape-juice.webp',
    'porcoes|frango a passarinho': 'fried-chicken.webp',
}.items():
    assert not index[key].endswith(bad), key

credits = (ROOT / 'creditos-fotos.html').read_text(encoding='utf-8')
assert 'href="/creditos-fotos.html"' in (ROOT / 'index.html').read_text(encoding='utf-8')
assert 'creativecommons.org/licenses/by-sa/4.0' in credits
assert 'creativecommons.org/licenses/by-sa/3.0' in credits
for asset in ('banana-empanada-real.webp','suco-de-uva-sem-alcool.webp',
              'frango-a-milanesa-real.webp'):
    assert asset in credits, asset

saved_files = {p.name for p in (ROOT / 'assets/produtos/kipeixe/salvo').glob('*.webp')}
used_saved = {Path(path).name for path in index.values() if '/salvo/' in path}
assert saved_files == used_saved

html = (ROOT / 'index.html').read_text(encoding='utf-8')
script = (ROOT / 'script.js').read_text(encoding='utf-8')
css = (ROOT / 'menu-ordering.css').read_text(encoding='utf-8')
assert html.index('src="product-images.js') < html.index('src="script.js')
assert '20261116-matched-photos' in html
assert '20261116-matched-photos' in script
assert 'data-photo-illustrative' in script and 'Imagem ilustrativa' in script
assert '.menu-entry-photo-note' in css

print(f'PASS: {len(index)}/{len(products)} products pictured, '
      f'{len(original)} user-linked originals intact, '
      f'{len(illustrative)} clearly marked illustrations')
