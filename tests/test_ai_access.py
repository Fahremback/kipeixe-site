"""Validate static agent data and browser WebMCP without a live MCP service.

Start the website with: python -m http.server 4189
Then run: python tests/test_ai_access.py
"""
import json
import re
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
LOCAL = "http://127.0.0.1:4189/"


def static_checks():
    catalog = json.loads((ROOT / "ai/catalog.json").read_text(encoding="utf-8"))
    business = json.loads((ROOT / "ai/business.json").read_text(encoding="utf-8"))
    schema = json.loads((ROOT / "ai/restaurant-schema.json").read_text(encoding="utf-8"))
    data = (ROOT / "menu-data.js").read_text(encoding="utf-8-sig")
    raw = json.loads(data.removeprefix("window.KIPEIXE_MENU = ").rstrip("; \r\n"))
    original = [p for section in raw for p in section["items"]]
    items = [p for section in catalog["categories"] for p in section["items"]]
    schema_items = [p for section in schema["hasMenu"]["hasMenuSection"] for p in section["hasMenuItem"]]
    assert catalog["total_items"] == len(items) == len(original) == len(schema_items) == 109
    assert catalog["total_categories"] == len(raw) == 10
    assert len({p["id"] for p in items}) == 109
    for source, product in zip(original, items):
        assert source["name"] == product["name"]
        assert source["description"] == product["description"]
        assert source["price"] == product["price"]
        assert [(v["label"], v["price"]) for v in source["variants"]] == [
            (v["name"], v["price"]) for v in product["variants"]]
    assert business["address"]["street"] == "Av. João Ricieri Maran, 1417"
    assert business["hours"]["opens"] == "09:00"
    assert business["hours"]["closes"] == "23:40"
    assert business["ordering"]["confirmation_required"] is True
    wines = [p for p in items if p["category_id"] == "vinhos"]
    assert len(wines) == 10
    beer_names = {"Skol", "Heineken", "Heineken Zero", "Spaten",
                  "Antarctica Original", "Amstel", "Malzbier"}
    beers = [p for p in items if p["name"] in beer_names]
    assert [(p["name"], p["description"], p["price"]) for p in beers] == [("Heineken", "Lata", 10.0)]
    tilapia_portion = next(p for p in items if p["category_id"] == "porcoes" and p["name"] == "Tilápia")
    assert tilapia_portion["price"] == 55.0
    tilapia_structured = next(p for p in schema_items if p["@id"].endswith("#porcoes-tilapia"))
    assert tilapia_structured["offers"][0]["price"] == 55.0
    assert "**Tilápia** — R$ 55,00" in (ROOT / "ai/cardapio.md").read_text(encoding="utf-8")
    picanha = next(p for p in items if p["name"] == "Picanha completa")
    assert picanha["price"] is None and picanha["price_on_request"]
    batata = next(p for p in items if p["name"] == "Batata frita")
    assert [p["price"] for p in batata["variants"]] == [25, 30, 35]
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    scripts = re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, flags=re.S)
    assert len(scripts) == 1
    assert json.loads(scripts[0]) == schema
    for path in ("llms.txt", "llms-full.txt", "ai/catalog.json", "ai/cardapio.md",
                 "ai/business.json", "ai/restaurant-schema.json", "sitemap.xml"):
        assert (ROOT / path).exists()
    assert "Sinfonia de Kipeixe" in (ROOT / "llms-full.txt").read_text(encoding="utf-8")
    print("Static data: PASS - 109 products, 10 categories, 109 JSON-LD MenuItems, prices and variants match.")


def browser_checks():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True, executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe")
        page = browser.new_page()
        errors = []
        requests = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("request", lambda r: requests.append(r.url))
        page.goto(LOCAL, wait_until="networkidle")
        assert page.locator('[data-page="cardapio"]').is_visible()
        assert not any("/webmcp.js" in url for url in requests), "No WebMCP API: do not request WebMCP JS"
        page.close()

        browser_context = browser.new_context()
        browser_context.add_init_script("""
          window.__registeredWebMcp = {};
          Object.defineProperty(Document.prototype, 'modelContext', {
            configurable: true,
            get() { return { registerTool: async (tool) => { window.__registeredWebMcp[tool.name] = tool; } }; }
          });
        """)
        page = browser_context.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(LOCAL, wait_until="networkidle")
        page.wait_for_function("Object.keys(window.__registeredWebMcp || {}).length === 6", timeout=10000)
        result = page.evaluate("""async () => {
          const tools = window.__registeredWebMcp;
          const call = async (name, args) => JSON.parse(await tools[name].execute(args));
          const info = await call('kipeixe_business_info', {});
          const categories = await call('kipeixe_list_categories', {});
          const shrimps = await call('kipeixe_search_menu', {query:'camarão'});
          const noAccent = await call('kipeixe_search_menu', {query:'tilapia'});
          const skol = await call('kipeixe_get_product', {id_or_name:'Skol'});
          const heineken = await call('kipeixe_get_product', {id_or_name:'Heineken'});
          const zero = await call('kipeixe_get_product', {id_or_name:'Heineken Zero'});
          const portion = await call('kipeixe_get_product', {id_or_name:'Batata frita'});
          const wines = await call('kipeixe_get_category', {category_id:'vinhos'});
          const menu = await call('kipeixe_get_full_menu', {});
          return {
            names: Object.keys(tools), readonly: Object.values(tools).every(t => t.annotations.readOnlyHint),
            info, categories, shrimps, noAccent, skol, heineken, zero, portion, wines,
            total: menu.total_items
          };
        }""")
        assert result["readonly"]
        assert result["info"]["telephone"] == "+55 45 3577-2363"
        assert len(result["categories"]["categories"]) == 10
        assert result["categories"]["total_items"] == result["total"] == 109
        assert result["shrimps"]["total_matches"] >= 2
        assert result["noAccent"]["total_matches"] >= 2
        assert result["skol"]["total"] == 0
        assert result["zero"]["total"] == 0
        assert result["heineken"]["total"] == 1
        assert result["heineken"]["results"][0]["price"] == 10
        assert result["portion"]["results"][0]["variants"][0]["price"] == 25
        assert result["wines"]["total"] == 10
        assert not errors, errors
        print("WebMCP: PASS - 6 registered tools, business, categories, accent search, variants and full menu.")
        browser_context.close()
        browser.close()


if __name__ == "__main__":
    static_checks()
    browser_checks()
