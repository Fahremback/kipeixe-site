"""Regressão da entrada comercial do Kipeixe (Playwright).

Execute com o servidor estático em http://127.0.0.1:4187.
"""
from playwright.sync_api import sync_playwright


ROOT = "http://127.0.0.1:4187/"


def check_device(browser, label, width, height):
    page = browser.new_page(viewport={"width": width, "height": height})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(ROOT, wait_until="networkidle")

    assert page.url.endswith("#cardapio"), "URL inicial deve abrir o cardápio"
    assert page.locator('[data-page="cardapio"]').is_visible(), "a entrada deve ser o catálogo"
    assert page.locator('[data-menu-inside]').is_visible(), "não exigir clique para abrir o cardápio"
    assert page.locator('[data-menu-cover]').count() == 0, "capa intermediária deve desaparecer"
    assert page.locator('[data-page-link="cardapio"].is-active').count() >= 1
    assert page.locator('[data-menu-items] .menu-entry').count() == 12
    assert page.locator(".desktop-tabs [data-page-link]").first.get_attribute("data-page-link") == "cardapio"
    assert page.locator(".mobile-tabs [data-page-link]").first.get_attribute("data-page-link") == "cardapio"
    assert page.locator('[data-menu-search]').is_visible()
    assert page.locator('[data-menu-items] img').count() == 0

    page.locator('[data-menu-search]').fill("camarão")
    assert page.locator('[data-menu-items] .menu-entry').count() == 2
    assert "Camarão à milanesa" in page.locator('[data-menu-items]').inner_text()
    page.locator('[data-menu-search]').fill("prato inexistente XYYX")
    assert page.locator('[data-menu-items] .menu-entry').count() == 0
    assert page.locator('[data-menu-no-results]').is_visible()
    page.locator('[data-menu-search-clear]').click()
    assert page.locator('[data-menu-items] .menu-entry').count() == 12

    page.locator('[data-category-index="5"]').click()
    assert "X-Burguer" in page.locator('[data-menu-items]').inner_text()
    page.locator('[data-add-item][data-name="X-Burguer"]').click()
    assert page.locator('[data-quick-checkout]').is_visible()
    assert "18,00" in page.locator('[data-quick-total]').inner_text()
    page.locator('[data-quick-checkout]').click()
    assert page.locator('[data-order-form]').is_visible()
    page.locator('.icon-button[data-cart-close]').click()

    page.goto(ROOT + "#inicio", wait_until="networkidle")
    assert page.locator('[data-page="inicio"]').is_visible(), "página institucional deve permanecer"
    page.locator('[data-page-link="cardapio"]:visible').filter(has_text="Cardápio").first.click()
    assert page.locator('[data-page="cardapio"]').is_visible()
    assert page.locator('[data-menu-inside]').is_visible()

    page.goto(ROOT + "#ambiente", wait_until="networkidle")
    assert page.locator('[data-page="ambiente"]').is_visible()
    assert page.locator('[data-page="ambiente"] img').count() > 0
    page.goto(ROOT + "#pesque", wait_until="networkidle")
    assert page.locator('[data-page="pesque"]').is_visible()
    page.goto(ROOT + "#contato", wait_until="networkidle")
    assert page.locator('[data-page="contato"]').is_visible()
    assert page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth") <= 1
    assert not errors, f"erros JS: {errors}"
    print(f"{label}: PASS (catálogo imediato, busca, carrinho, navegação, responsividade)")
    page.close()


if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        )
        check_device(browser, "small mobile", 320, 720)
        check_device(browser, "mobile", 390, 844)
        check_device(browser, "desktop", 1440, 900)
        browser.close()
