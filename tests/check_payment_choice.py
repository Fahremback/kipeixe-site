"""Local checkout regression; all API/payment requests are mocked."""
import json
import re
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

class SilentHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

def run():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(SilentHandler, directory=str(ROOT)))
    host, port = server.server_address
    threading.Thread(target=server.serve_forever, daemon=True).start()
    api_calls = []
    local_origin = f"http://127.0.0.1:{port}"
    cfg = {
        "onlinePaymentEnabled": True, "paymentMode": "production", "sandbox": False,
        "deliveryEnabled": False,
        "openingHours": {str(day): {"open": "00:00", "close": "23:59"} for day in range(7)},
    }
    def intercept(route):
        path = route.request.url.split("?", 1)[0]
        if path.endswith("/api/config"):
            data = cfg
        elif path.endswith("/api/catalog"):
            data = {"categories": []}
        elif path.endswith("/api/orders") and route.request.method == "POST":
            api_calls.append(route.request.post_data_json)
            data = {"orderId": "01234567-89ab-4cde-8f01-234567890abc",
                    "checkoutUrl": "https://asaas.com/checkoutSession/show?id=test-checkout-1234567890",
                    "paymentMode": "production", "totalCents": 600}
        else:
            return route.fulfill(status=404, body="not found")
        route.fulfill(status=200 if not api_calls else 201,
                      headers={"Access-Control-Allow-Origin": local_origin},
                      content_type="application/json", body=json.dumps(data))
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True,
                executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe")
            page = browser.new_page()
            page.route("http://127.0.0.1:8787/**", intercept)
            page.route("https://asaas.com/**", lambda r: r.fulfill(status=200, content_type="text/html",
                body="<title>Checkout Asaas mock</title><p>Teste local</p>"))
            page.goto(local_origin + "/#cardapio", wait_until="domcontentloaded")
            page.get_by_role("button", name="Adicionar Água sem gás ao pedido").click()
            page.locator('[data-quick-checkout]').click()
            page.locator('[data-online-checkout]').wait_for(state="visible")
            page.wait_for_function("!document.querySelector('[data-online-checkout]').disabled")
            assert page.get_by_role("radio", name="Pix").is_checked()
            page.locator(".checkout-payment-option").nth(1).click()
            assert page.get_by_role("radio", name="Cartão de crédito").is_checked()
            assert "Cartão de crédito" in page.locator('[data-online-checkout]').inner_text()
            page.locator('[data-online-checkout]').click()
            assert "Confira os dados" in page.locator('[data-online-status-title]').inner_text()
            assert api_calls == [], "Invalid form unexpectedly sent a real order"
            page.locator('[data-order-form] input[name="name"]').fill("Teste automatizado")
            page.locator('[data-order-form] input[name="phone"]').fill("45999999999")
            page.locator('[data-online-checkout]').click()
            page.wait_for_function("location.hostname === 'asaas.com'")
            assert len(api_calls) == 1
            assert api_calls[0]["paymentMethod"] == "CREDIT_CARD"
            assert api_calls[0]["items"][0]["qty"] == 1
            assert api_calls[0]["expectedTotalCents"] == 600
            browser.close()
    finally:
        server.shutdown()
    print("Checkout UI: payment selection, invalid form alert, and mocked request PASS")

if __name__ == "__main__":
    run()
