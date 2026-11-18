"""Convert an opaque, verified installed-game PNG into a truecolor Play screenshot."""
import argparse
from pathlib import Path

from PIL import Image


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("raw_capture", type=Path)
    args.add_argument("destination", type=Path)
    args.add_argument("--room-code-bounds", nargs=4, type=int, metavar=("LEFT", "TOP", "RIGHT", "BOTTOM"),
                      help="Remove only the room identifier using its accessibility bounds on the flat header.")
    files = args.parse_args()
    if files.destination.exists() or files.destination.suffix.lower() != ".png":
        args.error("Choose a new PNG file for the final export.")
    with Image.open(files.raw_capture) as raw:
        short, long = sorted(raw.size)
        if raw.format != "PNG" or short < 320 or long > 3840 or long > 2 * short:
            args.error("Capture a native PNG in Play's supported dimensions and aspect ratio.")
        if raw.convert("RGBA").getchannel("A").getextrema() != (255, 255):
            args.error("Recapture the actual app with an opaque background.")
        files.destination.parent.mkdir(parents=True, exist_ok=True)
        img = raw.convert("RGB")
        if files.room_code_bounds:
            left, top, right, bottom = files.room_code_bounds
            if not (0 <= left < right < img.width - 3 and 0 <= top < bottom <= img.height):
                args.error("Redaction bounds fall outside the image.")
            for y in range(top, bottom):
                img.paste(img.getpixel((right + 3, y)), (left, y, right, y + 1))
        img.save(files.destination, "PNG", optimize=True)


if __name__ == "__main__":
    main()
