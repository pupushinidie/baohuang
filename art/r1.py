"""保皇 正式美术第一轮候选（PixelLab）。结果在 art/out/r1/（被 gitignore，不进仓库）。

照 art/spec.md「金銮殿」：朱红描金柱子、青绿彩画额枋、空龙椅、六角宫灯、方砖地、红毯；不画人、不画字、不画龙的正脸特写。
- 场景 /create-image-pixen 512×288：夜、日两套提示词（A 照开工样张：前景圆桌；B 大圆桌在殿中央），同一批种子，便于夜日配对。
- 封面 /create-image-pixflux 384×192：3 种构图各 2 个种子。
- 框和绸带（bao-show、bao-tag、result-win/lose、seat-crest）：用简洁版（art/simple/）垫底当 init_image，pixflux 出质感，导出时再用代码把透明窗口、牌位按 spec 抠准。
- 小图（≤42px）全部 /generate-image-v2，一次 64 个：身份四件（32）、特效大图四件（42）、头像小物件五件（32）、皇牌插画（24×32）。
「保」「特」名次、「独」字一律代码画，不让模型写字。

用法：~/miniconda3/envs/quant/bin/python art/r1.py [名字 ...]   不写就全跑；出过的跳过，可以中断后重跑接着出。
标准客户端会在全站排队（打印「在等位置」是正常的）。一个进程，线程池并发（会员上限 10）。
"""
from __future__ import annotations

import os
import sys
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

import pixellab

ART = pixellab.ART
OUT = ART / "out" / "r1"
SIMPLE = ART / "simple"
NO = ("no people, no characters, no faces, no text, no letters, no writing, no signs, no calligraphy, "
      "no flags, no plaques with writing")
NO_S = "no text, no letters, no numbers, no writing"

# ---------- 场景 ----------
HALL = ("inside a grand Chinese imperial throne hall, vermilion red lacquered pillars with gold trim, "
        "carved beams painted with turquoise and gold patterns, an empty golden dragon throne with a folding screen "
        "on a raised dais at the back, ")
NIGHT_A = ("night " + HALL + "glowing hexagonal palace lanterns hanging, polished dark stone floor tiles with reflections, "
           "a red carpet leading to the throne, a large round dark wood card table in the foreground center, "
           "deep navy blue shadows with warm gold candlelight, rich red and gold palette, " + NO +
           ", top-down three-quarter view of a game table area, pixel art, crisp pixels")
DAY_A = ("bright daytime " + HALL + "unlit hexagonal palace lanterns hanging, bright sunlight streaming through lattice windows, "
         "polished stone floor tiles, a red carpet leading to the throne, a large round dark wood card table in the foreground center, "
         "warm bright daylight, soft cream and light ochre tones, rich red and gold palette, " + NO +
         ", top-down three-quarter view of a game table area, pixel art, crisp pixels")
NIGHT_B = ("night, high angle view " + HALL + "glowing hexagonal palace lanterns, a very large round dark wood table covered with "
           "a plain dark red cloth standing in the middle of the hall floor, empty table top, polished dark stone floor tiles, "
           "deep navy blue shadows with warm gold lantern light, rich red and gold palette, " + NO + ", pixel art, crisp pixels")
DAY_B = ("bright daytime, high angle view " + HALL + "unlit hexagonal palace lanterns, sunlight through lattice windows, "
         "a very large round dark wood table covered with a plain dark red cloth standing in the middle of the hall floor, "
         "empty table top, polished stone floor tiles, warm cream and ochre tones, rich red and gold palette, " + NO +
         ", pixel art, crisp pixels")
SCENES = {
    "night-a": (NIGHT_A, (11, 23, 37, 51)),
    "day-a": (DAY_A, (11, 23, 37, 51)),
    "night-b": (NIGHT_B, (61, 62, 63)),
    "day-b": (DAY_B, (61, 62, 63)),
}

