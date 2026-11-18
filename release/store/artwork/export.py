"""Export the editable SVGs to Play PNGs and native Android drawables."""
from io import BytesIO
from pathlib import Path
import xml.etree.ElementTree as ET

import cairosvg
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
RES = ROOT / "android/app/src/main/res"
OUTPUT = HERE.parent / "graphics"


def bitmap(data, size):
    png = cairosvg.svg2png(bytestring=data, output_width=size[0], output_height=size[1])
    return Image.open(BytesIO(png))


def vector(paths, size=108):
    items = []
    for path in paths:
        attrs = path.attrib
        items.append(f'  <path android:fillColor="{attrs["fill"]}" android:fillType="evenOdd" android:pathData="{attrs["d"]}"/>')
    return (f'<vector xmlns:android="http://schemas.android.com/apk/res/android" '
            f'android:width="{size}dp" android:height="{size}dp" android:viewportWidth="108" android:viewportHeight="108">\n'
            + '  <group android:pivotX="54" android:pivotY="54" android:scaleX="0.94" android:scaleY="0.94">\n'
            + '\n'.join(items) + '\n  </group>\n</vector>\n')


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding='utf-8')


def export_launcher():
    source = (HERE / "launcher.svg").read_text()
    paths = ET.fromstring(source).findall('.//{*}path')
    mono = ET.parse(HERE / "launcher-mono.svg").getroot().findall('{*}path')
    write(RES / 'drawable/ic_launcher_foreground.xml', vector(paths))
    write(RES / 'drawable/launch_emblem.xml', vector(paths, size=200))
    write(RES / 'drawable/ic_launcher_mono.xml', vector(mono))
    write(RES / 'drawable/splash.xml', '''<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
  <item android:drawable="@color/ic_launcher_background"/>
  <item android:gravity="center" android:drawable="@drawable/launch_emblem"/>
</layer-list>
''')
    write(RES / 'values/ic_launcher_background.xml', '<resources><color name="ic_launcher_background">#0f5132</color></resources>\n')
    for api in (26, 33):
        mono_layer = '\n  <monochrome android:drawable="@drawable/ic_launcher_mono"/>' if api == 33 else ''
        icon = f'''<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/ic_launcher_background"/>
  <foreground android:drawable="@drawable/ic_launcher_foreground"/>{mono_layer}
</adaptive-icon>
'''
        for name in ('ic_launcher', 'ic_launcher_round'):
            write(RES / f'mipmap-anydpi-v{api}/{name}.xml', icon)
    # Play supplies its own mask. Enlarge the printed emblem for the full-bleed listing icon.
    store_svg = source.replace('<g id="cards">','<g id="cards" transform="translate(-16.2,-16.2) scale(1.3)">')
    write(ROOT / 'public/favicon.svg', store_svg)
    store = bitmap(store_svg.encode(), (1024,1024)).convert('RGBA')
    store.resize((512,512),Image.Resampling.LANCZOS).save(OUTPUT / 'play-icon.png')
    for density, size in [('mdpi',48),('hdpi',72),('xhdpi',96),('xxhdpi',144),('xxxhdpi',192)]:
        for name, radius in [('ic_launcher',190),('ic_launcher_round',512)]:
            mask = Image.new('L',store.size)
            ImageDraw.Draw(mask).rounded_rectangle((36,36,987,987),radius,fill=255)
            masked = store.copy()
            masked.putalpha(mask)
            masked.resize((size,size),Image.Resampling.LANCZOS).save(RES / f'mipmap-{density}/{name}.png')


if __name__ == '__main__':
    OUTPUT.mkdir(exist_ok=True)
    export_launcher()
    feature = HERE / 'feature.svg'
    if feature.exists():
        bitmap(feature.read_bytes(),(2048,1000)).convert('RGB').resize((1024,500),Image.Resampling.LANCZOS).save(OUTPUT/'feature-graphic.png')
