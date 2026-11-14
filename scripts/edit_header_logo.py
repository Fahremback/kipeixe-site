"""Rearrange the authentic Kipeixe logo into a horizontal header lockup.

The artwork comes exclusively from assets/logo-completo.webp. No font or mark
is generated or substituted. The tiny original subtitle is deliberately omitted.
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ORIGINAL = ROOT / "assets" / "logo-completo.webp"
DESTINATION = ROOT / "assets" / "logo.webp"


def main():
    original = Image.open(ORIGINAL).convert("RGBA")
    if original.size != (512, 512):
        raise ValueError(f"Unexpected original logo dimensions: {original.size}")

    # Precise crops from the existing logo: emblem above and original red letters below.
    emblem = original.crop((148, 18, 398, 305))
    wordmark = original.crop((84, 310, 427, 393))

    # The small subtitle in the original extends into the wordmark's shadow.
    # Keep the authentic red glyphs plus their immediate antialiased edges,
    # but remove every detached trace of the lower subtitle.
    red = Image.new("L", wordmark.size)
    red.putdata([
        255 if a > 30 and r > 55 and r > g * 1.45 and r > b * 1.20 else 0
        for r, g, b, a in wordmark.getdata()
    ])
    wordmark.putalpha(ImageChops.multiply(
        wordmark.getchannel("A"), red.filter(ImageFilter.MaxFilter(5))
    ))

    emblem = emblem.resize((250, 287), Image.Resampling.LANCZOS)
    wordmark = wordmark.resize((565, 137), Image.Resampling.LANCZOS)
    result = Image.new("RGBA", (855, 310), (0, 0, 0, 0))
    result.alpha_composite(emblem, (5, 11))
    result.alpha_composite(wordmark, (284, 85))
    result.save(DESTINATION, format="WEBP", lossless=True, method=6)
    print(f"Edited original logo in {DESTINATION} ({result.width}x{result.height})")


if __name__ == "__main__":
    main()
