"""Asaas for pickup; manual WhatsApp for delivery, without real charges."""
import json
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript"}

    def log_message(self, *_args):
        pass


def run():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    config = {
        "orderChannel": "asaas", "onlinePaymentEnabled": True,
        "paymentMode": "production", "paymentsConfigured": True,
        "sandbox": False, "acceptsOrders": True,
        "whatsappNumber": "554535772363", "deliveryEnabled": True,
        "manualDeliveryViaWhatsapp": True, "deliveryProvider": "uber",
        "openingHours": {str(d): {"open": "00:00", "close": "23:59"} for d in range(7)},
    }
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True, executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe"
            )
            for width in (390, 1280):
                page = browser.new_page(viewport={"width": width, "height": 850})
                api_orders = []

                def api(route):
                    path = urlparse(route.request.url).path
                    if path == "/api/config":
                        data = config
                    elif path == "/api/catalog":
                        data = {"categories": []}
                    elif path == "/api/appearance":
                        data = {"version": 1, "global": {}, "pages": {}, "elements": {}}
                    else:
                        api_orders.append(route.request.url)
                        route.fulfill(status=409, body="unexpected mock request")
                        return
                    route.fulfill(status=200, content_type="application/json", body=json.dumps(data),
                                  headers={"Access-Control-Allow-Origin": origin})

                page.route("http://127.0.0.1:8787/**", api)
                page.route("https://wa.me/**", lambda route: route.fulfill(
                    status=200, content_type="text/html", body="<title>Not sent</title>"
                ))
                page.goto(origin + "/#cardapio", wait_until="domcontentloaded")
                page.get_by_role("button", name="Adicionar Água sem gás ao pedido").click()
                page.locator("[data-quick-checkout]").click()
                page.wait_for_function(
                    "!document.querySelector('[data-online-checkout]').disabled"
                )
                assert page.locator("[data-online-checkout] strong").inner_text() == "Pagar com Pix"
                assert page.locator("[data-payment-methods]").is_visible()
                assert page.locator('[data-order-choice="Entrega"]').is_visible()
                page.locator('[data-order-choice="Entrega"]').click()
                assert page.locator("[data-online-checkout] strong").inner_text() == "Enviar pedido pelo WhatsApp"
                assert page.locator("[data-payment-methods]").is_hidden()
                assert page.locator("[data-delivery-quote]").is_hidden()
                assert page.locator("[data-address-field]").is_visible()
                page.locator('[data-order-choice="Retirada no Kipeixe"]').click()
                assert page.locator("[data-online-checkout] strong").inner_text() == "Pagar com Pix"
                assert page.locator("[data-payment-methods]").is_visible()
                page.locator('[data-order-choice="Entrega"]').click()
                page.locator('[data-order-form] input[name="name"]').fill("Cliente Teste")
                page.locator('[data-order-form] input[name="phone"]').fill("45999998888")
                address = "Rua Teste, 135, Três Lagoas, Foz do Iguaçu"
                page.locator('[data-order-form] input[name="address"]').fill(address)
                with page.expect_request(lambda req: req.url.startswith("https://wa.me/")) as event:
                    page.locator("[data-online-checkout]").click()
                message = parse_qs(urlparse(event.value.url).query)["text"][0]
                assert address in message and "*Taxa de entrega:* a confirmar" in message
                assert not api_orders, api_orders
                print(f"Hybrid checkout {width}px: Asaas pickup + WhatsApp delivery PASS")
                page.close()
            browser.close()
    finally:
        server.shutdown()


if __name__ == "__main__":
    run()
