"""The public theme must be in place before any visible frame, including on a slow API."""
import json
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
THEME = {
    "version": 1,
    "global": {"header": "#5abdbf", "cart": "#4d9d94", "cartButton": "#28583a"},
    "pages": {"cardapio": {"accent": "#326489"}},
    "elements": {},
}


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript"}

    def log_message(self, *args):
        pass


FRAMES = """
(() => {
  window.__themeFrames = [];
  function sample() {
    if (document.body) {
      const header = document.querySelector('.site-header');
      if (header) window.__themeFrames.push({
        visible: getComputedStyle(document.body).visibility !== 'hidden',
        color: getComputedStyle(header).backgroundColor,
        ready: !document.documentElement.hasAttribute('data-appearance-loading')
      });
    }
    if (window.__themeFrames.length < 250) requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
})();
"""


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(ROOT)))
    host, port = server.server_address
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://{host}:{port}"
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=True,
                executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            )
            for width in (390, 1280):
                page = browser.new_page(viewport={"width": width, "height": 844})
                page.add_init_script(FRAMES)

                def intercept(route):
                    path = route.request.url.split("?", 1)[0]
                    if path.endswith("/api/appearance"):
                        time.sleep(1.0)
                        body = THEME
                    elif path.endswith("/api/config"):
                        body = {"orderChannel": "whatsapp", "whatsappNumber": "554535772363",
                                "acceptsOrders": True, "deliveryEnabled": True}
                    elif path.endswith("/api/catalog"):
                        body = {"categories": []}
                    else:
                        route.fulfill(status=404, body="not found")
                        return
                    route.fulfill(status=200, content_type="application/json",
                                  body=json.dumps(body), headers={"Access-Control-Allow-Origin": origin})

                page.route("http://127.0.0.1:8787/**", intercept)
                page.goto(origin + "/#cardapio", wait_until="domcontentloaded")
                page.wait_for_function("""() => !document.documentElement.hasAttribute('data-appearance-loading')
                    && getComputedStyle(document.querySelector('.site-header')).backgroundColor === 'rgb(90, 189, 191)'""")
                frames = page.evaluate("window.__themeFrames")
                assert frames and any(not f["visible"] for f in frames), "Unstyled page was not gated"
                assert any(f["visible"] for f in frames), "Page never became visible"
                assert all(f["color"] == "rgb(90, 189, 191)" for f in frames if f["visible"]), (
                    "Default header color was visible before the saved theme", frames
                )
                assert page.locator('[data-page="cardapio"]').get_attribute("data-theme-active") == ""
                print(f"Theme first paint: {width}px PASS")
                page.close()

            fallback = browser.new_page()
            fallback.route("http://127.0.0.1:8787/api/appearance",
                           lambda route: route.fulfill(status=503, body="unavailable"))
            fallback.goto(origin + "/", wait_until="domcontentloaded")
            fallback.wait_for_function(
                "!document.documentElement.hasAttribute('data-appearance-loading')", timeout=7000
            )
            assert fallback.evaluate("getComputedStyle(document.body).visibility") == "visible"
            print("Theme API failure fallback: PASS")
            browser.close()
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
