"""Browser regression for automatic sales fallback.

All payment requests are intercepted. No real orders or payments are created.
"""
import json
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ORDER_ID = '01234567-89ab-4cde-8f01-234567890abc'


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.mjs': 'text/javascript'}

    def log_message(self, *_args):
        pass


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    config = {
        'orderChannel': 'asaas', 'onlinePaymentEnabled': True,
        'pixReady': False, 'paymentMode': 'production',
        'sandbox': False, 'acceptsOrders': True,
        'whatsappNumber': '554535772363', 'deliveryEnabled': True,
        'manualDeliveryViaWhatsapp': True,
        'openingHours': {str(i): {'open': '00:00', 'close': '23:59'} for i in range(7)}
    }
    scenario = {'mode': 'failed', 'orders': []}

    def api(route):
        path = urlparse(route.request.url).path
        if path == '/api/config':
            if scenario['mode'] == 'unreachable':
                route.fulfill(status=503, body='unavailable')
                return
            data, status = config, 200
        elif path == '/api/catalog':
            data, status = {'categories': []}, 200
        elif path == '/api/appearance':
            data, status = {'version': 1, 'global': {}, 'pages': {}, 'elements': {}}, 200
        elif path == '/api/orders' and route.request.method == 'POST':
            scenario['orders'].append(route.request.post_data_json)
            data, status = {
                'orderId': ORDER_ID,
                'paymentStatus': 'REVIEW' if scenario['mode'] == 'review' else 'FAILED',
                'error': 'Asaas HTTP 400: cadastre e ative chave Pix (internal only)'
            }, 502
        elif path.startswith('/api/orders/') and route.request.method == 'GET':
            data, status = {'orderStatus': 'AWAITING_PAYMENT', 'paymentStatus': 'REVIEW'}, 200
        else:
            route.fulfill(status=404, body='unexpected')
            return
        route.fulfill(status=status, content_type='application/json', body=json.dumps(data),
                      headers={'Access-Control-Allow-Origin': origin})

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True,
                executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe')
            for width in (390, 1280):
                for mode in ('failed', 'review', 'offline', 'unreachable'):
                    scenario['mode'] = mode
                    scenario['orders'] = []
                    config['onlinePaymentEnabled'] = mode != 'offline'
                    page = browser.new_page(viewport={'width': width, 'height': 850})
                    errors = []
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.route('http://127.0.0.1:8787/**', api)
                    page.route('https://wa.me/**', lambda route: route.fulfill(
                        status=200, content_type='text/html', body='<title>WhatsApp intercepted</title>'))
                    page.goto(origin + '/#cardapio', wait_until='domcontentloaded')
                    page.get_by_role('button', name='Adicionar Água sem gás ao pedido').click()
                    page.locator('[data-quick-checkout]').click()
                    page.wait_for_function('!document.querySelector("[data-online-checkout]").disabled')
                    assert page.locator('[data-payment-pix-option]').is_hidden()
                    assert 'cadastre e ative' not in page.content()
                    assert page.get_by_text('Combinar pelo WhatsApp').count() == 0
                    assert page.locator('input[name="paymentMethod"]').count() == 2
                    if mode in ('offline', 'unreachable'):
                        assert page.locator('[data-payment-methods]').is_hidden()
                        assert page.locator('[data-online-checkout] strong').inner_text() == 'Enviar pedido pelo WhatsApp'
                    else:
                        assert page.locator('[data-online-checkout] strong').inner_text() == 'Pagar com cartão'
                    page.locator('input[name="name"]').fill('Cliente Continuidade')
                    page.locator('input[name="phone"]').fill('45999998888')
                    page.locator('textarea[name="notes"]').fill('sem cebola')
                    with page.expect_request(lambda req: req.url.startswith('https://wa.me/')) as redirect:
                        page.locator('[data-online-checkout]').click()
                    url = urlparse(redirect.value.url)
                    assert url.path == '/554535772363'
                    message = parse_qs(url.query)['text'][0]
                    assert 'Cliente Continuidade' in message and 'Água sem gás' in message
                    assert 'sem cebola' in message and '*Total dos itens:*' in message
                    assert 'HTTP 400' not in message and 'cadastre e ative' not in message
                    if mode == 'review':
                        assert 'Verifiquem qualquer cobrança' in message and ORDER_ID in message
                    if mode == 'failed':
                        assert 'Pagamento online não concluído' in message
                        assert 'Verifiquem qualquer cobrança' not in message
                    assert len(scenario['orders']) == (1 if mode in ('failed', 'review') else 0)
                    assert not errors, errors
                    print(f'{width}px, {mode}: WhatsApp checkout PASS')
                    page.close()
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()
