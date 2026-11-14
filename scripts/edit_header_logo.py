"""Keep only the existing emblem; site lettering is real HTML text, not an image.

The original complete logo is preserved unchanged in assets/logo-completo.webp.
"""
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ORIGINAL = ROOT / "assets" / "logo-completo.webp"
DESTINATION = ROOT / "assets" / "logo.webp"


def main():
    original = Image.open(ORIGINAL).convert("RGBA")
    if original.size != (512, 512):
        raise ValueError(f"Unexpected original logo dimensions: {original.size}")

    # Only the red emblem and fish, above the original lettering.
    emblem = original.crop((148, 18, 398, 305))
    emblem.save(DESTINATION, format="WEBP", lossless=True, method=6)
    print(f"Original emblem only: {DESTINATION} ({emblem.width}x{emblem.height})")


if __name__ == "__main__":
    main()
