"""Build agent-readable data from menu-data.js (Python stdlib only)."""
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AI = ROOT / "ai"
BASE = "https://fahremback.github.io/kipeixe-site/"


def slug(text):
    ascii_text = "".join(ch for ch in unicodedata.normalize("NFKD", text) if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")


def money(value):
    return "sob consulta" if value is None else f"R$ {value:.2f}".replace(".", ",")


def main():
    data = (ROOT / "menu-data.js").read_text(encoding="utf-8-sig").strip()
    prefix = "window.KIPEIXE_MENU = "
    if not data.startswith(prefix):
        raise ValueError("Formato inesperado de menu-data.js")
    original = json.loads(data[len(prefix):].rstrip("; \r\n"))
    business = json.loads((AI / "business.json").read_text(encoding="utf-8"))
    used = set()
    sections = []
    for section in original:
        items = []
        for item in section["items"]:
            identity = slug("-".join([section["id"], item["name"], item.get("description", "")]))
            if identity in used:
                raise ValueError(f"ID duplicado: {identity}")
            used.add(identity)
            variants = [{"name": v["label"], "price": v["price"], "currency": "BRL"} for v in item.get("variants", [])]
            items.append({
                "id": identity, "name": item["name"], "description": item.get("description", ""),
                "category_id": section["id"], "category": section["title"],
                "price": item["price"], "currency": "BRL", "variants": variants,
                "price_on_request": item["price"] is None and not variants,
            })
        sections.append({"id": section["id"], "name": section["title"], "description": section.get("eyebrow", ""), "items": items})
    total = sum(len(s["items"]) for s in sections)
    catalog = {
        "schema_version": "1.0", "source": "menu-data.js", "website": BASE,
        "menu_url": business["menu_url"], "currency": "BRL",
        "total_items": total, "total_categories": len(sections),
        "categories": sections, "ordering": business["ordering"],
    }
    (AI / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = ["# Cardápio do Kipeixe", "", f"Fonte: {business['menu_url']}", "", "Preços em BRL. Valores não informados: sob consulta.", ""]
    for section in sections:
        lines += [f"## {section['name']}", ""]
        for item in section["items"]:
            prices = "; ".join(f"{v['name']}: {money(v['price'])}" for v in item["variants"]) if item["variants"] else money(item["price"])
            description = " — " + item["description"] if item["description"] else ""
            lines.append(f"- **{item['name']}** — {prices}{description}")
        lines.append("")
    (AI / "cardapio.md").write_text("\n".join(lines).rstrip("\n") + "\n", encoding="utf-8")

    addr = business["address"]
    info = [
        "# Pesque e Pague Kipeixe — informações oficiais", "", business["description"], "",
        "## Estabelecimento", "",
        f"- Endereço: {addr['street']}, {addr['neighborhood']}, {addr['city']}/{addr['state']}, CEP {addr['postal_code']}, Brasil",
        f"- Telefone: {business['telephone']}", f"- WhatsApp: {business['whatsapp']}",
        f"- Instagram: {business['instagram']}", f"- Localização: {business['maps']}",
        f"- Horário: diariamente das {business['hours']['opens']} às {business['hours']['closes']} ({business['hours']['timezone']})",
        "", "## Serviços", "", *[f"- {s}" for s in business["services"]], "",
        "## Pedidos e confirmação", "", business["ordering"]["how"],
        f"- Área de entrega: {business['ordering']['delivery_area']}",
        f"- Taxa de entrega: {business['ordering']['delivery_fee']}",
        f"- Disponibilidade: {business['ordering']['availability']}",
        "- Não há confirmação automática de pedidos pelo site ou pela IA.", "",
        *lines,
    ]
    (ROOT / "llms-full.txt").write_text("\n".join(info).rstrip("\n") + "\n", encoding="utf-8")
    (ROOT / "llms.txt").write_text("\n".join([
        "# Pesque e Pague Kipeixe", "", "> " + business["description"], "",
        "Dados oficiais da casa, publicados com preços em BRL. Para confirmar entrega, disponibilidade e pedido, contate o WhatsApp.", "",
        "## Informações e cardápio",
        f"- [Estabelecimento]({BASE}ai/business.json): endereço, horário, contatos e serviços.",
        f"- [Cardápio em JSON]({BASE}ai/catalog.json): os {total} produtos com preços, variações e descrições.",
        f"- [Cardápio em Markdown]({BASE}ai/cardapio.md): menu legível integral.",
        f"- [Informações completas]({BASE}llms-full.txt): empresa e todos os pratos.",
        f"- [Schema.org]({BASE}ai/restaurant-schema.json): restaurante, menu, categorias e ofertas.",
        f"- [Pedidos no site]({BASE}#cardapio): pedidos iniciados pelo usuário e confirmados via WhatsApp.", "",
        "## Agentes", "Ferramentas WebMCP disponíveis quando a página está aberta em navegador compatível. Não é um servidor MCP HTTP.", "",
    ]).rstrip("\n") + "\n", encoding="utf-8")

    schema = {
        "@context": "https://schema.org", "@type": "Restaurant", "@id": BASE + "#restaurant",
        "name": business["name"], "description": business["description"], "url": BASE,
        "telephone": business["telephone"], "image": BASE + "assets/logo.webp",
        "servesCuisine": ["Brasileira", "Peixes", "Sul-americana"],
        "address": {
            "@type": "PostalAddress", "streetAddress": addr["street"], "addressLocality": addr["city"],
            "addressRegion": addr["state"], "postalCode": addr["postal_code"], "addressCountry": addr["country"],
        },
        "openingHoursSpecification": [{
            "@type": "OpeningHoursSpecification", "dayOfWeek": [
                "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"
            ], "opens": business["hours"]["opens"], "closes": business["hours"]["closes"],
        }],
        "sameAs": [business["instagram"]], "hasMap": business["maps"],
        "hasMenu": {"@type": "Menu", "@id": BASE + "#menu", "name": "Cardápio Kipeixe",
                    "url": business["menu_url"], "inLanguage": "pt-BR", "hasMenuSection": []},
    }
    for section in sections:
        menu_section = {"@type": "MenuSection", "name": section["name"], "hasMenuItem": []}
        for item in section["items"]:
            entry = {"@type": "MenuItem", "@id": BASE + "ai/catalog.json#" + item["id"],
                     "name": item["name"], "url": business["menu_url"]}
            if item["description"]:
                entry["description"] = item["description"]
            offers = []
            if item["price"] is not None:
                offers.append({"@type": "Offer", "price": item["price"], "priceCurrency": "BRL"})
            for variant in item["variants"]:
                offers.append({"@type": "Offer", "name": variant["name"],
                               "price": variant["price"], "priceCurrency": "BRL"})
            if offers:
                entry["offers"] = offers
            menu_section["hasMenuItem"].append(entry)
        schema["hasMenu"]["hasMenuSection"].append(menu_section)
    (AI / "restaurant-schema.json").write_text(json.dumps(schema, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # Inline JSON-LD is visible to crawlers even if the website's JS does not run.
    html_file = ROOT / "index.html"
    html = html_file.read_text(encoding="utf-8")
    start, end = "<!-- GENERATED_RESTAURANT_JSON_LD_START -->", "<!-- GENERATED_RESTAURANT_JSON_LD_END -->"
    if start not in html or end not in html:
        raise ValueError("index.html missing the generated JSON-LD markers")
    encoded = json.dumps(schema, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    replacement = start + '\n    <script type="application/ld+json">' + encoded + "</script>\n    " + end
    html = re.sub(re.escape(start) + ".*?" + re.escape(end), lambda _: replacement, html, flags=re.S)
    html_file.write_text(html, encoding="utf-8")

    (ROOT / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"  <url><loc>{BASE}</loc></url>\n</urlset>\n", encoding="utf-8")
    # On a GitHub Pages project path, robots.txt is not the origin-wide robots.txt.
    (ROOT / "robots.txt").write_text("User-agent: *\nAllow: /kipeixe-site/\n"
        f"Sitemap: {BASE}sitemap.xml\n", encoding="utf-8")
    print(f"Generated {total} products / {len(sections)} categories, structured data and agent guides.")


if __name__ == "__main__":
    main()
