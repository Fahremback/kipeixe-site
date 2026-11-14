"""Verify the real red text and original emblem fit the site header at all sizes."""
import json
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript", ".woff2": "font/woff2"}

    def log_message(self, *_args):
        pass


def validate(page, width):
    page.wait_for_function("""async () => {
        await document.fonts.ready;
        return !document.documentElement.hasAttribute('data-appearance-loading')
            && document.querySelector('.brand img')?.naturalWidth === 250;
    }""", timeout=9000)
    info = page.evaluate("""() => {
      const logo = document.querySelector('.brand img');
      const name = document.querySelector('.brand strong');
      const brand = document.querySelector('.brand');
      const button = document.querySelector('.header-order');
      const rect = el => el.getBoundingClientRect().toJSON();
      return {
        name: name.textContent.trim(), font: getComputedStyle(name).fontFamily,
        color: getComputedStyle(name).color, fontLoaded: document.fonts.check('24px KipeixeMarca'),
        logoWidth: logo.naturalWidth, logoHeight: logo.naturalHeight,
        logo: rect(logo), nameBox: rect(name), brand: rect(brand), cart: rect(button)
      };
    }""")
    assert info["name"] == "KIPEIXE", info
    assert "KipeixeMarca" in info["font"] and info["fontLoaded"], info
    assert info["color"] == "rgb(239, 8, 29)", info
    assert (info["logoWidth"], info["logoHeight"]) == (250, 287), info
    assert info["logo"]["right"] + 1 < info["nameBox"]["left"], info
    assert info["nameBox"]["right"] <= info["brand"]["right"] + 1, info
    assert info["brand"]["right"] + 2 < info["cart"]["left"], info
    assert info["brand"]["right"] < width, info
    print(f"Logo {width}px PASS: icon plus actual red KIPEIXE text (custom font loaded)")


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe")
            for width in (320, 390, 768, 1280):
                page = browser.new_page(viewport={"width": width, "height": 800})

                def api(route):
                    route.fulfill(status=200, content_type="application/json",
                                  body=json.dumps({"version": 1, "global": {}, "pages": {}, "elements": {}}),
                                  headers={"Access-Control-Allow-Origin": f"http://127.0.0.1:{server.server_port}"})

                page.route("http://127.0.0.1:8787/api/appearance", api)
                page.goto(f"http://127.0.0.1:{server.server_port}/", wait_until="domcontentloaded")
                validate(page, width)
                page.close()
            browser.close()
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
