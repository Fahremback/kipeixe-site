"""Debit checkout UI: Asaas invoice, CPF field, credit/Pix regressions.

All API/Asaas calls are intercepted. No real charge is created.
"""
import json
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    config = {
        'orderChannel': 'asaas', 'onlinePaymentEnabled': True, 'paymentMode': 'production',
        'pixReady': True, 'deliveryEnabled': False, 'acceptsOrders': True, 'sandbox': False,
        'openingHours': {str(i): {'open': '00:00', 'close': '23:59'} for i in range(7)},
    }
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True,
                executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe')
            for width in (390, 1280):
                orders = []
                page = browser.new_page(viewport={'width': width, 'height': 850})
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))

                def api(route):
                    path = route.request.url.split('?', 1)[0]
                    if path.endswith('/api/config'):
                        data, status = config, 200
                    elif path.endswith('/api/catalog'):
                        data, status = {'categories': []}, 200
                    elif path.endswith('/api/appearance'):
                        data, status = {'version': 1, 'global': {}, 'pages': {}, 'elements': {}}, 200
                    elif path.endswith('/api/orders') and route.request.method == 'POST':
                        orders.append(route.request.post_data_json)
                        data, status = {
                            'orderId': '01234567-89ab-4cde-8f01-234567890abc',
                            'paymentMethod': 'DEBIT_CARD',
                            'checkoutUrl': 'https://www.asaas.com/i/123456789012345',
                            'totalCents': 2300,
                            'paymentMode': 'production',
                        }, 201
                    else:
                        route.fulfill(status=404, body='Unexpected API route')
                        return
                    route.fulfill(status=status, content_type='application/json', body=json.dumps(data),
                        headers={'Access-Control-Allow-Origin': origin})

                page.route('http://127.0.0.1:8787/**', api)
                page.route('https://www.asaas.com/**', lambda route: route.fulfill(
                    status=200, content_type='text/html', body='<title>Asaas invoice mock</title>'))
                page.goto(origin + '/#cardapio', wait_until='domcontentloaded')
                page.get_by_role('button', name='Adicionar Água sem gás ao pedido').click()
                page.locator('[data-quick-checkout]').click()
                page.wait_for_function('!document.querySelector("[data-online-checkout]").disabled')
                assert page.locator('input[name="paymentMethod"]').count() == 3
                assert page.locator('[data-debit-document]').is_hidden()
                page.locator('.checkout-payment-debit').click()
                assert page.locator('[data-debit-document]').is_visible()
                assert page.locator('[data-online-checkout] strong').inner_text() == 'Pagar com débito'
                page.locator('input[name="name"]').fill('Teste sem cobrança')
                page.locator('input[name="phone"]').fill('45999999999')
                page.locator('[data-online-checkout]').click()
                assert len(orders) == 0
                page.locator('input[name="cpfCnpj"]').fill('11111111111')
                page.locator('[data-online-checkout]').click()
                assert len(orders) == 0
                assert page.locator('[data-debit-document-error]').is_visible()
                page.locator('input[name="cpfCnpj"]').fill('52998224725')
                page.locator('[data-online-checkout]').click()
                page.wait_for_function("location.hostname === 'www.asaas.com'", timeout=15000)
                assert len(orders) == 1 and orders[0]['paymentMethod'] == 'DEBIT_CARD'
                assert orders[0]['cpfCnpj'] == '52998224725'
                assert not errors, errors
                print(f'Debit CPF, invoice redirection and form: {width}px PASS')
                page.close()
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()
