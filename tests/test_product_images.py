"""Verify all restaurant menu-photo references resolve to actual WebP assets."""
from pathlib import Path
import json
import re
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
def normalize(text):
    return "".join(ch for ch in unicodedata.normalize("NFD", text)
                   if unicodedata.category(ch) != "Mn").lower().strip()

catalog_source = (ROOT / "menu-data.js").read_text(encoding="utf-8")
catalog = json.loads(catalog_source.split("=", 1)[1].strip().rstrip(";"))
valid = {f"{section['id']}|{normalize(product['name'])}"
         for section in catalog for product in section["items"]}

mapping_source = (ROOT / "product-images.js").read_text(encoding="utf-8")
match = re.search(r"window\.KIPEIXE_PRODUCT_PHOTOS\s*=\s*Object\.freeze\((\{.*\})\);", mapping_source, re.S)
assert match, "Product photo index is not readable"
photo_index = json.loads(match.group(1))

assert len(photo_index) >= 90
assert set(photo_index).issubset(valid), "Mapping contains a nonexistent menu item"

for item, url in photo_index.items():
    assert url.startswith("assets/produtos/"), f"Unexpected image path: {item}: {url}"
    path = ROOT / url
    assert path.is_file(), f"Missing photo: {item} -> {url}"
    with path.open("rb") as file:
        signature = file.read(12)
    assert signature[:4] == b"RIFF" and signature[8:] == b"WEBP", f"Not a WebP file: {url}"

# Don't present a fish from another species as pacu or surubi.
assert "porcoes|pacu em postas" not in photo_index
assert "porcoes|surubi" not in photo_index
for key, filename in {
    "peixes|camarao a milanesa": "camarao-milanesa",
    "peixes|tilapia a parmegiana": "tilapia-parmegiana",
    "porcoes|feijao": "feijao",
    "porcoes|lambari": "lambari",
    "porcoes|tilapia em postas": "tilapia-postas",
}.items():
    assert photo_index[key].endswith(f"/kipeixe/{filename}.webp"), key

assert (ROOT / "index.html").read_text(encoding="utf-8").index('src="product-images.js') < \
       (ROOT / "index.html").read_text(encoding="utf-8").index('src="script.js')
print(f"PASS: {len(photo_index)}/{len(valid)} products have valid photos; {len(valid)-len(photo_index)} neutral placeholders")