# ---------- 封面 ----------
COVER_STYLE = ("cozy 16-bit pixel art game cover illustration, rich warm red and gold colors, soft lighting, crisp clean pixels, "
               "no text, no letters, no logo, no numbers, no people, no characters")
COVERS = {
    "cover-throne": ("night inside a Chinese imperial throne hall, an empty golden dragon throne on a raised dais glowing in warm "
                     "lantern light, vermilion pillars with gold trim, hexagonal palace lanterns, a golden crown resting on the "
                     "red carpet steps in front of the throne, " + COVER_STYLE, (801, 802)),
    "cover-crown": ("close view of a round dark wood table in a Chinese imperial palace at night, a shining golden crown lying on "
                    "the table beside a few face down red playing cards, glowing palace lanterns and vermilion pillars blurred "
                    "behind, " + COVER_STYLE, (803, 804)),
    "cover-gate": ("the Forbidden City style vermilion palace gate tower at night with golden roof tiles, rows of glowing red "
                   "palace lanterns, white marble steps, starry deep blue sky, festive and grand, " + COVER_STYLE, (805, 806)),
}

# ---------- pixflux + init（简洁版垫底） ----------
FRAME_D = ("ornate Chinese imperial red lacquer frame with gold trim and small gold cloud scroll corner ornaments, "
           "flat front view, pixel art game ui element, empty transparent inside, " + NO_S)
INIT = {
    # 名字: (提示词, 宽, 高, init 文件, 偏移, 种子, strength)
    "bao-show": (FRAME_D + ", three empty card slots side by side, a small golden crown at the top center",
                 148, 72, "bao-show.png", (1, 0), (701, 702, 703), 350),
    "bao-tag": (FRAME_D + ", one empty card slot", 56, 72, "bao-tag.png", (1, 1), (711, 712, 713), 350),
    "result-win": ("a horizontal vermilion red silk ribbon banner with swallowtail ends and gold embroidered trim edges, "
                   "blank empty middle, pixel art game ui element, " + NO_S, 160, 32, "result-win.png", (0, 0), (721, 722, 723), 300),
    "result-lose": ("a horizontal slate grey blue silk ribbon banner with swallowtail ends and silver trim edges, "
                    "blank empty middle, pixel art game ui element, " + NO_S, 160, 32, "result-lose.png", (0, 0), (731, 732, 733), 300),
    "seat-crest": ("a small horizontal golden ornament, a tiny golden crown in the middle with curling golden cloud scrolls "
                   "on both sides, pixel art game ui element, " + NO_S, 48, 32, "seat-crest.png", (0, 8), (741, 742, 743), 300),
}

# ---------- v2（一次 64 个） ----------
SMALL = (", pixel art game icon, bold readable silhouette, 1px dark outline, warm lantern light from the upper left, "
         "rich red and gold palette, centered, transparent background, " + NO_S)
V2 = {
    # 名字: (提示词, 宽, 高)
    "emperor": ("a golden imperial crown with red rubies and blue sapphires, five points" + SMALL, 32, 32),
    "emperor-cn": ("a golden Chinese emperor's crown hat with small gold dragon ornament and red jewels" + SMALL, 32, 32),
    "guard": ("a blue heater shield with gold rim and a silver sword standing vertically behind it" + SMALL, 32, 32),
    "rebel": ("a plain red triangular war pennant flag with gold edge on a wooden spear pole, waving, no emblem on the flag" + SMALL, 32, 32),
    "seal": ("a square vermilion red Chinese seal stamp imprint, thick red border, blank empty middle, rough ink edges" + SMALL, 32, 32),
    "fx-emperor": ("a big golden imperial crown with red rubies and blue sapphires, five points" + SMALL, 42, 42),
    "fx-guard": ("a big blue heater shield with gold rim and a silver sword standing vertically behind it" + SMALL, 42, 42),
    "fx-rebel": ("a big plain red triangular war pennant flag with gold edge on a wooden spear pole, waving, no emblem" + SMALL, 42, 42),
    "av-lantern": ("a red hexagonal Chinese palace lantern with gold frame and a red tassel, glowing warm" + SMALL, 32, 32),
    "av-fan": ("an open Chinese folding fan with sky blue paper and bamboo ribs, plain, no painting" + SMALL, 32, 32),
    "av-tea": ("a blue and white porcelain lidded tea bowl gaiwan on a saucer, steam" + SMALL, 32, 32),
    "av-cloud": ("a pink auspicious Chinese xiangyun cloud swirl ornament" + SMALL, 32, 32),
    "av-coin": ("an ancient round bronze Chinese coin with a square hole in the middle, plain without characters" + SMALL, 32, 32),
    "huang-crown": ("a golden imperial crown resting on a red silk cushion with gold tassels" + SMALL, 24, 32),
    "huang-jester": ("a jester king, upper body, red and yellow jester hat with bells and a small golden crown on top, "
                     "smiling, purple collar" + SMALL, 24, 32),
}
ORDER = (["night-a", "day-a", "night-b", "day-b"] + list(COVERS) + list(INIT) + list(V2))


