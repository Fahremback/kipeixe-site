"""Testa links comerciais que preenchem o carrinho sem inventar preços."""

from playwright.sync_api import sync_playwright


ROOT = "http://127.0.0.1:8766/"


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        )
        try:
            context = browser.new_context()
            page = context.new_page()
            page.goto(ROOT + "?produto=porcoes:tilapia&utm_source=meta#cardapio")
            page.locator(".cart-row").wait_for()
            assert page.locator(".cart-row strong").inner_text() == "Tilápia"
            assert "55,00" in page.locator("[data-cart-total]").inner_text()
            assert page.locator("[data-cart-drawer]").get_attribute("aria-hidden") == "false"
            assert "produto=" not in page.url
            assert "utm_source=meta" in page.url
            page.reload()
            page.locator(".cart-row").wait_for()
            assert page.locator(".cart-row .qty-controls span").inner_text() == "1"

            context2 = browser.new_context()
            page2 = context2.new_page()
            page2.goto(ROOT + "?produto=peixes:tilapia-a-milanesa&quantidade=2#cardapio")
            page2.locator(".cart-row").wait_for()
            assert page2.locator(".cart-row strong").inner_text() == "Tilápia à milanesa"
            assert page2.locator(".cart-row .qty-controls span").inner_text() == "2"
            assert "224,00" in page2.locator("[data-cart-total]").inner_text()
            assert "kipeixe_etapa=checkout" not in page2.url, "Link publicitário não é checkout"
            page2.locator("button.icon-button[data-cart-close]").click()
            page2.locator("[data-quick-checkout]").click()
            assert "kipeixe_etapa=checkout" in page2.url, "Checkout exige ação voluntária"
            page2.locator("button.icon-button[data-cart-close]").click()
            assert "kipeixe_etapa=checkout" not in page2.url

            context3 = browser.new_context()
            page3 = context3.new_page()
            page3.goto(ROOT + "?produto=carnes:picanha-completa#cardapio")
            page3.wait_for_load_state("networkidle")
            assert page3.locator(".cart-row").count() == 0
            assert "produto=" not in page3.url
            assert page3.locator("[data-cart-drawer]").get_attribute("aria-hidden") == "true"

            context4 = browser.new_context()
            page4 = context4.new_page()
            page4.goto(ROOT + "?produto=porcoes:tilapia&produto=peixes:tilapia-a-milanesa#cardapio")
            page4.locator(".cart-row").first.wait_for()
            assert page4.locator(".cart-row").count() == 2
            assert "167,00" in page4.locator("[data-cart-total]").inner_text()
            print("PASS: link unitário, quantidade, carrinho, preço, refresh, inválidos e múltiplos itens")
        finally:
            browser.close()


if __name__ == "__main__":
    run()
