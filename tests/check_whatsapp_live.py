"""Safe smoke test for public WhatsApp checkout; intercepts the outgoing WhatsApp link."""
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        )
        for width in (390, 1280):
            page = browser.new_page(viewport={"width": width, "height": 844})
            submitted_orders = []
            page.on("request", lambda request: submitted_orders.append(request.url)
                    if "/api/orders" in request.url else None)
            page.route("https://wa.me/**", lambda route: route.fulfill(
                status=200, content_type="text/html", body="<title>WhatsApp intercepted</title>"))
            page.goto("https://restaurantekipeixe.com.br/#cardapio", wait_until="domcontentloaded")
            page.get_by_role("button", name="Adicionar Água sem gás ao pedido").click()
            page.locator("[data-quick-checkout]").click()
            page.wait_for_function("!document.querySelector('[data-online-checkout]').disabled")
            assert page.locator("[data-online-checkout] strong").inner_text() == "Enviar pedido pelo WhatsApp"
            assert page.locator("[data-payment-methods]").is_hidden()
            page.locator('[data-order-form] input[name="name"]').fill("Verificação de interface")
            page.locator('[data-order-form] input[name="phone"]').fill("45999998888")
            delivery = page.locator('[data-order-choice="Entrega"]')
            assert delivery.is_visible(), "A opção Entrega não aparece no checkout"
            delivery.click()
            assert page.locator('[data-address-field]').is_visible()
            assert page.locator('[data-delivery-quote]').is_hidden()
            page.locator('[data-online-checkout]').click()
            assert page.locator('[data-address-error]').is_visible(), "Endereço deve ser obrigatório"
            address = "Rua Teste, 123, Três Lagoas, Foz do Iguaçu"
            page.locator('[data-order-form] input[name="address"]').fill(address)
            with page.expect_request(lambda req: req.url.startswith("https://wa.me/")) as attempt:
                page.locator("[data-online-checkout]").click()
            link = urlparse(attempt.value.url)
            assert link.path == "/554535772363", link.path
            message = parse_qs(link.query)["text"][0]
            assert "Água sem gás" in message
            assert "*Recebimento:* Entrega" in message
            assert f"*Endereço:* {address}" in message
            assert "*Taxa de entrega:* a confirmar" in message
            assert not submitted_orders, submitted_orders
            print(f"Production delivery checkout: {width}px OK")
            page.close()
        browser.close()


if __name__ == "__main__":
    main()
