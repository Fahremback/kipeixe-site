"""Regressão do catálogo horizontal do Kipeixe, sem pedidos ou pagamentos reais.

Execute: python tests/test_horizontal_menu.py
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class StaticHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *_args):
        pass


def run():
    server = ThreadingHTTPServer(("127.0.0.1", 0), StaticHandler)
    Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_port}/"

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        )
        for label, width, height in (
            ("desktop", 1366, 768),
            ("mobile", 390, 844),
            ("small-mobile", 320, 720),
        ):
            context = browser.new_context(
                viewport={"width": width, "height": height},
                reduced_motion="reduce",
            )

            # Network isolation: the API must never receive an order from these tests.
            context.route("http://127.0.0.1:8787/**", lambda route: route.fulfill(
                status=503, content_type="application/json",
                headers={"Access-Control-Allow-Origin": url.rstrip("/"),
                         "Access-Control-Allow-Methods": "GET,OPTIONS",
                         "Access-Control-Allow-Headers": "Content-Type"},
                body='{"error":"teste isolado"}',
            ))
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(url + "#cardapio", wait_until="domcontentloaded")
            page.wait_for_function(
                'document.querySelector("[data-menu-items]")?.dataset.menuLayout==="rails"'
            )
            sections = page.locator("[data-category-section]")
            assert sections.count() == 10
            assert sections.nth(0).locator("h3").inner_text() == "Peixes"
            assert sections.nth(1).locator("h3").inner_text() == "Carnes"
            assert sections.nth(0).locator(".menu-entry").count() == 12
            assert sections.nth(1).locator(".menu-entry").count() == 8
            assert page.locator(".menu-category-rail img").count() > 15
            assert page.evaluate(
                "document.documentElement.scrollWidth-document.documentElement.clientWidth"
            ) <= 1, "Rolagem horizontal deve ficar dentro de cada categoria"

            first = sections.nth(0).locator("[data-menu-rail]")
            metrics = first.evaluate("""el => ({
                visible: el.clientWidth, content: el.scrollWidth,
                scroll: el.scrollLeft, overflow: getComputedStyle(el).overflowX
            })""")
            assert metrics["content"] > metrics["visible"] * 1.5
            assert metrics["overflow"] == "auto"
            assert first.evaluate("(el) => el.scrollLeft") == 0
            sections.nth(0).locator("[data-rail-next]").click()
            page.wait_for_function(
                'document.querySelectorAll("[data-menu-rail]")[0].scrollLeft>50'
            )
            assert not sections.nth(0).locator("[data-rail-prev]").is_disabled()
            if label == "desktop":
                current = first.evaluate("(el)=>el.scrollLeft")
                rect = first.bounding_box()
                assert rect is not None
                start_x, start_y = rect["x"] + 280, rect["y"] + 65
                page.mouse.move(start_x, start_y)
                page.mouse.down()
                page.mouse.move(start_x - 95, start_y, steps=8)
                page.mouse.up()
                assert first.evaluate("(el)=>el.scrollLeft") > current + 30

            page.locator('[data-category-index="1"]').click()
            assert sections.nth(1).locator("h3").inner_text() == "Carnes"
            assert page.locator('[data-category-index="1"]').get_attribute("aria-pressed") == "true"
            page.locator('[data-category-index="0"]').click()
            assert first.evaluate("(el)=>el.scrollLeft") > 50
            # Category tabs also follow vertical scrolling through the stacked rails.
            page.evaluate("""() => document.querySelectorAll('[data-category-section]')[4]
                .scrollIntoView({behavior:'instant',block:'start'})""")
            page.wait_for_function(
                'document.querySelectorAll("[data-category-index]")[4].getAttribute("aria-pressed")==="true"'
            )
            page.locator('[data-category-index="0"]').click()

            # Search still scans the full menu and can be cleared back to the rails.
            search = page.locator("[data-menu-search]")
            search.fill("camarão")
            assert page.locator('[data-menu-items][data-menu-layout="search"] .menu-entry').count() == 2
            search.fill("produto que nao existe qxq")
            assert page.locator("[data-menu-no-results]").count() == 1
            page.locator("[data-menu-search-clear]").click()
            assert sections.count() == 10

            # The checkout still shows the selected product, with no real API calls.
            sandwich = sections.nth(5).locator('.add-button[data-add-item][data-name="X-Burguer"]')
            sandwich.scroll_into_view_if_needed()
            sandwich.click()
            assert "18,00" in page.locator("[data-quick-total]").inner_text()
            page.locator("[data-quick-checkout]").click()
            assert page.locator("[data-order-form]").is_visible()
            page.locator(".icon-button[data-cart-close]").click()

            # For screenshots, return to the top with the first two category rows visible.
            page.evaluate("window.scrollTo(0,0)")
            page.screenshot(path=str(ROOT / f".horizontal-menu-{label}.png"))
            assert not errors, errors
            print(
                f"{label}: PASS / {metrics['visible']}px viewport rail, "
                f"{metrics['content']}px sideways content, "
                "10 categories, search, cart, arrows, responsive layout"
            )
            context.close()
        browser.close()
    server.shutdown()


if __name__ == "__main__":
    run()
