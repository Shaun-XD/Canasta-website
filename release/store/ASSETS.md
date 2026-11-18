# Release artwork and usage rights

Last inspected on 2026-11-19 (Hong Kong time).

## Files for Play

| Purpose | File | Format | Suggested alt text |
| --- | --- | --- | --- |
| Store icon | graphics/play-icon.png | 512 × 512, RGBA PNG | A cream diamond card overlapping a gold card on green felt. |
| Feature graphic | graphics/feature-graphic.png | 1024 × 500, RGB PNG | Rajasthani Canasta with a run of seven, eight, and nine of diamonds on a green card table. |

The feature illustration is promotional art. Only screenshots from an installed Android build belong in the screenshots section. The real captures, install source, version and device should be recorded alongside them before upload.

## Editable sources and native integration

The two-card motif, outlines, four suit ornaments, illustrated meld, borders and felt pattern are drawn for this release. The green background follows the existing table. The editable vector sources are in `artwork/launcher.svg`, `artwork/launcher-mono.svg` and `artwork/feature.svg`. The lettering in the feature graphic is outlined Figtree. All artwork can render without external URLs, fonts or stock imagery.

Android resources live in `android/app/src/main/res/`. Adaptive launcher XML uses a green background, a vector foreground and a monochrome version for themed Android icons. Legacy round and square variants are exported at all five densities. The platform controls the final adaptive mask. The splash screen uses the same vector emblem. The packaged web favicon also uses this artwork.

The ready-to-use PNGs and native resources are checked into the release branch. To regenerate from the SVGs, run `python3 release/store/artwork/export.py` with Python 3, Pillow, CairoSVG, and the Cairo system library. On an Apple Silicon Homebrew installation, set `DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib` for this command if Cairo is not found.

## Shipped visual assets

- All 53 face images in `public/cards/` are produced by the tracked `scripts/generate_card_faces.py` using original mathematical suit geometry and the licensed Figtree typeface. Previous output used an unspecified locally installed Windows typeface. The release build uses the regenerated PNGs with no platform-dependent rank font. The original PDF references and prior print compilation are outside the bundle’s web asset directory.
- The card backs, avatar initials, meld and hand controls, table patterns, and simple UI symbols are generated in the repository's React components, CSS and useCardFlip hook. The asset inventory is in `assets/MANIFEST.json`. System-provided glyphs are rasterized by their respective platforms. The Play art, native artwork, and generated card graphics are distributed as part of the project's [GPLv3 source](../../LICENSE).
- The Figtree font is distributed intact under the SIL Open Font License 1.1. Both `public/fonts/Figtree-Variable.ttf` and `public/fonts/OFL-Figtree.txt` are packaged by Vite. The glyphs are used in menus, card ranks and the feature illustration. The web entrypoint now loads the bundled typeface. The upstream files are from the [pinned Google Fonts tree](https://github.com/google/fonts/tree/5bd87dfc525c8a0d1d8529d3684716e00c3fc59a/ofl/figtree). The verified Git blobs are `579e2ab5f30beb21cd0b618dd0796b0fce0eff8e` (font) and `80b12bb3d0c0942676657ef6d125daf4a1e1346d` (license).
- The Vite scaffold mark was replaced. The Play launcher, feature artwork, and splash have no Google Play badges, OEM marks, third-party stock art or external logo assets.

## Real screenshot export

Obtain at least two faithful screenshots of the installed candidate. For game recommendations Google requests at least three landscape 16:9 gameplay images at 1920 × 1080 or above, or the portrait equivalent. Prefer native 1920 × 1080 landscape where the table, hand and controls remain visible. Avoid status notifications and any genuine names, email addresses, room/session identifiers or account details. Prefer isolated solo matches with synthetic player names and capture three distinct stages of play. Check the device date, release identity and install method, and retain the original captures. Do not use website renders or viewport-only tests.

Use `python3 release/store/artwork/prepare_screenshot.py DEVICE_CAPTURE.png DESTINATION.png` to export individual opaque Android captures at their original size. The script rejects unsupported aspect ratios, transparency, dimensions and duplicate-path output. It never manufactures gameplay, crops a hand or enlarges the image. Inspect the result manually and supply succinct alt text describing only what is visible.

Google Play requires two screenshots across device types, in JPEG or RGB PNG, with each side between 320 and 3840 pixels and aspect ratio no wider/taller than 2:1. The feature graphic requires JPEG or 24-bit PNG and the icon 32-bit PNG with a maximum of 1,024 KB. [Google Play preview assets](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en). [Android adaptive icon dimensions and safety zone](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive).
