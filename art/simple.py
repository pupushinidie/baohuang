"""保皇 · 简洁版美术（不调 PixelLab，不用外部图片）。

按 art/spec.md 的文件名、尺寸、帧数，用 PIL 画出能直接上线的简洁版，写进 apps/web/public/art/。
正式美术定稿后会用同样的文件名覆盖这些图，界面不用改代码。

    ~/miniconda3/envs/quant/bin/python art/simple.py            # 画全部
    ~/miniconda3/envs/quant/bin/python art/simple.py --preview  # 另外拼一张放大预览到 art/out/simple-preview/

风格：金銮殿（开工拍板）。调色板见 spec.md「风格」一节，和这里的 PAL 一致。
文字只用 Fusion Pixel 12px（字号 12 的整数倍），不抗锯齿。
"""
from __future__ import annotations

import math
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "apps" / "web" / "public" / "art"
CARDS = ROOT / "apps" / "web" / "public" / "cards-pixel"
WOFF2 = ROOT / "apps" / "web" / "src" / "assets" / "pixel" / "fusion-pixel-12px-zh_hans.woff2"
TTF = ROOT / "art" / "out" / "fusion12.ttf"  # 由 woff2 解压出来，gitignore

# ---- 调色板（金銮殿）。spec.md 里同一张表。 ----
PAL = {
    "ink": (26, 14, 14),          # 描边 #1a0e0e
    "night0": (9, 10, 22),        # 最深夜色 #090a16
    "night1": (13, 24, 45),       # 殿内夜蓝 #0d182d
    "night2": (22, 36, 64),       # 窗格亮面 #162440
    "floor_n": (20, 22, 38),      # 夜间地砖 #141626
    "floor_n2": (28, 30, 50),     # 夜间地砖缝亮边 #1c1e32
    "red": (158, 42, 34),         # 朱红柱 #9e2a22
    "red_d": (90, 23, 18),        # 朱红暗面 #5a1712
    "red_l": (196, 66, 48),       # 朱红亮面 #c44230
    "carpet": (110, 26, 26),      # 红毯 #6e1a1a
    "gold": (224, 176, 74),       # 金 #e0b04a
    "gold_d": (151, 118, 72),     # 暗金 #977648
    "gold_l": (255, 222, 140),    # 亮金 #ffde8c
    "lamp": (255, 207, 106),      # 宫灯光 #ffcf6a
    "cream": (246, 238, 219),     # 牌面米白 #f6eedb
    "day_wall": (228, 207, 165),  # 白天墙 #e4cfa5
    "day_wall2": (210, 186, 140), # 白天墙暗 #d2ba8c
    "day_floor": (200, 178, 136), # 白天地砖 #c8b288
    "day_floor2": (184, 160, 116),# 白天砖缝 #b8a074
    "ochre": (178, 135, 95),      # 赭 #b2875f
    "jade": (64, 150, 140),       # 青绿（彩画）#40968c
    "blue": (70, 140, 220),       # 侍卫蓝 #468cdc
    "blue_d": (36, 78, 140),      # #244e8c
    "rebel": (214, 84, 52),       # 造反旗 #d65434
    "rebel_d": (130, 40, 26),     # #82281a
    "silver": (200, 206, 216),    # 银 #c8ced8
    "bronze": (196, 126, 70),     # 铜 #c47e46
    "gray": (120, 124, 138),      # #787c8a
    "white": (255, 255, 255),
}
# 五个座位色（Okabe-Ito 色盲安全色 + 银白），界面 art.ts 的 SEAT_COLORS 照这个。
SEATS = [(230, 159, 0), (86, 180, 233), (0, 158, 115), (204, 121, 167), (232, 228, 216)]


def font() -> ImageFont.FreeTypeFont:
    if not TTF.exists():
        from fontTools.ttLib import TTFont
        TTF.parent.mkdir(parents=True, exist_ok=True)
        f = TTFont(str(WOFF2))
        f.flavor = None
        f.save(str(TTF))
    return ImageFont.truetype(str(TTF), 12)


FONT = None


