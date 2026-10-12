"""Cada refrigerante deve ser selecionado por sabor e embalagem no pedido."""
import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = "http://127.0.0.1:4192/"
SABORES = [
    "Coca-Cola", "Coca-Cola Zero", "Guaraná Antarctica",
    "Fanta Laranja", "Fanta Uva", "Schweppes Citrus",
    "Pepsi", "Pepsi Twist", "Pepsi Black",
]


def check_data():
    raw = (ROOT / "menu-data.js").read_text(encoding="utf-8-sig")
    categories = json.loads(raw.removeprefix("window.KIPEIXE_MENU = ").rstrip("; \r\n"))
    drinks = next(category for category in categories if category["id"] == "bebidas")["items"]
    assert not any(item["name"] == "Refrigerantes" for item in drinks)
    for name in SABORES:
        items = [item for item in drinks if item["name"] == name]
        assert len(items) == 1, (name, items)
        item = items[0]
        assert item["price"] is None
        assert [(variant["label"], variant["price"]) for variant in item["variants"]] == [
            ("Garrafa 290 ml", 8.0), ("Lata 350 ml", 8.0)]
    assert len(categories) == 10
    assert sum(len(c["items"]) for c in categories) == 119
    print("Cardápio: PASS - 9 refrigerantes individuais, 2 embalagens cada.")


def check_order():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe")
        for width in (390, 1440):
            page = browser.new_page(viewport={"width": width, "height": 844})
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(BASE, wait_until="networkidle")
            page.locator('[data-category-index="6"]').click()
            for name in SABORES:
                entry = page.locator('.menu-entry').filter(has=page.locator('h4', has_text=name))
                assert entry.count() >= 1, name
                assert page.locator(f'[data-add-item][data-name="{name}"]').count() == 2, name
            page.locator('[data-add-item][data-name="Coca-Cola Zero"][data-variant="Garrafa 290 ml"]').click()
            page.locator('[data-add-item][data-name="Fanta Uva"][data-variant="Lata 350 ml"]').click()
            page.locator('[data-quick-checkout]').click()
            cart = page.locator('[data-cart-items]').inner_text()
            assert "Coca-Cola Zero" in cart and "Garrafa 290 ml" in cart
            assert "Fanta Uva" in cart and "Lata 350 ml" in cart
            assert "16,00" in page.locator('[data-cart-total]').inner_text()
            page.locator('[data-order-form] input[name="name"]').fill("Cliente Teste")
            page.route("https://wa.me/**", lambda route: route.abort())
            with page.expect_request(lambda request: request.url.startswith("https://wa.me/")) as outgoing:
                page.locator('[data-order-form] .whatsapp-button').click()
            message = parse_qs(urlsplit(outgoing.value.url).query)["text"][0]
            assert "1x Coca-Cola Zero (Garrafa 290 ml)" in message
            assert "1x Fanta Uva (Lata 350 ml)" in message
            assert "16,00" in message
            assert not errors, errors
            print(f"{width}px: PASS - sabores e embalagens no carrinho e WhatsApp.")
            page.close()
        browser.close()


if __name__ == "__main__":
    check_data()
    check_order()
