"""Hosted Asaas return UX: no waiting card, direct payment resume, no duplicate order.

All payment/API requests are mocked; this test never charges a customer.
"""
import json
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ORDER_ID = "2bacfc41-e4d4-41b1-ac98-c66b43c54a95"
CHECKOUT_URL = "https://asaas.com/checkoutSession/show?id=test-seamless-return"


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript"}

    def log_message(self, *_args):
        pass


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    config = {
        "orderChannel": "asaas", "onlinePaymentEnabled": True,
        "paymentMode": "production", "sandbox": False, "pixReady": True,
        "acceptsOrders": True, "deliveryEnabled": False,
        "openingHours": {str(i): {"open": "00:00", "close": "23:59"} for i in range(7)},
    }
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True, executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe"
            )
            for width in (390, 1280):
                page = browser.new_page(viewport={"width": width, "height": 850})
                payment_status = ["PENDING"]
                posted_orders = []
                status_reads = []
                errors = []
                page.on("pageerror", lambda err: errors.append(str(err)))

                def api(route):
                    path = route.request.url.split("?", 1)[0]
                    if path.endswith("/api/config"):
                        data, status = config, 200
                    elif path.endswith("/api/catalog"):
                        data, status = {"categories": []}, 200
                    elif path.endswith("/api/appearance"):
                        data, status = {"version": 1, "global": {}, "pages": {}, "elements": {}}, 200
                    elif path.endswith("/api/orders") and route.request.method == "POST":
                        posted_orders.append(route.request.post_data_json)
                        data, status = {
                            "orderId": ORDER_ID, "checkoutUrl": CHECKOUT_URL,
                            "paymentMethod": "PIX", "paymentMode": "production",
                            "totalCents": 600,
                        }, 201
                    elif path.endswith("/api/orders/" + ORDER_ID) and route.request.method == "GET":
                        status_reads.append(payment_status[0])
                        data, status = {
                            "orderId": ORDER_ID, "paymentStatus": payment_status[0],
                            "orderStatus": "AWAITING_PAYMENT" if payment_status[0] == "PENDING"
                            else "AWAITING_ACCEPTANCE",
                            "checkoutUrl": CHECKOUT_URL, "paymentMethod": "ASAAS_CHECKOUT",
                        }, 200
                    else:
                        route.fulfill(status=404, body="Unexpected API request")
                        return
                    route.fulfill(
                        status=status, content_type="application/json", body=json.dumps(data),
                        headers={"Access-Control-Allow-Origin": origin},
                    )

                page.route("http://127.0.0.1:8787/**", api)
                page.route("https://asaas.com/**", lambda route: route.fulfill(
                    status=200, content_type="text/html",
                    body="<title>Asaas Seguro (mock)</title>",
                ))
                page.goto(origin + "/#cardapio", wait_until="domcontentloaded")
                page.get_by_role("button", name="Adicionar Água sem gás ao pedido").click()
                page.locator("[data-quick-checkout]").click()
                page.wait_for_function("!document.querySelector('[data-online-checkout]').disabled")
                page.locator('input[name="name"]').fill("Comprador teste")
                page.locator('input[name="phone"]').fill("45999999999")
                page.locator("[data-online-checkout]").click()
                page.wait_for_function("location.hostname === 'asaas.com'")
                assert len(posted_orders) == 1

                # Asaas redirects to the site before the webhook has confirmed the charge.
                page.goto(origin + f"/?pedido={ORDER_ID}&retorno=cancelado#cardapio",
                          wait_until="domcontentloaded")
                page.wait_for_function("localStorage.getItem('kipeixe_current_order_v2') !== null")
                page.wait_for_function("document.querySelector('[data-online-checkout]')?.disabled === false")
                page.wait_for_timeout(350)
                assert status_reads, "Order status was not retrieved on return"
                assert page.locator("[data-online-status]").is_hidden()
                assert not page.locator("[data-cart-drawer]").get_attribute("class").endswith("is-open")
                assert page.locator("[data-online-status-link], [data-online-status-refresh]").count() == 0
                assert not page.get_by_text("Aguardando pagamento", exact=True).is_visible()

                # The existing payment is resumed through the main CTA, not duplicated.
                page.locator("[data-quick-checkout]").click()
                page.locator('input[name="name"]').fill("Comprador teste")
                page.locator('input[name="phone"]').fill("45999999999")
                page.locator("[data-online-checkout]").click()
                page.wait_for_function("location.hostname === 'asaas.com'")
                assert len(posted_orders) == 1, "An unnecessary second charge was created"

                payment_status[0] = "PAID"
                page.goto(origin + f"/?pedido={ORDER_ID}&retorno=pagamento#cardapio",
                          wait_until="domcontentloaded")
                page.wait_for_function(
                    "document.querySelector('[data-online-status-title]').textContent.includes('Pagamento')"
                )
                assert page.locator("[data-online-status]").is_visible()
                assert page.locator(".online-order-actions").count() == 0
                assert not page.locator("[data-online-status]").inner_text().lower().startswith(
                    "aguardando pagamento"
                )
                assert not errors, errors
                print(f"Seamless Asaas return, resume and confirmation: {width}px PASS")
                page.close()
            browser.close()
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
