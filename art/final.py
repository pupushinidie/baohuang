"""保皇 正式美术定稿导出：按 art/selection.json 选中的候选，照 art/spec.md 的文件名、尺寸、帧数写到 art/out/final/
（目录结构和 apps/web/public/art/ 一样；换进界面由开发 agent 复制，这里不碰 public）。

PixelLab 出的是图形本身；需要准确的东西（「独」「保」「特」名次字、透明窗口位置、座位色外框）都用代码画。
用法：
  python art/final.py            按 selection.json 导出全部定稿
  python art/final.py variants   把每样的候选都按定稿规则做一遍，放 art/out/variants/（画廊和自查用）
"""
from __future__ import annotations

import json
import math
import pathlib
import shutil
import sys

from PIL import Image, ImageDraw

ART = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(ART))
import sheet  # noqa: E402
import simple  # noqa: E402
from simple import PAL, SEATS, outline, draw  # noqa: E402

ROOT = ART.parent
CARDS = ROOT / "apps" / "web" / "public" / "cards-pixel"
OUT = ART / "out" / "final"
VAR = ART / "out" / "variants"
SEL = json.loads((ART / "selection.json").read_text()) if (ART / "selection.json").exists() else {}


def load(spec: str) -> Image.Image:
    """'emperor:2' → r1 v2 候选；'r2/crown16:5' → r2 v2；路径（相对 art/out）→ 那张图。"""
    if ":" in spec and not spec.endswith(".png"):
        return Image.open(sheet.v2path(spec)).convert("RGBA")
    if spec.startswith("simple/"):  # 简洁版原图（代码画的文字标记沿用）
        return Image.open(ART / spec).convert("RGBA")
    return Image.open(ART / "out" / spec).convert("RGBA")


def trim(im: Image.Image) -> Image.Image:
    return im.crop(im.getchannel("A").getbbox())