def pad_init(name: str, w: int, h: int, off: tuple[int, int]) -> Image.Image:
    src = Image.open(SIMPLE / INIT[name][3]).convert("RGBA")
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.alpha_composite(src, off)
    path = OUT / "init" / f"{name}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(path)
    return path


def run(name: str) -> None:
    if name in SCENES:
        prompt, seeds = SCENES[name]
        for seed in seeds:
            target = f"scene-{name}-s{seed}"
            if (OUT / "scenes" / f"{target}.png").exists():
                continue
            pixellab.generate_image(target, {
                "description": prompt, "image_size": {"width": 512, "height": 288},
                "detail": "highly detailed", "seed": seed,
            }, OUT / "scenes", endpoint="/create-image-pixen")
            print(target, "ok", flush=True)
    elif name in COVERS:
        prompt, seeds = COVERS[name]
        for seed in seeds:
            target = f"{name}-s{seed}"
            if (OUT / "covers" / f"{target}.png").exists():
                continue
            pixellab.generate_image(target, {
                "description": prompt, "image_size": {"width": 384, "height": 192}, "detail": "highly detailed", "seed": seed,
            }, OUT / "covers")
            print(target, "ok", flush=True)
    elif name in INIT:
        prompt, w, h, _, off, seeds, strength = INIT[name]
        init = pad_init(name, w, h, off)
        for seed in seeds:
            target = f"{name}-s{seed}"
            if (OUT / "flux" / f"{target}.png").exists():
                continue
            pixellab.generate_image(target, {
                "description": prompt, "image_size": {"width": w, "height": h}, "detail": "highly detailed",
                "no_background": True, "init_image": pixellab.b64_image(init), "init_image_strength": strength, "seed": seed,
            }, OUT / "flux")
            print(target, "ok", flush=True)
    elif name in V2:
        prompt, w, h = V2[name]
        folder = OUT / "v2" / name
        if folder.exists() and any(folder.glob("*.png")):
            return
        paths = pixellab.generate_async(name, {
            "description": prompt, "image_size": {"width": w, "height": h}, "no_background": True, "seed": 2020,
        }, folder, endpoint="/generate-image-v2")
        print(name, len(paths), "张", flush=True)
    else:
        raise KeyError(name)


if __name__ == "__main__":
    names = sys.argv[1:] or ORDER
    try:
        print("余额", pixellab.balance(), flush=True)
    except Exception as error:
        print("查余额失败：", error, flush=True)

    def one(n):
        try:
            run(n)
        except Exception as error:  # 一样失败不挡后面的
            print(n, "失败：", error, flush=True)

    with ThreadPoolExecutor(max_workers=int(os.environ.get("R1_WORKERS", "10"))) as pool:
        list(pool.map(one, names))
    print("全部跑完; 美元累计", round(pixellab.spent_usd(), 4), flush=True)
