"""拼总览图：python art/sheet.py OUT.png SCALE COLS BG img1 img2 ...   BG 写 night / day / checker。
每张图下面标序号（文件名尾部），方便挑。v2 一组 64 张用 `sheet.py out.png 3 16 night dir/*.png`。"""
from __future__ import annotations

import pathlib
import sys

from PIL import Image, ImageDraw

BGS = {"night": (13, 24, 45), "day": (228, 207, 165), "mid": (90, 90, 100)}


def sheet(out, paths, scale=3, cols=8, bg="night", label=True, pad=6):
    ims = [Image.open(p).convert("RGBA") for p in paths]
    cw = max(i.width for i in ims) * scale + pad
    ch = max(i.height for i in ims) * scale + pad + (12 if label else 0)
    rows = -(-len(ims) // cols)
    can = Image.new("RGBA", (cols * cw + pad, rows * ch + pad), BGS.get(bg, (60, 60, 60)) + (255,))
    d = ImageDraw.Draw(can)
    for k, (p, im) in enumerate(zip(paths, ims)):
        x, y = pad + (k % cols) * cw, pad + (k // cols) * ch
        big = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
        can.alpha_composite(big, (x, y))
        if label:
            stem = pathlib.Path(p).stem
            d.text((x, y + big.height + 1), stem[-10:], fill=(255, 255, 255) if bg != "day" else (0, 0, 0))
    can.convert("RGB").save(out)
    return out


if __name__ == "__main__":
    out, scale, cols, bg, *paths = sys.argv[1:]
    print(sheet(out, paths, int(scale), int(cols), bg))


def group(folder, out, scale=3, cols=16, bg="night"):
    """v2 一组 64 张按序号排（name.png 是 0 号，name-N.png 是 N 号）。"""
    folder = pathlib.Path(folder)
    def idx(p):
        tail = p.stem.rsplit("-", 1)[-1]
        return int(tail) if tail.isdigit() and p.stem != folder.name else 0
    paths = sorted(folder.glob("*.png"), key=idx)
    ims = [Image.open(p).convert("RGBA") for p in paths]
    cw = max(i.width for i in ims) * scale + 6
    ch = max(i.height for i in ims) * scale + 18
    rows = -(-len(ims) // cols)
    can = Image.new("RGBA", (cols * cw + 6, rows * ch + 6), BGS.get(bg, (60, 60, 60)) + (255,))
    d = ImageDraw.Draw(can)
    for k, (p, im) in enumerate(zip(paths, ims)):
        x, y = 6 + (k % cols) * cw, 6 + (k // cols) * ch
        can.alpha_composite(im.resize((im.width * scale, im.height * scale), Image.NEAREST), (x, y))
        d.text((x, y + im.height * scale + 2), str(idx(p)), fill=(255, 255, 255) if bg != "day" else (0, 0, 0))
    can.convert("RGB").save(out)
    return out


def v2path(spec: str) -> pathlib.Path:
    """'emperor:3' → out/r1/v2/emperor/emperor-3.png（0 号是 emperor.png）；可写 'r2/xxx:3' 指定轮次。"""
    g, i = spec.rsplit(":", 1)
    rnd, g = (g.split("/", 1) if "/" in g else ("r1", g))
    base = pathlib.Path(__file__).resolve().parent / "out" / rnd / "v2" / g
    return base / (f"{g}.png" if i == "0" else f"{g}-{i}.png")


def picks(out, specs, scale=3, cols=11, bg="night"):
    return sheet(out, [v2path(s) for s in specs], scale, cols, bg)
