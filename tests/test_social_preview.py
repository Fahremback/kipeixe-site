"""Verify Kipeixe's OG/Twitter preview before deploying to GitHub Pages."""
from html.parser import HTMLParser
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://fahremback.github.io/kipeixe-site/"
IMAGE_NAME = "kipeixe-compartilhar-20261012.jpg"
IMAGE_URL = BASE + "assets/" + IMAGE_NAME


class DocumentHead(HTMLParser):
    def __init__(self):
        super().__init__()
        self.meta = {}
        self.in_head = False

    def handle_starttag(self, tag, attrs):
        if tag == "head":
            self.in_head = True
        if tag == "meta" and self.in_head:
            pairs = dict(attrs)
            key = pairs.get("property") or pairs.get("name")
            if key:
                self.meta.setdefault(key, []).append(pairs.get("content", ""))

    def handle_endtag(self, tag):
        if tag == "head":
            self.in_head = False


def check(html, image_path):
    doc = DocumentHead()
    doc.feed(html)
    meta = doc.meta
    for key in (
        "og:type", "og:url", "og:title", "og:description", "og:image",
        "og:image:secure_url", "og:image:width", "og:image:height",
        "og:image:type", "og:image:alt", "twitter:card", "twitter:title",
        "twitter:description", "twitter:image",
    ):
        assert key in meta and len(meta[key]) == 1 and meta[key][0], (key, meta.get(key))

    assert meta["og:type"] == ["website"]
    assert meta["og:url"] == [BASE]
    assert meta["og:image"] == [IMAGE_URL]
    assert meta["og:image:secure_url"] == [IMAGE_URL]
    assert meta["og:image:type"] == ["image/jpeg"]
    assert meta["og:image:width"] == ["1200"]
    assert meta["og:image:height"] == ["630"]
    assert meta["twitter:card"] == ["summary_large_image"]
    assert meta["twitter:image"] == [IMAGE_URL]
    with Image.open(image_path) as image:
        assert image.size == (1200, 630), image.size
        assert image.format == "JPEG", image.format
        assert image.mode == "RGB", image.mode
    assert image_path.stat().st_size <= 450_000
    print("PASS: Open Graph + Twitter metadata, HTTPS URL, JPEG 1200x630 and size.")


if __name__ == "__main__":
    check(
        (ROOT / "index.html").read_text(encoding="utf-8"),
        ROOT / "assets" / IMAGE_NAME,
    )
