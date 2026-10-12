"""Generate Kipeixe's Open Graph / WhatsApp preview from actual site photos.

Run: python scripts/build_share_image.py
Requirements: Pillow. Output is exactly 1200x630 JPEG (sRGB).
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets" / "kipeixe-compartilhar-20261012.jpg"
W, H, SCALE = 1200, 630, 2
CW, CH = W * SCALE, H * SCALE


def color(hex_color, alpha=255):
    h = hex_color.lstrip("#")
    return (int(h[:2], 16), int(h[2:4], 16), int(h[4:], 16), alpha)


def font(name, size):
    return ImageFont.truetype(str(Path("C:/Windows/Fonts") / name), round(size * SCALE))


def text(draw, xy, message, face, fill):
    draw.text((round(xy[0] * SCALE), round(xy[1] * SCALE)), message,
              font=face, fill=fill, stroke_width=0)


def rounded(draw, bounds, radius, fill):
    x0, y0, x1, y1 = bounds
    draw.rounded_rectangle((round(x0*SCALE), round(y0*SCALE),
                            round(x1*SCALE), round(y1*SCALE)),
                           radius=round(radius*SCALE), fill=fill)


def main():
    # The image comes from the real Kipeixe lakeside tables, not stock imagery.
    source = Image.open(ROOT / "assets/ambiente/lago-cheio.webp").convert("RGB")
    photo = ImageOps.fit(source, (CW, CH), method=Image.Resampling.LANCZOS,
                         centering=(0.58, 0.52)).convert("RGBA")

    # Dark brand vignette: text stays readable, restaurant photo stays visible.
    overlay = Image.new("RGBA", (CW, CH))
    px = overlay.load()
    for x in range(CW):
        fraction = x / CW
        base_opacity = round(254 if fraction < 0.32 else
                             254 - min(0.68, (fraction - 0.32) / 0.68) * 214)
        for y in range(CH):
            # Bottom shade protects location label from bright table tops.
            bottom = max(0, (y / CH - 0.74) / 0.26)
            alpha = min(250, round(base_opacity + 45 * bottom))
            px[x, y] = color("#16070c", alpha)
    photo = Image.alpha_composite(photo, overlay)
    draw = ImageDraw.Draw(photo)

    # Thin ornamental edge; aligned with the site's burgundy/coral identity.
    draw.line((72*SCALE, 38*SCALE, 72*SCALE, 591*SCALE),
              fill=color("#ef455e", 255), width=5*SCALE)

    # Extract authentic logo from the site, keeping transparency around its
    # original black canvas and preserving the red fish mark.
    logo_src = Image.open(ROOT / "assets/logo.webp").convert("RGB")
    crop = logo_src.crop((68, 27, 444, 300))
    cropped = crop.resize((160*SCALE, 112*SCALE), Image.Resampling.LANCZOS)
    logo = Image.new("RGBA", cropped.size)
    logo_pixels = logo.load()
    rgb = cropped.load()
    for y in range(cropped.height):
        for x in range(cropped.width):
            r, g, b = rgb[x, y]
            logo_pixels[x, y] = (r, g, b, max(0, min(255, int((max(r, g, b) - 12) * 2.0))))
    photo.alpha_composite(logo, (99*SCALE, 42*SCALE))
    draw = ImageDraw.Draw(photo)

    text(draw, (267, 72), "KIPEIXE", font("ariblk.ttf", 54), "#ffffff")
    text(draw, (269, 141), "RESTAURANTE & PESQUE-PAGUE", font("arialbd.ttf", 18), "#fb7c90")

    # Principal promise appears large enough in a thumbnail.
    text(draw, (101, 252), "Cardápio", font("cambriab.ttf", 87), "#ffffff")
    text(draw, (105, 360), "Peixe na mesa. O dia inteiro.", font("cambriab.ttf", 39), "#ffffff")
    text(draw, (106, 422), "Confira os pratos e monte seu pedido.", font("arial.ttf", 25), "#f9e6e9")

    # High-contrast action chip: visible even in WhatsApp's small preview.
    rounded(draw, (101, 497, 425, 558), 18, "#e63855")
    text(draw, (125, 511), "VER CARDÁPIO  →", font("arialbd.ttf", 24), "#ffffff")
    text(draw, (778, 575), "TRÊS LAGOAS  •  FOZ DO IGUAÇU",
         font("arialbd.ttf", 16), "#ffffff")

    image = photo.convert("RGB").resize((W, H), Image.Resampling.LANCZOS)
    image.save(OUTPUT, format="JPEG", quality=88, subsampling=0, optimize=True,
               dpi=(72, 72))
    print(f"{OUTPUT} — {image.width}x{image.height}, {OUTPUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
