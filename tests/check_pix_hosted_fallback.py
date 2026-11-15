"""Ensure Pix without an active QR key visibly continues to Asaas hosted checkout.

The API and Asaas pages are mocked: this test never creates a financial charge.
"""
import json
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript"}

    def log_message(self, *_args):
        pass


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    config = {
        "orderChannel": "asaas", "onlinePaymentEnabled": True, "paymentMode": "production",
        "sandbox": False, "acceptsOrders": True, "deliveryEnabled": False,
        "openingHours": {str(d): {"open": "00:00", "close": "23:59"} for d in range(7)}
    }
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True, executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe"
            )
            for width in (390, 1280):
                page = browser.new_page(viewport={"width": width, "height": 850})
                requests = []
                unwanted_notices = []
                page.on("console", lambda msg: unwanted_notices.append(msg.text)
                        if "UNWANTED_ASAAS_NOTICE" in msg.text else None)

                def api(route):
                    path = route.request.url.split("?", 1)[0]
                    if path.endswith("/api/config"):
                        data, status = config, 200
                    elif path.endswith("/api/catalog"):
                        data, status = {"categories": []}, 200
                    elif path.endswith("/api/appearance"):
                        data, status = {"version": 1, "global": {}, "pages": {}, "elements": {}}, 200
                    elif path.endswith("/api/orders") and route.request.method == "POST":
                        requests.append(route.request.post_data_json)
                        data, status = {
                            "orderId": "01234567-89ab-4cde-8f01-234567890abc",
                            "paymentMethod": "PIX", "paymentMode": "production",
                            "checkoutUrl": "https://asaas.com/checkoutSession/show?id=test-hosted-pix-123456789",
                            "totalCents": 600
                        }, 201
                    elif "/api/orders/" in path and route.request.method == "GET":
                        data, status = {
                            "orderId": "01234567-89ab-4cde-8f01-234567890abc",
                            "orderStatus": "AWAITING_PAYMENT",
                            "paymentStatus": "FAILED",
                            "checkoutUrl": None,
                        }, 200
                    else:
                        route.fulfill(status=404, body="Unexpected API route")
                        return
                    route.fulfill(status=status, content_type="application/json", body=json.dumps(data),
                                  headers={"Access-Control-Allow-Origin": origin})

                page.route("http://127.0.0.1:8787/**", api)
                page.route("https://asaas.com/**", lambda route: route.fulfill(
                    status=200, content_type="text/html", body="<title>Hosted Asaas Pix (mock)</title>"
                ))
                page.goto(origin + "/#cardapio", wait_until="domcontentloaded")
                page.get_by_role("button", name="Adicionar Água sem gás ao pedido").click()
                page.locator("[data-quick-checkout]").click()
                page.wait_for_function("!document.querySelector('[data-online-checkout]').disabled")
                page.locator('[data-online-checkout]').click()
                assert page.locator('[data-online-status]').is_visible()
                assert page.locator('[data-online-status-title]').inner_text() == 'Confira os dados'
                assert page.locator('[data-online-checkout] + [data-online-status]').count() == 1
                assert requests == []
                page.locator('input[name="name"]').fill('Teste sem cobrança')
                page.locator('input[name="phone"]').fill('45999999999')
                # Observe the entire transition, not just the final page:
                # direct Asaas checkout must not expose an intermediate
                # "Abrindo Pix" card or a redundant "Retomar" button.
                page.evaluate("""() => {
                  const box = document.querySelector('[data-online-status]');
                  const title = box.querySelector('[data-online-status-title]');
                  const observe = () => {
                    if (!box.hidden && title.textContent.includes('Abrindo Pix no Asaas'))
                      console.error('UNWANTED_ASAAS_NOTICE');
                  };
                  new MutationObserver(observe).observe(box, {
                    attributes: true, childList: true, subtree: true
                  });
                }""")
                assert page.locator('[data-online-status-link], [data-online-status-refresh]').count() == 0
                page.locator('[data-online-checkout]').click()
                page.wait_for_function("location.hostname === 'asaas.com'")
                assert not unwanted_notices, unwanted_notices
                assert len(requests) == 1 and requests[0]["paymentMethod"] == 'PIX'
                print(f"Pix hosted fallback and visible errors: {width}px PASS")
                page.close()
            # The live Asaas API may report no active Pix key. In that case
            # customers must be guided to card rather than a failing Pix flow.
            config["pixReady"] = False
            page = browser.new_page(viewport={"width": 390, "height": 850})
            page.route("http://127.0.0.1:8787/**", api)
            page.goto(origin + "/#cardapio", wait_until="domcontentloaded")
            page.get_by_role("button", name="Adicionar Água sem gás ao pedido").click()
            page.locator("[data-quick-checkout]").click()
            page.wait_for_function("!document.querySelector('[data-online-checkout]').disabled")
            assert page.locator('input[name="paymentMethod"][value="PIX"]').is_disabled()
            assert page.locator('input[name="paymentMethod"][value="CREDIT_CARD"]').is_checked()
            assert page.locator('[data-payment-pix-option]').is_hidden()
            assert page.locator('input[name="paymentMethod"][value="WHATSAPP"]').count() == 0
            assert 'chave Pix' not in page.content()
            assert page.locator('[data-online-checkout] strong').inner_text() == 'Pagar com cartão'
            print("Missing Asaas Pix key: card selected automatically PASS")
            page.close()

            # A user whose last Asaas attempt definitively failed must be able
            # to retry with a single click, after safely confirming its state.
            page = browser.new_page(viewport={"width": 390, "height": 850})
            page.add_init_script("""localStorage.setItem('kipeixe_current_order_v2', JSON.stringify({
                orderId:'01234567-89ab-4cde-8f01-234567890abc',
                accessToken:'abcde012-3456-4789-abcd-ef1234567890', reviewUnresolved:true
            }));""")
            page.route("http://127.0.0.1:8787/**", api)
            page.route("https://asaas.com/**", lambda route: route.fulfill(
                status=200, content_type="text/html", body="<title>Retry mock</title>"
            ))
            page.goto(origin + "/#cardapio", wait_until="domcontentloaded")
            page.get_by_role("button", name="Adicionar Água sem gás ao pedido").click()
            page.locator("[data-quick-checkout]").click()
            page.wait_for_function("!document.querySelector('[data-online-checkout]').disabled")
            page.locator('input[name="name"]').fill('Retry test')
            page.locator('input[name="phone"]').fill('45999999999')
            previous = len(requests)
            page.locator('[data-online-checkout]').click()
            page.wait_for_function("location.hostname === 'asaas.com'")
            assert len(requests) == previous + 1
            assert requests[-1]["paymentMethod"] == "CREDIT_CARD"
            print("Failed Asaas order: one-click retry PASS")
            page.close()
            browser.close()
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
