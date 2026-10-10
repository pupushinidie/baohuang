"""保皇 正式美术第二轮（PixelLab）。结果在 art/out/r2/。

r1 看下来：
- 框和绸带用简洁版垫底、strength 300–350，出来几乎是原样照抄，没出质感 → 这轮 strength 降到 90 / 160，另加不垫底的版本。
- 皇帝座位冠饰同理，改成不垫底；再出一组 16px 小皇冠（v2）给冠饰、皇牌角标、叫保框顶上用。
- 特效：用 r1 挑出的 42px 大图（皇冠 fx-emperor:0、盾 fx-guard:25、旗 fx-rebel:0）居中放进 64×64 当首帧，
  /animate-with-text-v3 出 4 帧循环（首帧=末帧，返回 5 帧去掉最后一帧），每样 3 个种子。
- 封面再补：殿内近景（pixen 512×288 裁成 384×192）和桌上皇冠配牌背（pixflux）。

用法：~/miniconda3/envs/quant/bin/python art/r2.py [名字 ...]
"""
from __future__ import annotations

import os
import sys
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

import pixellab
import sheet

ART = pixellab.ART
OUT = ART / "out" / "r2"
SIMPLE = ART / "simple"
NO_S = "no text, no letters, no numbers, no writing"


def center(im: Image.Image, w: int, h: int, dy: int = 0) -> Image.Image:
    im = im.crop(im.getchannel("A").getbbox())
    can = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    can.alpha_composite(im, ((w - im.width) // 2, (h - im.height) // 2 + dy))
    return can


# ---------- 特效首帧 ----------
FX = {
    "fx-crown": ("fx-emperor:0", "the golden crown bobs gently up and down, tiny golden sparkles twinkle around it"),
    "fx-guard": ("fx-guard:25", "the shield and sword bob gently up and down, tiny white sparkles twinkle around it"),
    "fx-rebel": ("fx-rebel:0", "the red pennant flag waves and flutters in the wind"),
}


def first_frame(name: str) -> pathlib.Path:
    path = OUT / "anim" / name / "first.png"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        center(Image.open(sheet.v2path(FX[name][0])).convert("RGBA"), 64, 64).save(path)
    return path


# ---------- pixflux ----------
FRAME = ("ornate Chinese imperial vermilion red lacquer frame with carved gold trim, gold cloud scroll ornaments in the corners, "
         "beveled edges, flat front view, pixel art game ui element, " + NO_S)
INIT = {
    # 名字: (提示词, 宽, 高, init 文件, 偏移, [(种子, strength)])
    "bao-show": (FRAME + ", three empty card slots side by side, a small golden crown at the top center",
                 148, 72, "bao-show.png", (1, 0), [(801, 90), (802, 160), (803, 160)]),
    "bao-tag": (FRAME + ", one empty card slot", 56, 72, "bao-tag.png", (1, 1), [(811, 90), (812, 160), (813, 160)]),
    "result-win": ("a horizontal vermilion red silk ribbon banner with swallowtail ends folded behind, gold embroidered trim "
                   "edges, soft folds and shading, blank empty middle, pixel art game ui element, " + NO_S,
                   160, 32, "result-win.png", (0, 0), [(821, 90), (822, 160)]),
    "result-lose": ("a horizontal slate grey blue silk ribbon banner with swallowtail ends folded behind, silver trim edges, "
                    "soft folds and shading, blank empty middle, pixel art game ui element, " + NO_S,
                    160, 32, "result-lose.png", (0, 0), [(831, 90), (832, 160)]),
}
FREE = {
    # 名字: (提示词, 宽, 高, 透明, 种子)
    "bao-show-free": (FRAME + ", wide rectangle with three tall empty card slots side by side, a small golden crown at the top center",
                      148, 72, True, (841, 842)),
    "result-win-free": ("a long horizontal vermilion red silk ribbon banner with swallowtail ends folded behind, gold trim edges, "
                        "soft folds, blank empty middle, pixel art game ui element, " + NO_S, 160, 32, True, (851, 852, 853)),
    "result-lose-free": ("a long horizontal slate grey blue silk ribbon banner with swallowtail ends folded behind, silver trim edges, "
                         "soft folds, blank empty middle, pixel art game ui element, " + NO_S, 160, 32, True, (861, 862)),
    "seat-crest-free": ("a wide flat golden ornament: a small golden crown in the middle and curling golden xiangyun cloud scrolls "
                        "spreading left and right, horizontal, pixel art game ui element, " + NO_S, 48, 32, True, (871, 872, 873)),
    "cover-table": ("a round dark wood card table in a Chinese imperial throne hall at night, a shining golden crown lying in the "
                    "middle of the table beside a neat stack of face down playing cards with plain red backs, glowing palace "
                    "lanterns and vermilion pillars with gold trim behind, cozy 16-bit pixel art game cover illustration, rich "
                    "warm red and gold colors, crisp clean pixels, no text, no letters, no numbers, no people",
                    384, 192, False, (881, 882, 883)),
}
PIXEN = {
    "cover-hall": ("night inside a grand Chinese imperial throne hall, close view of an empty golden dragon throne with a golden "
                   "folding screen on a raised dais, vermilion pillars with gold trim, turquoise and gold painted beams, glowing "
                   "hexagonal palace lanterns, a red carpet up the steps, a golden crown resting on a red cushion on the steps, "
                   "warm gold lantern light and deep navy shadows, no people, no characters, no text, no letters, no writing, "
                   "no calligraphy, pixel art, crisp pixels", (891, 892, 893)),
}

# ---------- v2 ----------
SMALL = (", pixel art game icon, bold readable silhouette, 1px dark outline, lit from the upper left, centered, "
         "transparent background, " + NO_S)
V2 = {
    "crown16": ("a tiny golden crown with a red jewel, five points" + SMALL, 16, 16),
    "cloud-corner": ("a small golden Chinese cloud scroll corner ornament, curling, L shaped corner piece" + SMALL, 16, 16),
    "cloud-scroll": ("a small horizontal golden Chinese xiangyun cloud scroll ornament curling to the left" + SMALL, 24, 16),
}

ORDER = list(FX) + list(INIT) + list(FREE) + list(PIXEN) + list(V2)


def pad_init(name, w, h, off):
    src = Image.open(SIMPLE / INIT[name][3]).convert("RGBA")
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.alpha_composite(src, off)
    path = OUT / "init" / f"{name}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(path)
    return path


def run(name: str) -> None:
    if name in FX:
        first = first_frame(name)
        for seed in (1, 2, 3):
            folder = OUT / "anim" / name / f"s{seed}"
            if folder.exists() and any(folder.glob("*.png")):
                continue
            pixellab.animate(f"{name}-s{seed}", {
                "first_frame": pixellab.b64_image(first), "last_frame": pixellab.b64_image(first),
                "action": FX[name][1], "frame_count": 4, "no_background": True, "seed": 5200 + seed,
            }, folder)
            print(name, seed, "ok", flush=True)
    elif name in INIT:
        prompt, w, h, _, off, runs = INIT[name]
        init = pad_init(name, w, h, off)
        for seed, strength in runs:
            target = f"{name}-s{seed}-k{strength}"
            if (OUT / "flux" / f"{target}.png").exists():
                continue
            pixellab.generate_image(target, {
                "description": prompt, "image_size": {"width": w, "height": h}, "detail": "highly detailed",
                "no_background": True, "init_image": pixellab.b64_image(init), "init_image_strength": strength, "seed": seed,
            }, OUT / "flux")
            print(target, "ok", flush=True)
    elif name in FREE:
        prompt, w, h, transparent, seeds = FREE[name]
        folder = OUT / ("covers" if name.startswith("cover") else "flux")
        for seed in seeds:
            target = f"{name}-s{seed}"
            if (folder / f"{target}.png").exists():
                continue
            body = {"description": prompt, "image_size": {"width": w, "height": h}, "detail": "highly detailed", "seed": seed}
            if transparent:
                body |= {"no_background": True}
            pixellab.generate_image(target, body, folder)
            print(target, "ok", flush=True)
    elif name in PIXEN:
        prompt, seeds = PIXEN[name]
        for seed in seeds:
            target = f"{name}-s{seed}"
            if (OUT / "covers" / f"{target}.png").exists():
                continue
            pixellab.generate_image(target, {
                "description": prompt, "image_size": {"width": 512, "height": 288}, "detail": "highly detailed", "seed": seed,
            }, OUT / "covers", endpoint="/create-image-pixen")
            print(target, "ok", flush=True)
    elif name in V2:
        prompt, w, h = V2[name]
        folder = OUT / "v2" / name
        if folder.exists() and any(folder.glob("*.png")):
            return
        pixellab.generate_async(name, {
            "description": prompt, "image_size": {"width": w, "height": h}, "no_background": True, "seed": 2021,
        }, folder, endpoint="/generate-image-v2")
        print(name, "ok", flush=True)
    else:
        raise KeyError(name)


import pathlib  # noqa: E402  (first_frame 的类型标注用)

if __name__ == "__main__":
    names = sys.argv[1:] or ORDER

    def one(n):
        try:
            run(n)
        except Exception as error:
            print(n, "失败：", error, flush=True)

    with ThreadPoolExecutor(max_workers=int(os.environ.get("R2_WORKERS", "10"))) as pool:
        list(pool.map(one, names))
    print("全部跑完", flush=True)
