#!/usr/bin/env python3
"""
Generate a full 53-card face set (52 + Joker) as PNGs + one multi-page PDF.

Visual style matches the provided reference (ultra-bold sans rank, solid suit
glyphs, off-white face, black / warm red). Layout follows the requested template:

  • Top-left: large rank with smaller suit directly beneath
  • Bottom-right: same pair rotated 180°
  • Center: one dominant large suit glyph
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# --- geometry (poker ratio ≈ 2.5 : 3.5) ---
W, H = 750, 1050
CORNER_RADIUS = 42
MARGIN = 48

# --- palette (from reference) ---
FACE = (250, 248, 244, 255)
BLACK = (17, 17, 17, 255)
RED = (220, 38, 38, 255)  # warm vibrant red
JOKER = (109, 40, 217, 255)  # distinct purple for the joker
STROKE = (31, 41, 55, 255)

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets"
PDF_PATH = OUT_DIR / "full_deck.pdf"

SUITS = ("spades", "hearts", "diamonds", "clubs")
RANKS = (
    ("A", "ace"),
    ("2", "2"),
    ("3", "3"),
    ("4", "4"),
    ("5", "5"),
    ("6", "6"),
    ("7", "7"),
    ("8", "8"),
    ("9", "9"),
    ("10", "10"),
    ("J", "jack"),
    ("Q", "queen"),
    ("K", "king"),
)

RANK_FONT_CANDIDATES = [
    Path(r"C:\Windows\Fonts\seguibl.ttf"),  # Segoe UI Black
    Path(r"C:\Windows\Fonts\impact.ttf"),
    Path(r"C:\Windows\Fonts\arialbd.ttf"),
]


def load_rank_font(size: int) -> ImageFont.FreeTypeFont:
    for path in RANK_FONT_CANDIDATES:
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default()


def suit_color(suit: str) -> tuple[int, int, int, int]:
    return RED if suit in ("hearts", "diamonds") else BLACK


# ---------------------------------------------------------------------------
# Suit glyph paths (normalized to a unit box centered at origin, y-up)
# ---------------------------------------------------------------------------

def _heart_pts(s: float) -> list[tuple[float, float]]:
    # Classic heart outline sampled as a polygon
    pts: list[tuple[float, float]] = []
    for i in range(64):
        t = math.pi * 2 * i / 64
        x = 16 * math.sin(t) ** 3
        y = (
            13 * math.cos(t)
            - 5 * math.cos(2 * t)
            - 2 * math.cos(3 * t)
            - math.cos(4 * t)
        )
        pts.append((x / 17.0 * s, -y / 17.0 * s))
    return pts


def _diamond_pts(s: float) -> list[tuple[float, float]]:
    return [(0, -s), (s * 0.62, 0), (0, s), (-s * 0.62, 0)]


def _club_parts(s: float):
    r = s * 0.32
    stem_w = s * 0.18
    return {
        "circles": [
            (0, -s * 0.38, r),
            (-s * 0.38, s * 0.08, r),
            (s * 0.38, s * 0.08, r),
        ],
        "stem": [
            (-stem_w / 2, s * 0.05),
            (stem_w / 2, s * 0.05),
            (stem_w * 1.4, s * 0.95),
            (-stem_w * 1.4, s * 0.95),
        ],
        "center": (0, s * 0.02, r * 0.55),
    }


def _spade_pts(s: float) -> list[tuple[float, float]]:
    # Spade: inverted-heart-like top + stem
    top: list[tuple[float, float]] = []
    for i in range(48):
        t = math.pi * 2 * i / 48
        x = 16 * math.sin(t) ** 3
        y = (
            13 * math.cos(t)
            - 5 * math.cos(2 * t)
            - 2 * math.cos(3 * t)
            - math.cos(4 * t)
        )
        # flip vertically so point faces up, then shift
        top.append((x / 17.0 * s * 0.95, y / 17.0 * s * 0.95 - s * 0.12))
    return top


def draw_suit(
    draw: ImageDraw.ImageDraw,
    cx: float,
    cy: float,
    size: float,
    suit: str,
    color: tuple[int, int, int, int],
) -> None:
    s = size / 2
    if suit == "hearts":
        pts = [(cx + x, cy + y) for x, y in _heart_pts(s)]
        draw.polygon(pts, fill=color)
    elif suit == "diamonds":
        pts = [(cx + x, cy + y) for x, y in _diamond_pts(s)]
        draw.polygon(pts, fill=color)
    elif suit == "spades":
        pts = [(cx + x, cy + y) for x, y in _spade_pts(s)]
        draw.polygon(pts, fill=color)
        # stem
        stem_w = size * 0.09
        draw.polygon(
            [
                (cx - stem_w / 2, cy + size * 0.05),
                (cx + stem_w / 2, cy + size * 0.05),
                (cx + stem_w * 1.5, cy + s * 0.98),
                (cx - stem_w * 1.5, cy + s * 0.98),
            ],
            fill=color,
        )
        # fill notch at lobe junction
        draw.ellipse(
            [cx - size * 0.12, cy - size * 0.02, cx + size * 0.12, cy + size * 0.22],
            fill=color,
        )
    elif suit == "clubs":
        parts = _club_parts(s)
        for x, y, r in parts["circles"]:
            draw.ellipse([cx + x - r, cy + y - r, cx + x + r, cy + y + r], fill=color)
        cx0, cy0, r0 = parts["center"]
        draw.ellipse([cx + cx0 - r0, cy + cy0 - r0, cx + cx0 + r0, cy + cy0 + r0], fill=color)
        stem = [(cx + x, cy + y) for x, y in parts["stem"]]
        draw.polygon(stem, fill=color)


def rounded_card_base() -> Image.Image:
    """Opaque card face with transparent outside the rounded rectangle."""
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    mask = Image.new("L", (W, H), 0)
    mdraw = ImageDraw.Draw(mask)
    mdraw.rounded_rectangle([0, 0, W - 1, H - 1], radius=CORNER_RADIUS, fill=255)
    face = Image.new("RGBA", (W, H), FACE)
    img.paste(face, mask=mask)
    # subtle edge stroke inside the card
    draw = ImageDraw.Draw(img)
    inset = 2
    draw.rounded_rectangle(
        [inset, inset, W - 1 - inset, H - 1 - inset],
        radius=CORNER_RADIUS - 1,
        outline=STROKE,
        width=3,
    )
    return img


def draw_corner_index(
    base: Image.Image,
    rank: str,
    suit: str,
    color: tuple[int, int, int, int],
    *,
    rotate: bool,
) -> None:
    """Draw rank + suit-beneath at top-left; paste rotated for bottom-right."""
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    is_ten = rank == "10"
    # 2× previous corner index sizes for mobile / elderly readability
    rank_size = 236 if is_ten else 296
    suit_size = 156
    font = load_rank_font(rank_size)

    # Anchor block near top-left (shifted out a bit to fit the larger glyphs)
    ax = MARGIN + (110 if is_ten else 92)
    ay = MARGIN + 8

    # Rank
    bbox = draw.textbbox((0, 0), rank, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    # Optical vertical nudge so heavy glyphs sit cleanly under the margin
    rank_x = ax - tw / 2
    rank_y = ay - bbox[1]
    draw.text((rank_x, rank_y), rank, font=font, fill=color)

    # Suit directly beneath the rank
    suit_cy = ay + th + suit_size * 0.55
    draw_suit(draw, ax, suit_cy, suit_size, suit, color)

    if rotate:
        layer = layer.rotate(180, expand=False)
    base.alpha_composite(layer)


def draw_center_suit(
    draw: ImageDraw.ImageDraw,
    suit: str,
    color: tuple[int, int, int, int],
) -> None:
    draw_suit(draw, W / 2, H / 2, 340, suit, color)


def make_standard_card(rank: str, suit: str) -> Image.Image:
    img = rounded_card_base()
    color = suit_color(suit)
    draw = ImageDraw.Draw(img)
    draw_center_suit(draw, suit, color)
    draw_corner_index(img, rank, suit, color, rotate=False)
    draw_corner_index(img, rank, suit, color, rotate=True)
    return img


def make_joker() -> Image.Image:
    img = rounded_card_base()
    draw = ImageDraw.Draw(img)
    color = JOKER

    # Center emblem — geometric jester hat
    cx, cy = W / 2, H / 2 + 20
    hat = [
        (cx - 110, cy + 70),
        (cx - 110, cy - 20),
        (cx - 40, cy + 35),
        (cx, cy - 95),
        (cx + 40, cy + 35),
        (cx + 110, cy - 20),
        (cx + 110, cy + 70),
    ]
    draw.polygon(hat, fill=color)
    draw.rounded_rectangle([cx - 115, cy + 65, cx + 115, cy + 100], radius=10, fill=color)
    for bx, by, ball in (
        (cx - 110, cy - 30, (245, 158, 11, 255)),
        (cx, cy - 105, (239, 68, 68, 255)),
        (cx + 110, cy - 30, (34, 197, 94, 255)),
    ):
        draw.ellipse([bx - 18, by - 18, bx + 18, by + 18], fill=ball)

    def corner_label(rotate: bool) -> None:
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        font_big = load_rank_font(128)
        ax, ay = MARGIN + 140, MARGIN + 8
        d.text((ax - 140, ay), "JOKER", font=font_big, fill=color)
        # stand-in "suit" mark beneath the rank word
        draw_suit(d, ax, ay + 210, 104, "diamonds", color)
        if rotate:
            layer = layer.rotate(180, expand=False)
        img.alpha_composite(layer)

    corner_label(False)
    corner_label(True)
    return img


def filename_for(rank_slug: str, suit: str) -> str:
    return f"{rank_slug}_of_{suit}.png"


def build_all() -> list[Path]:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []

    for suit in SUITS:
        for rank_sym, rank_slug in RANKS:
            path = OUT_DIR / filename_for(rank_slug, suit)
            make_standard_card(rank_sym, suit).save(path, "PNG")
            paths.append(path)
            print(f"wrote {path.name}")

    joker_path = OUT_DIR / "joker.png"
    make_joker().save(joker_path, "PNG")
    paths.append(joker_path)
    print(f"wrote {joker_path.name}")
    return paths


def build_pdf(paths: list[Path]) -> None:
    """One card per page, same order as generation (spades→…→clubs, then joker)."""
    pages: list[Image.Image] = []
    for p in paths:
        im = Image.open(p).convert("RGB")
        pages.append(im)
    first, rest = pages[0], pages[1:]
    first.save(
        PDF_PATH,
        "PDF",
        save_all=True,
        append_images=rest,
        resolution=150.0,
    )
    print(f"wrote {PDF_PATH.name} ({len(pages)} pages)")


def main() -> None:
    paths = build_all()
    assert len(paths) == 53, f"expected 53 cards, got {len(paths)}"
    build_pdf(paths)
    print("done.")


if __name__ == "__main__":
    main()