def draw(im: Image.Image) -> ImageDraw.ImageDraw:
    d = ImageDraw.Draw(im)
    d.fontmode = "1"  # 不抗锯齿
    return d


def text(im: Image.Image, xy, s: str, fill, outline=None) -> None:
    global FONT
    FONT = FONT or font()
    d = draw(im)
    if outline:
        x, y = xy
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            d.text((x + dx, y + dy), s, font=FONT, fill=outline)
    d.text(xy, s, font=FONT, fill=fill)


def text_center(im: Image.Image, cx: int, cy: int, s: str, fill, outline=None) -> None:
    global FONT
    FONT = FONT or font()
    l, t, r, b = FONT.getbbox(s)
    text(im, (cx - (r - l) // 2 - l, cy - (b - t) // 2 - t), s, fill, outline)


def outline(im: Image.Image, color=PAL["ink"]) -> Image.Image:
    """给透明图加 1px 硬边外描边（四邻域）。"""
    a = im.getchannel("A").point(lambda v: 255 if v > 0 else 0)
    out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ring = Image.new("RGBA", im.size, color + (255,))
    for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        shifted = Image.new("L", im.size, 0)
        shifted.paste(a, (dx, dy))
        out.paste(ring, (0, 0), shifted)
    out.alpha_composite(im)
    return out


def save(im: Image.Image, name: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    im.save(OUT / name)
    print("wrote", name, im.size)


# ======================================================================
# 场景（512×288，不透明，夜间 / 白天）
# ======================================================================

def scene(day: bool) -> Image.Image:
    W, H = 512, 288
    wall = PAL["day_wall"] if day else PAL["night1"]
    wall2 = PAL["day_wall2"] if day else PAL["night0"]
    floor = PAL["day_floor"] if day else PAL["floor_n"]
    floor2 = PAL["day_floor2"] if day else PAL["floor_n2"]
    red, red_d, red_l = PAL["red"], PAL["red_d"], PAL["red_l"]
    if day:
        red, red_d, red_l = (184, 52, 42), (121, 31, 26), (212, 86, 62)
    gold, gold_d = PAL["gold"], PAL["gold_d"]
    im = Image.new("RGBA", (W, H), wall + (255,))
    d = draw(im)
    horizon = 132  # 墙和地面的分界
    # 后墙：花窗格（每扇 40×64，在柱子之间）
    d.rectangle([0, 34, W, horizon], fill=wall)
    for x0 in range(0, W, 8):
        pass
    for bay in range(6):
        bx = 22 + bay * 84 + 22
        if 2 <= bay <= 3:
            continue  # 中间两开间留给宝座
        d.rectangle([bx, 52, bx + 40, 120], fill=wall2)
        d.rectangle([bx, 52, bx + 40, 120], outline=gold_d)
        for gx in range(bx + 4, bx + 40, 6):
            d.line([gx, 54, gx, 118], fill=(PAL["day_wall"] if day else PAL["night2"]))
        for gy in range(56, 120, 6):
            d.line([bx + 2, gy, bx + 38, gy], fill=(PAL["day_wall"] if day else PAL["night2"]))
    # 宝座（中间，压低对比，抽象的屏风 + 台阶 + 椅背）
    cx = W // 2
    d.rectangle([cx - 62, 54, cx + 62, horizon], fill=(PAL["ochre"] if day else (40, 30, 34)))
    for i, px in enumerate(range(cx - 58, cx + 58, 16)):
        d.rectangle([px, 58, px + 13, 110], fill=(PAL["gold"] if day else gold_d))
        d.rectangle([px + 3, 62, px + 10, 106], fill=(PAL["ochre"] if day else (66, 50, 42)))
    d.rectangle([cx - 20, 78, cx + 20, 116], fill=gold)            # 椅背
    d.rectangle([cx - 14, 84, cx + 14, 112], fill=(PAL["gold_l"] if day else gold_d))
    d.rectangle([cx - 26, 112, cx + 26, 120], fill=gold_d)         # 座面
    for step in range(3):                                          # 台阶
        y = 120 + step * 4
        d.rectangle([cx - 40 - step * 10, y, cx + 40 + step * 10, y + 3], fill=(red if step % 2 == 0 else red_d))
    # 顶部额枋：朱红梁 + 金色回纹带 + 青绿彩画
    d.rectangle([0, 0, W, 33], fill=red_d)
    d.rectangle([0, 6, W, 21], fill=PAL["jade"] if day else (34, 82, 80))
    for x in range(0, W, 16):
        d.rectangle([x + 2, 9, x + 13, 18], outline=gold_d)
        d.rectangle([x + 6, 12, x + 9, 15], fill=gold)
    d.line([0, 5, W, 5], fill=gold)
    d.line([0, 22, W, 22], fill=gold)
    d.rectangle([0, 26, W, 33], fill=red)
    for x in range(0, W, 8):
        d.point((x + 3, 29), fill=gold_d)
    # 地面：大方砖（菱形透视太花，用平铺方砖 + 远处窄近处宽的横缝）
    d.rectangle([0, horizon, W, H], fill=floor)
    y, h = horizon, 6
    while y < H:
        d.line([0, y, W, y], fill=floor2)
        offset = (y // 3) % 32
        for x in range(-offset, W, 32 + (y - horizon) // 4):
            d.line([x, y, x, min(H, y + h)], fill=floor2)
        y += h
        h += 3
    # 红毯：从宝座到下方，两边金边
    for yy in range(horizon + 12, H):
        t = (yy - horizon) / (H - horizon)
        half = int(44 + t * 70)
        d.line([cx - half, yy, cx + half, yy], fill=PAL["carpet"] if not day else (150, 40, 34))
        d.point((cx - half, yy), fill=gold)
        d.point((cx + half, yy), fill=gold)
        if (yy - horizon) % 16 == 0:
            for k in range(-2, 3):
                d.point((cx + k * half // 3, yy), fill=gold_d)
    # 柱子：左右各两根，近大远小（只画前排，宽 22）
    for px in (16, 104, W - 104 - 22, W - 16 - 22):
        d.rectangle([px, 34, px + 21, H], fill=red)
        d.rectangle([px + 14, 34, px + 21, H], fill=red_d)  # 暗面
        d.rectangle([px + 3, 34, px + 5, H], fill=red_l)    # 高光
        d.rectangle([px - 3, 34, px + 24, 40], fill=gold)   # 柱头金箍
        d.rectangle([px - 3, 41, px + 24, 42], fill=gold_d)
        d.rectangle([px - 4, H - 22, px + 25, H - 14], fill=gold_d)  # 柱础
        d.rectangle([px - 4, H - 22, px + 25, H - 21], fill=gold)
        d.rectangle([px - 6, H - 13, px + 27, H], fill=(PAL["ochre"] if day else (60, 56, 70)))
    # 宫灯（六角灯笼，夜里亮，白天不亮）
    for lx in (68, 186, W - 186, W - 68):
        d.line([lx, 34, lx, 52], fill=gold_d)
        body = PAL["lamp"] if not day else (206, 120, 64)
        if not day:  # 夜间光晕：两圈半透明，硬边
            glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            gd = draw(glow)
            gd.ellipse([lx - 26, 46, lx + 26, 98], fill=(255, 190, 90, 26))
            gd.ellipse([lx - 17, 55, lx + 17, 89], fill=(255, 200, 100, 34))
            im.alpha_composite(glow)
            d = draw(im)
        d.rectangle([lx - 8, 52, lx + 8, 54], fill=gold)
        d.rectangle([lx - 9, 55, lx + 9, 82], fill=red)
        d.rectangle([lx - 6, 57, lx + 6, 80], fill=body)
        for gx in (lx - 3, lx + 3):
            d.line([gx, 57, gx, 80], fill=red_d if not day else red)
        d.rectangle([lx - 8, 83, lx + 8, 85], fill=gold)
        d.line([lx, 86, lx, 94], fill=red_l)
        d.line([lx - 2, 92, lx + 2, 92], fill=red_l)
    # 夜里四角压暗（硬边台阶式暗角，不糊）
    if not day:
        vig = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        vd = draw(vig)
        for i, a in enumerate((60, 40, 22)):
            m = 6 + i * 10
            vd.rectangle([0, 0, W, m], fill=(0, 0, 8, a))
            vd.rectangle([0, H - m, W, H], fill=(0, 0, 8, a))
            vd.rectangle([0, 0, m, H], fill=(0, 0, 8, a))
            vd.rectangle([W - m, 0, W, H], fill=(0, 0, 8, a))
        im.alpha_composite(vig)
    return im.convert("RGB").convert("RGBA")


# ======================================================================
# 皇牌（41×57）：在大王 J1 的基础上换金色画框、头上加皇冠、右上角加小皇冠
# ======================================================================

CROWN_S = [  # 11×8 小皇冠
    "..X...X...X",
    ".XYX.XYX.XY",
    "..X...X...X",
    "X.X.X.X.X.X",
    "XYYYYYYYYYX",
    "XYRYYBYYRYX",
    "XYYYYYYYYYX",
    "XXXXXXXXXXX",
]
CROWN_M = [  # 15×11 皇冠
    ".......Y.......",
    "Y.....YRY.....Y",
    "YY.....Y.....YY",
    "YYY...YYY...YYY",
    "YYYY.YYYYY.YYYY",
    "YYYYYYYYYYYYYYY",
    "YLLLLLLLLLLLLLY",
    "YYRYYYBYBYYYRYY",
    "YYYYYYYYYYYYYYY",
    "YDDDDDDDDDDDDDY",
    "YYYYYYYYYYYYYYY",
]


def sprite(rows: list[str], colors: dict[str, tuple]) -> Image.Image:
    w, h = max(len(r) for r in rows), len(rows)
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = im.load()
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch in colors:
                px[x, y] = colors[ch] + (255,)
    return im


CROWN_COLORS = {"X": PAL["gold"], "Y": PAL["gold"], "L": PAL["gold_l"], "D": PAL["gold_d"],
                "R": (210, 40, 40), "B": (60, 120, 220)}


def card_huang() -> Image.Image:
    base = Image.open(CARDS / "J1.png").convert("RGBA")
    px = base.load()
    w, h = base.size
    # 画框里的粉底 → 淡金；框线红 → 金
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            if abs(r - 240) < 18 and abs(g - 214) < 22 and abs(b - 214) < 22 and r > g + 10:
                px[x, y] = (246, 212, 110, 255)
            elif (r, g, b) == (200, 44, 54) and x >= 8:  # 画框的红线（左边 JOKER 字母不动）
                px[x, y] = (176, 120, 30, 255)
    # 头顶加皇冠（盖住小丑帽的中间）
    crown = outline(sprite(CROWN_M, CROWN_COLORS))
    # 找画框位置：粉底变成的淡金区域的包围盒
    ys = [y for y in range(h) for x in range(w) if px[x, y][:3] == (246, 212, 110)]
    xs = [x for y in range(h) for x in range(w) if px[x, y][:3] == (246, 212, 110)]
    fx0, fx1, fy0 = min(xs), max(xs), min(ys)
    base.alpha_composite(crown, ((fx0 + fx1) // 2 - crown.width // 2 + 1, fy0 - 2))
    # 右上角小皇冠（手牌按点数叠成一列时只露出上沿，靠它认出皇牌）
    small = sprite(CROWN_S, {"X": (176, 120, 30), "Y": PAL["gold"], "R": (210, 40, 40), "B": (60, 120, 220)})
    base.alpha_composite(small, (w - small.width - 3, 2))
    return base


# ======================================================================
# 身份标记（32×32 透明）、牌上小标记（16×16）
# ======================================================================

def role_emperor() -> Image.Image:
    im = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    c = sprite(CROWN_M, CROWN_COLORS).resize((30, 22), Image.NEAREST)
    im.alpha_composite(c, (1, 6))
    return outline(im)


def role_guard() -> Image.Image:
    """侍卫：盾牌（蓝底金边，中间一把竖剑）。"""
    im = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    d = draw(im)
    # 盾形：上方方，下方收尖
    for y in range(3, 30):
        if y < 18:
            x0, x1 = 5, 26
        else:
            k = (y - 18)
            x0, x1 = 5 + k, 26 - k
        if x0 > x1:
            break
        d.line([x0, y, x1, y], fill=PAL["gold"])
        if x1 - x0 > 4 and 4 < y < 28:
            d.line([x0 + 2, y, x1 - 2, y], fill=PAL["blue"] if y < 16 else PAL["blue_d"])
    d.line([15, 6, 15, 25], fill=PAL["white"])   # 剑身
    d.line([16, 6, 16, 25], fill=PAL["silver"])
    d.rectangle([11, 18, 20, 19], fill=PAL["gold_l"])  # 护手
    d.rectangle([15, 20, 16, 23], fill=PAL["gold_d"])  # 柄
    return outline(im)


def role_rebel() -> Image.Image:
    """革命党 / 造反：一面飘动的旗（没有任何图案，避免像国旗）+ 旗杆。"""
    im = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    d = draw(im)
    d.rectangle([6, 3, 7, 29], fill=(150, 104, 62))
    d.rectangle([5, 2, 8, 3], fill=PAL["gold"])
    for x in range(8, 28):
        wave = int(round(2 * math.sin((x - 8) / 19 * math.pi * 1.6)))
        d.line([x, 5 + wave, x, 18 + wave], fill=PAL["rebel"])
        d.point((x, 18 + wave), fill=PAL["rebel_d"])
        if x % 5 == 0:
            d.line([x, 6 + wave, x, 17 + wave], fill=(232, 112, 74))
    return outline(im)


def seal(size: int, char: str, color=PAL["red"]) -> Image.Image:
    """方形印章，白字。size 24 时字是 12px 一格。"""
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = draw(im)
    d.rectangle([1, 1, size - 2, size - 2], fill=color)
    d.rectangle([3, 3, size - 4, size - 4], outline=PAL["cream"])
    text_center(im, size // 2, size // 2, char, PAL["cream"])
    return outline(im)


def role_solo() -> Image.Image:
    im = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    s = seal(24, "独", (176, 30, 36))
    im.alpha_composite(s, (4, 4))
    return im


def mark(char: str, fill, edge) -> Image.Image:
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = draw(im)
    d.rectangle([0, 0, 15, 15], fill=edge)
    d.rectangle([1, 1, 14, 14], fill=fill)
    text_center(im, 8, 8, char, PAL["white"])
    return im


# ======================================================================
# 名次徽章（40×20）
# ======================================================================

RANKS = [("头科", PAL["gold"], (120, 80, 20)), ("二科", PAL["silver"], (70, 76, 90)),
         ("三科", PAL["bronze"], (100, 56, 26)), ("二落", (96, 112, 150), (40, 48, 70)),
         ("大落", (82, 74, 86), (34, 28, 36))]


def rank_badge(label: str, fill, dark) -> Image.Image:
    im = Image.new("RGBA", (40, 20), (0, 0, 0, 0))
    d = draw(im)
    # 两端切角的牌匾
    d.rectangle([2, 0, 37, 19], fill=PAL["ink"])
    d.rectangle([0, 2, 39, 17], fill=PAL["ink"])
    d.rectangle([2, 1, 37, 18], fill=fill)
    d.rectangle([1, 3, 38, 16], fill=fill)
    d.line([3, 2, 36, 2], fill=tuple(min(255, c + 40) for c in fill))
    d.line([3, 17, 36, 17], fill=dark)
    light = sum(fill) > 420
    text_center(im, 20, 10, label, PAL["ink"] if light else PAL["white"])
    return im


# ======================================================================
# 叫保展示框（145×71，中间透明放 3 张 1 倍牌）、保牌小底框（53×69）
# ======================================================================

def frame(w: int, h: int, border: int) -> Image.Image:
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = draw(im)
    d.rectangle([0, 0, w - 1, h - 1], fill=PAL["ink"])
    d.rectangle([1, 1, w - 2, h - 2], fill=PAL["gold_d"])
    d.rectangle([2, 2, w - 3, h - 3], fill=PAL["red_d"])
    d.rectangle([3, 3, w - 4, h - 4], fill=PAL["red"])
    d.rectangle([border - 2, border - 2, w - border + 1, h - border + 1], fill=PAL["gold"])
    d.rectangle([border - 1, border - 1, w - border, h - border], fill=PAL["ink"])
    d.rectangle([border, border, w - border - 1, h - border - 1], fill=(0, 0, 0, 0))
    # 四角金云钉
    for cx, cy in ((3, 3), (w - 4, 3), (3, h - 4), (w - 4, h - 4)):
        d.rectangle([cx - 1, cy - 1, cx + 1, cy + 1], fill=PAL["gold_l"])
    # 边上的回纹点
    for x in range(border + 4, w - border - 4, 6):
        d.point((x, border // 2), fill=PAL["gold"])
        d.point((x, h - 1 - border // 2), fill=PAL["gold"])
    return im


def bao_show() -> Image.Image:
    im = frame(145, 71, 7)
    d = draw(im)
    # 三张牌之间的金色隔条（牌 41 宽，间隔 5）
    for gx in (7 + 41, 7 + 41 + 5 + 41):
        d.rectangle([gx, 7, gx + 4, 63], fill=PAL["red_d"])
        d.rectangle([gx + 2, 7, gx + 2, 63], fill=PAL["gold_d"])
    # 顶上正中一个小皇冠
    c = outline(sprite(CROWN_S, CROWN_COLORS))
    im.alpha_composite(c, (145 // 2 - c.width // 2, 0))
    return im


def bao_tag() -> Image.Image:
    im = frame(53, 69, 6)
    s = mark("保", PAL["blue"], PAL["ink"])
    im.alpha_composite(s, (53 - 16, 69 - 16))
    return im


# ======================================================================
# 座位头像（40×40，不透明）：座位色边框 + 深底 + 宫廷小物件
# ======================================================================

def avatar(i: int) -> Image.Image:
    col = SEATS[i]
    im = Image.new("RGBA", (40, 40), PAL["ink"] + (255,))
    d = draw(im)
    d.rectangle([1, 1, 38, 38], fill=col)
    d.rectangle([3, 3, 36, 36], fill=PAL["night1"])
    d.rectangle([3, 3, 36, 5], fill=PAL["night2"])
    dark = tuple(int(c * 0.55) for c in col)
    if i == 0:   # 宫灯
        d.line([20, 6, 20, 10], fill=PAL["gold_d"])
        d.rectangle([13, 10, 27, 11], fill=PAL["gold"])
        d.rectangle([12, 12, 28, 28], fill=col)
        d.rectangle([14, 13, 26, 27], fill=tuple(min(255, c + 50) for c in col))
        for x in (17, 23):
            d.line([x, 12, x, 28], fill=dark)
        d.rectangle([13, 29, 27, 30], fill=PAL["gold"])
        d.line([20, 31, 20, 35], fill=col)
    elif i == 1:  # 折扇
        d.pieslice([6, 8, 34, 36], 200, 340, fill=col)
        d.pieslice([14, 16, 26, 28], 200, 340, fill=PAL["night1"])
        for a in range(205, 340, 15):
            r = math.radians(a)
            d.line([20, 22, 20 + 14 * math.cos(r), 22 + 14 * math.sin(r)], fill=dark)
        d.rectangle([19, 21, 21, 33], fill=PAL["gold_d"])
    elif i == 2:  # 盖碗茶
        d.ellipse([10, 9, 30, 15], fill=col)
        d.rectangle([18, 7, 22, 9], fill=col)
        d.polygon([(9, 15), (31, 15), (27, 27), (13, 27)], fill=tuple(min(255, c + 40) for c in col))
        d.line([12, 19, 28, 19], fill=dark)
        d.ellipse([7, 27, 33, 32], fill=col)
    elif i == 3:  # 祥云
        for box in ([7, 16, 19, 28], [15, 10, 29, 24], [23, 16, 34, 27], [11, 20, 31, 30]):
            d.ellipse(box, fill=col)
        d.arc([16, 14, 26, 24], 180, 360, fill=dark)
        d.arc([12, 21, 20, 29], 90, 270, fill=dark)
    else:         # 铜钱
        d.ellipse([7, 7, 33, 33], fill=col)
        d.ellipse([10, 10, 30, 30], outline=dark)
        d.rectangle([16, 16, 24, 24], fill=PAL["night1"])
        d.rectangle([15, 15, 25, 25], outline=dark)
    return im


# ======================================================================
# 特效（横排精灵图，每帧 64×64 透明）
# ======================================================================

def sparkles(im: Image.Image, frame_i: int, n_frames: int, color=PAL["gold_l"]) -> None:
    d = draw(im)
    for k in range(6):
        a = (k / 6 + frame_i / n_frames / 6) * 2 * math.pi
        r = 26 if k % 2 == 0 else 22
        x, y = 32 + r * math.cos(a), 32 + r * math.sin(a)
        size = 2 if (k + frame_i) % 2 == 0 else 1
        x, y = int(round(x)), int(round(y))
        for ox, oy in ((-1, 0), (1, 0), (0, -1), (0, 1)):  # 深色描边，白天底上也看得见
            d.line([x - size + ox, y + oy, x + size + ox, y + oy], fill=PAL["ink"])
            d.line([x + ox, y - size + oy, x + ox, y + size + oy], fill=PAL["ink"])
        d.line([x - size, y, x + size, y], fill=color)
        d.line([x, y - size, x, y + size], fill=color)


def fx_strip(icon: Image.Image, frames: int = 4, bob: bool = True, color=PAL["gold_l"]) -> Image.Image:
    strip = Image.new("RGBA", (64 * frames, 64), (0, 0, 0, 0))
    big = icon.resize((48, 48), Image.NEAREST)
    for f in range(frames):
        fr = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        dy = [0, -1, -2, -1][f % 4] if bob else 0
        fr.alpha_composite(big, (8, 8 + dy))
        sparkles(fr, f, frames, color)
        strip.alpha_composite(fr, (64 * f, 0))
    return strip


def fx_flag() -> Image.Image:
    """造反成功：旗帜飘动 4 帧。"""
    strip = Image.new("RGBA", (64 * 4, 64), (0, 0, 0, 0))
    for f in range(4):
        im = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        d = draw(im)
        d.rectangle([14, 8, 17, 58], fill=(150, 104, 62))
        d.rectangle([12, 6, 19, 8], fill=PAL["gold"])
        for x in range(18, 56):
            phase = f / 4 * 2 * math.pi
            wave = int(round(3 * math.sin((x - 18) / 38 * math.pi * 2 - phase) * (x - 18) / 38))
            d.line([x, 11 + wave, x, 36 + wave], fill=PAL["rebel"])
            d.point((x, 36 + wave), fill=PAL["rebel_d"])
            if (x - f * 2) % 9 < 2:
                d.line([x, 12 + wave, x, 35 + wave], fill=(232, 112, 74))
        strip.alpha_composite(outline(im), (64 * f, 0))
    return strip


# ======================================================================
# 结算装饰、皇帝座位冠饰、网站图标
# ======================================================================

def ribbon(win: bool) -> Image.Image:
    w, h = 160, 32
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = draw(im)
    main = PAL["red"] if win else (70, 80, 104)
    dark = PAL["red_d"] if win else (40, 46, 62)
    edge = PAL["gold"] if win else PAL["silver"]
    # 两端燕尾
    d.polygon([(0, 8), (22, 8), (22, 30), (0, 30), (7, 19)], fill=dark)
    d.polygon([(w - 1, 8), (w - 23, 8), (w - 23, 30), (w - 1, 30), (w - 8, 19)], fill=dark)
    d.rectangle([14, 2, w - 15, 25], fill=main)
    d.line([14, 4, w - 15, 4], fill=edge)
    d.line([14, 23, w - 15, 23], fill=edge)
    d.polygon([(14, 26), (22, 26), (22, 30)], fill=PAL["ink"])
    d.polygon([(w - 15, 26), (w - 23, 26), (w - 23, 30)], fill=PAL["ink"])
    for x in range(20, w - 20, 10):
        d.point((x, 6), fill=edge)
        d.point((x, 21), fill=edge)
    return outline(im)


def seat_crest() -> Image.Image:
    """皇帝座位顶上的金色冠饰（48×16）：中间小皇冠，两边卷云。"""
    im = Image.new("RGBA", (48, 16), (0, 0, 0, 0))
    d = draw(im)
    d.rectangle([4, 11, 43, 13], fill=PAL["gold"])
    d.line([4, 14, 43, 14], fill=PAL["gold_d"])
    for cx in (9, 38):
        d.arc([cx - 5, 5, cx + 5, 15], 180, 360, fill=PAL["gold"])
        d.arc([cx - 3, 7, cx + 3, 13], 0, 180, fill=PAL["gold_d"])
    c = sprite(CROWN_S, CROWN_COLORS)
    im.alpha_composite(c, (24 - c.width // 2, 2))
    return outline(im)


def icon() -> Image.Image:
    im = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    d = draw(im)
    d.rectangle([0, 2, 31, 29], fill=PAL["ink"])
    d.rectangle([2, 0, 29, 31], fill=PAL["ink"])
    d.rectangle([2, 2, 29, 29], fill=PAL["red"])
    big = outline(sprite(CROWN_M, CROWN_COLORS).resize((22, 16), Image.NEAREST))
    im.alpha_composite(big, (16 - big.width // 2, 16 - big.height // 2))
    return im


# ======================================================================

def build() -> None:
    save(scene(False), "scene-night.png")
    save(scene(True), "scene-day.png")
    save(card_huang(), "card-huang.png")
    save(role_emperor(), "role-emperor.png")
    save(role_guard(), "role-guard.png")
    save(role_rebel(), "role-rebel.png")
    save(role_solo(), "role-solo.png")
    save(mark("保", PAL["blue"], PAL["ink"]), "mark-bao.png")
    save(mark("特", (150, 60, 200), PAL["ink"]), "mark-tehua.png")
    for i, (label, fill, dark) in enumerate(RANKS, start=1):
        save(rank_badge(label, fill, dark), f"rank-{i}.png")
    save(bao_show(), "bao-show.png")
    save(bao_tag(), "bao-tag.png")
    for i in range(5):
        save(avatar(i), f"avatar-{i}.png")
    save(fx_strip(role_emperor()), "fx-crown.png")
    save(fx_strip(role_guard(), color=(190, 225, 255)), "fx-guard.png")
    save(fx_flag(), "fx-rebel.png")
    save(fx_strip(role_solo(), bob=False), "fx-solo.png")
    save(ribbon(True), "result-win.png")
    save(ribbon(False), "result-lose.png")
    save(seat_crest(), "seat-crest.png")
    save(icon(), "icon.png")


def preview() -> None:
    """把每张图按 spec 的显示倍数放大，拼在两种底色上，存到 art/out/simple-preview/。"""
    import json
    spec = json.loads((ROOT / "art" / "simple-scales.json").read_text())
    dest = ROOT / "art" / "out" / "simple-preview"
    dest.mkdir(parents=True, exist_ok=True)
    for theme, bg in (("night", (22, 26, 44)), ("day", (244, 238, 226))):
        tiles = []
        for name, scale in spec.items():
            im = Image.open(OUT / name).convert("RGBA")
            tiles.append(im.resize((im.width * scale, im.height * scale), Image.NEAREST))
        W = 1440
        x = y = 8
        row_h = 0
        placed = []
        for t in tiles:
            if x + t.width > W - 8:
                x, y = 8, y + row_h + 8
                row_h = 0
            placed.append((t, x, y))
            x += t.width + 8
            row_h = max(row_h, t.height)
        canvas = Image.new("RGBA", (W, y + row_h + 8), bg + (255,))
        for t, x, y in placed:
            canvas.alpha_composite(t, (x, y))
        canvas.save(dest / f"sheet-{theme}.png")
        print("preview", dest / f"sheet-{theme}.png")


if __name__ == "__main__":
    build()
    if "--preview" in sys.argv:
        preview()