def center(im: Image.Image, w: int, h: int, dx: int = 0, dy: int = 0) -> Image.Image:
    im = trim(im)
    can = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    can.alpha_composite(im, ((w - im.width) // 2 + dx, (h - im.height) // 2 + dy))
    return can


def harden(im: Image.Image) -> Image.Image:
    """alpha 只留 0 / 255（像素图不要半透明毛边）。"""
    a = im.getchannel("A").point(lambda v: 255 if v >= 128 else 0)
    im = im.copy()
    im.putalpha(a)
    return im


# ---------------------------------------------------------------- 身份标记 32×32
def role(spec: str) -> Image.Image:
    return harden(center(load(spec), 32, 32))


def big_char(ch: str, color, scale: int = 2) -> Image.Image:
    """Fusion Pixel 12px 不抗锯齿画一个字，再按整数倍放大（字的笔画像素 = scale 个原始像素）。"""
    im = Image.new("RGBA", (14, 14), (0, 0, 0, 0))
    simple.text_center(im, 7, 7, ch, color)
    im = trim(im)
    return im.resize((im.width * scale, im.height * scale), Image.NEAREST)


def seal_solo(spec: str, scale: int = 2, inset: int = 4, size: int = 32) -> Image.Image:
    """PixelLab 的空白红印章 + 代码画的「独」（米白阳刻的反面：白文）。"""
    base = center(load(spec), size, size)
    # 印面里的浅色噪点（模型画的「印泥不匀」）会和字抢，先抹成印面的红
    bb0 = base.getchannel("A").getbbox()
    px = base.load()
    reds = [px[x, y] for x in range(bb0[0] + 5, bb0[2] - 5) for y in range(bb0[1] + 5, bb0[3] - 5)
            if px[x, y][0] > px[x, y][1] + 60]
    red = sorted(reds, key=lambda c: sum(c[:3]))[len(reds) // 2] if reds else (160, 30, 30, 255)
    for x in range(bb0[0] + inset, bb0[2] - inset):
        for y in range(bb0[1] + inset, bb0[3] - inset):
            r, g, b, a = px[x, y]
            if not a or g > 110 or r - g < 60:  # 空心印章的透明印面也补成红
                px[x, y] = red
    ch = big_char("独", PAL["cream"], scale)
    # 字加 1px 深红描边，压在印面纹理上也清楚
    ring = outline(ch, (110, 18, 20))
    bb = base.getchannel("A").getbbox()
    cx, cy = (bb[0] + bb[2]) // 2, (bb[1] + bb[3]) // 2
    base.alpha_composite(ring, (cx - ring.width // 2, cy - ring.height // 2))
    return harden(base)


# ---------------------------------------------------------------- 皇牌 41×57
WIN = (8, 12, 31, 43)  # J1 画像窗口内部（含）：x 8–31，y 12–43；第 11、44 行是框线


def card_huang(spec: str, field: str = "gold") -> Image.Image:
    base = Image.open(CARDS / "J1.png").convert("RGBA")
    d = ImageDraw.Draw(base)
    x0, y0, x1, y1 = WIN
    # 框线改金色，窗口底改成金色渐变（上亮下暗），像金箔底
    gold_line = (176, 120, 30, 255)
    d.rectangle([x0, y0 - 1, x1, y0 - 1], fill=gold_line)
    d.rectangle([x0, y1 + 1, x1, y1 + 1], fill=gold_line)
    top, bot = ((250, 222, 130), (214, 160, 64)) if field == "gold" else ((176, 42, 40), (110, 22, 24))
    for y in range(y0, y1 + 1):
        t = (y - y0) / (y1 - y0)
        c = tuple(int(top[k] + (bot[k] - top[k]) * t) for k in range(3))
        d.line([x0, y, x1, y], fill=c + (255,))
    # 金底上撒几颗亮点（菱形纹），不抢主体
    for yy in range(y0 + 3, y1, 6):
        for xx in range(x0 + 2 + (yy // 6) % 2 * 3, x1, 6):
            d.point((xx, yy), fill=(255, 240, 190, 255) if field == "gold" else (200, 70, 60, 255))
    art = trim(load(spec))
    if art.width > 24 or art.height > 32:
        art = center(art, 24, 32)
    base.alpha_composite(art, (x0 + (24 - art.width) // 2, y1 + 1 - art.height))
    # 右上角小皇冠：叠成一列只露上沿时靠它认出皇牌（和简洁版同一个位置）
    small = simple.sprite(simple.CROWN_S, {"X": (176, 120, 30), "Y": PAL["gold"], "R": (210, 40, 40), "B": (60, 120, 220)})
    base.alpha_composite(small, (41 - small.width - 3, 2))
    return base


# ---------------------------------------------------------------- 头像 40×40
def avatar(i: int, spec: str) -> Image.Image:
    col = SEATS[i]
    im = Image.new("RGBA", (40, 40), PAL["ink"] + (255,))
    d = draw(im)
    d.rectangle([1, 1, 38, 38], fill=col)
    light = tuple(min(255, c + 60) for c in col)
    dark = tuple(int(c * 0.6) for c in col)
    d.line([1, 1, 38, 1], fill=light)
    d.line([1, 1, 1, 38], fill=light)
    d.line([1, 38, 38, 38], fill=dark)
    d.line([38, 1, 38, 38], fill=dark)
    d.rectangle([3, 3, 36, 36], fill=PAL["ink"])
    # 里面：殿内夜蓝，上方一道暖光（像宫灯照着）
    for y in range(4, 36):
        t = (y - 4) / 31
        c = tuple(int(a + (b - a) * t) for a, b in zip((34, 44, 74), PAL["night0"]))
        d.line([4, y, 35, y], fill=c)
    obj = trim(load(spec))
    im.alpha_composite(obj, (20 - obj.width // 2, 20 - obj.height // 2))
    return im.convert("RGBA")


# ---------------------------------------------------------------- 特效 256×64
def spark(d, x, y, size, color):
    for ox, oy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        d.line([x - size + ox, y + oy, x + size + ox, y + oy], fill=PAL["ink"])
        d.line([x + ox, y - size + oy, x + ox, y + size + oy], fill=PAL["ink"])
    d.line([x - size, y, x + size, y], fill=color)
    d.line([x, y - size, x, y + size], fill=color)


def code_fx(icon: Image.Image, frames: int = 4, color=PAL["gold_l"], bob=(0, -1, -2, -1)) -> Image.Image:
    """代码动画：图标上下浮动 + 六颗星点绕着转。首帧就是静态图居中。"""
    strip = Image.new("RGBA", (64 * frames, 64), (0, 0, 0, 0))
    icon = trim(icon)
    for f in range(frames):
        fr = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        fr.alpha_composite(icon, ((64 - icon.width) // 2, (64 - icon.height) // 2 + bob[f % len(bob)]))
        d = draw(fr)
        for k in range(6):
            a = (k / 6 + f / frames / 6) * 2 * math.pi - math.pi / 2
            r = 28 if k % 2 == 0 else 25
            x, y = int(round(32 + r * math.cos(a))), int(round(32 + r * math.sin(a)))
            spark(d, x, y, 2 if (k + f) % 2 == 0 else 1, color)
        strip.alpha_composite(fr, (64 * f, 0))
    return strip


def strip_from_frames(folder: pathlib.Path, first: Image.Image, n: int = 4, sparkle: bool = False, color=PAL["gold_l"],
                      bob=None) -> Image.Image:
    paths = sorted(folder.glob("*-[0-9][0-9].png"))
    frames = [Image.open(p).convert("RGBA") for p in paths][:n]  # 首末帧相同时返回 n+1 帧，去掉末帧
    frames[0] = first
    strip = Image.new("RGBA", (64 * n, 64), (0, 0, 0, 0))
    for f, fr in enumerate(frames):
        fr = harden(fr)
        if bob:  # 模型只画了闪光、没让主体浮动：代码整体上下挪（首帧不挪，循环接得上）
            moved = Image.new("RGBA", fr.size, (0, 0, 0, 0))
            moved.alpha_composite(fr, (0, bob[f % len(bob)]))
            fr = moved
        if sparkle:
            d = draw(fr)
            for k in range(6):
                a = (k / 6 + f / n / 6) * 2 * math.pi - math.pi / 2
                r = 29 if k % 2 == 0 else 26
                x, y = int(round(32 + r * math.cos(a))), int(round(32 + r * math.sin(a)))
                spark(d, x, y, 2 if (k + f) % 2 == 0 else 1, color)
        strip.alpha_composite(fr, (64 * f, 0))
    return strip


# ---------------------------------------------------------------- 网站图标 32×32
def favicon(spec: str) -> Image.Image:
    im = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    d = draw(im)
    d.rectangle([0, 2, 31, 29], fill=PAL["ink"])
    d.rectangle([2, 0, 29, 31], fill=PAL["ink"])
    d.rectangle([1, 1, 30, 30], fill=PAL["ink"])
    d.rectangle([2, 2, 29, 29], fill=PAL["red"])
    d.line([2, 2, 29, 2], fill=PAL["red_l"])
    crown = trim(load(spec))
    if crown.width > 28:
        crown = crown.crop(((crown.width - 28) // 2, 0, (crown.width - 28) // 2 + 28, crown.height))
    im.alpha_composite(crown, (16 - crown.width // 2, 16 - crown.height // 2 + 1))
    return im


if __name__ == "__main__":
    print("见 export.py")


# ---------------------------------------------------------------- 叫保展示框 145×71、保牌小底框 53×69
def cut_windows(im: Image.Image, wins, ink=True) -> Image.Image:
    """把牌位挖成透明（spec 定的位置），牌位四周补 1px 深色内描边，让牌放进去边缘干净。"""
    im = im.copy()
    d = ImageDraw.Draw(im)
    for x, y, w, h in wins:
        if ink:
            d.rectangle([x - 1, y - 1, x + w, y + h], outline=PAL["ink"] + (255,))
        d.rectangle([x, y, x + w - 1, y + h - 1], fill=(0, 0, 0, 0))
    return im


SHOW_WINS = [(7, 7, 41, 57), (53, 7, 41, 57), (99, 7, 41, 57)]
TAG_WIN = [(6, 6, 41, 57)]


def solid_frame(im: Image.Image, wins) -> Image.Image:
    """模型出的框外圈可能有透明缺口：外轮廓内部（牌位以外）一律补实，颜色取最近的不透明像素。"""
    im = im.copy()
    px = im.load()
    w, h = im.size
    inside = lambda x, y: any(wx - 1 <= x <= wx + ww and wy - 1 <= y <= wy + wh for wx, wy, ww, wh in wins)
    for y in range(h):
        for x in range(w):
            if px[x, y][3] == 0 and not inside(x, y):
                # 向左右找最近的不透明像素
                for r in range(1, 6):
                    for xx in (x - r, x + r):
                        if 0 <= xx < w and px[xx, y][3] and not inside(xx, y):
                            px[x, y] = px[xx, y]
                            break
                    else:
                        continue
                    break
    return im


def bao_show(spec: str, off=(1, 0), dividers: bool = False, mirror: bool = True) -> Image.Image:
    src = load(spec)
    im = src.crop((off[0], off[1], off[0] + 145, off[1] + 71))
    im = solid_frame(harden(im), SHOW_WINS)
    if mirror:  # 模型出的框左右不对称（左上金条长、右边发暗）：左半边镜像到右半边，再按 spec 重新挖牌位
        left = im.crop((0, 0, 73, 71))
        im.paste(left.transpose(Image.FLIP_LEFT_RIGHT), (72, 0))
        im.paste(im.crop((48, 6, 53, 65)), (94, 6))  # 第二根隔条照第一根（镜像落不到隔条位置上）
    if dividers:  # 模型的框没有牌位隔条：照简洁版的位置画朱红描金隔条
        d = ImageDraw.Draw(im)
        for gx in (48, 94):
            d.rectangle([gx, 7, gx + 4, 63], fill=PAL["red_d"] + (255,))
            d.rectangle([gx + 1, 7, gx + 3, 63], fill=PAL["red"] + (255,))
            d.line([gx + 2, 8, gx + 2, 62], fill=PAL["gold"] + (255,))
    im = solid_frame(im, SHOW_WINS)
    return cut_windows(im, SHOW_WINS)


def mark_bao() -> Image.Image:
    return Image.open(ART / "simple" / "mark-bao.png").convert("RGBA")


def bao_tag(spec: str, off=(1, 1)) -> Image.Image:
    src = load(spec)
    im = harden(src.crop((off[0], off[1], off[0] + 53, off[1] + 69)))
    im = solid_frame(im, TAG_WIN)
    im = cut_windows(im, TAG_WIN)
    m = mark_bao()
    im.alpha_composite(m, (53 - 16, 69 - 16))
    return im


# ---------------------------------------------------------------- 结算横幅 160×32、皇帝座位冠饰 48×16
def ribbon(spec: str, patch=None) -> Image.Image:
    im = harden(load(spec))
    if patch:  # (x0, x1, y0, y1, 往左借几列)：绸面上有一块像字的污点，用同一行左边的纹理盖掉
        x0, x1, y0, y1, dx = patch
        src = im.crop((x0 - dx, y0, x1 - dx, y1))
        im.paste(src, (x0, y0))
    return center(im, 160, 32) if trim(im).height <= 32 else im


def crest(crown_spec: str, scroll_spec: str) -> Image.Image:
    im = Image.new("RGBA", (48, 16), (0, 0, 0, 0))
    crown = trim(load(crown_spec))
    scroll = trim(load(scroll_spec))  # 卷云头朝左
    if scroll.height > 12:
        scroll = scroll.crop((0, scroll.height - 12, scroll.width, scroll.height))
    right = scroll.transpose(Image.FLIP_LEFT_RIGHT)
    gap = crown.width // 2 - 2
    im.alpha_composite(scroll, (24 - gap - scroll.width, 16 - scroll.height))
    im.alpha_composite(right, (24 + gap, 16 - right.height))
    im.alpha_composite(crown, (24 - crown.width // 2, 16 - crown.height))
    return harden(im)


# ---------------------------------------------------------------- 造反特效：旗面按列做波浪（PixelLab 动画 3 个种子都几乎不动）
POLE = lambda p: p[0] - p[2] < 110 and p[0] < 200 and not (p[0] > 150 and p[1] < 70)  # 棕色旗杆和深色描边


def wave_flag(spec: str, amp: float = 2.6, frames: int = 4) -> Image.Image:
    flag = trim(load(spec))
    W, H = flag.size
    px = flag.load()
    # 每行旗面从第一个「不是旗杆色」的像素开始（金边、红布），左边的是旗杆
    cloth = [[False] * W for _ in range(H)]
    for y in range(H):
        started = False
        for x in range(W):
            p = px[x, y]
            if not p[3]:
                continue
            if not started and x >= 6 and not POLE(p):
                started = True
            cloth[y][x] = started
    x0 = min(x for y in range(H) for x in range(W) if cloth[y][x])
    strip = Image.new("RGBA", (64 * frames, 64), (0, 0, 0, 0))
    ox, oy = (64 - W) // 2, (64 - H) // 2
    for f in range(frames):
        fr = Image.new("RGBA", (W, H + 8), (0, 0, 0, 0))
        fpx = fr.load()
        for y in range(H):  # 先画旗杆
            for x in range(W):
                if px[x, y][3] and not cloth[y][x]:
                    fpx[x, y + 4] = px[x, y]
        for x in range(W):
            t = max(0.0, (x - x0) / max(1, W - 1 - x0))
            dy = round(amp * t * (math.sin(2 * math.pi * (t * 1.1 - f / frames)) - math.sin(2 * math.pi * t * 1.1)))
            for y in range(H):
                if cloth[y][x]:
                    fpx[x, y + 4 + dy] = px[x, y]
        strip.alpha_composite(fr, (64 * f + ox, oy - 4))
    return strip
