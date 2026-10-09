"""简洁版自查：把图按 spec 的显示倍数摆成一张假牌桌（不是真界面，只看大小和清晰度）。输出 art/out/simple-preview/mock-*.png"""
import pathlib, sys
from PIL import Image, ImageDraw
ROOT = pathlib.Path(__file__).resolve().parent.parent
A = ROOT / "apps/web/public/art"; C = ROOT / "apps/web/public/cards-pixel"; OUT = ROOT / "art/out/simple-preview"
sys.path.insert(0, str(ROOT / "art")); import simple

def img(p, s): im = Image.open(p).convert("RGBA"); return im.resize((im.width * s, im.height * s), Image.NEAREST)

def mock(theme, W, H, hs, ps, ui):
    sc = Image.open(A / f"scene-{theme}.png").convert("RGBA")
    k = max(1, -(-max(W / 512, H / 288) // 1)); k = int(k)
    can = sc.resize((512 * k, 288 * k), Image.NEAREST).crop((0, 0, W, H))
    panel = (16, 20, 36, 230) if theme == "night" else (250, 244, 232, 235)
    fg = (240, 230, 210) if theme == "night" else (40, 30, 30)
    seats = [(W // 2, H - 200 * ui // 2), (W - 160 * ui // 2, H // 2), (W - 260 * ui // 2, 70 * ui // 2), (260 * ui // 2, 70 * ui // 2), (160 * ui // 2, H // 2)]
    roles = ["role-emperor", "role-guard", "role-rebel", "role-solo", None]
    for i, (x, y) in enumerate(seats[1:], start=1):
        box = Image.new("RGBA", (200 * ui // 2, 96 * ui // 2), panel); can.alpha_composite(box, (x - 100 * ui // 2, y - 40))
        av = img(A / f"avatar-{i}.png", ui); can.alpha_composite(av, (x - 96 * ui // 2, y - 32))
        if i == 2: can.alpha_composite(img(A / "seat-crest.png", ui), (x - 96 * ui // 2 - 8 * ui, y - 32 - 16 * ui))
        if roles[i - 1]: can.alpha_composite(img(A / f"{roles[i-1]}.png", ui), (x - 96 * ui // 2 + 40 * ui - 16 * ui, y - 32 - 12 * ui))
        can.alpha_composite(img(A / f"rank-{i}.png", ui), (x - 96 * ui // 2 + 44 * ui, y - 24))
        d = simple.draw(can); simple.text(can, (x - 96 * ui // 2 + 44 * ui, y + 24), "玩家" + str(i), fg)
    # 中间：叫保展示（2 倍框 + 2 倍牌）
    show = img(A / "bao-show.png", ps); bx, by = W // 2 - show.width // 2, H // 2 - show.height // 2 - 40 * ui // 2
    can.alpha_composite(show, (bx, by))
    for j in range(3): can.alpha_composite(img(C / "H9.png", ps), (bx + (7 + j * 46) * ps, by + 7 * ps))
    can.alpha_composite(img(A / "bao-tag.png", 1), (bx + show.width + 12, by))
    can.alpha_composite(img(C / "H9.png", 1), (bx + show.width + 12 + 6, by + 6))
    # 自己手牌：按点数分列叠放，每列错开 14 原始像素
    cols = [["S6", "H6"], ["D7"], ["H9", "C9", "S9"], ["Sj", "Dj"], ["Hq"], ["Ca", "Ha", "Sa", "Da"], ["S2", "H2"], ["J2"], ["J1", "HUANG"]]
    colw = 41 * hs + 6 * ui // 2; x0 = W // 2 - len(cols) * colw // 2; ybase = H - (57 + 14 * 3) * hs - 8
    for ci, col in enumerate(cols):
        for ri, cid in enumerate(col):
            card = img(A / "card-huang.png", hs) if cid == "HUANG" else img(C / f"{cid}.png", hs)
            cx, cy = x0 + ci * colw, ybase + ri * 14 * hs
            can.alpha_composite(card, (cx, cy))
            if cid == "H9": can.alpha_composite(img(A / "mark-bao.png", hs // 1 if hs < 3 else 2), (cx + 41 * hs - 16 * (2 if hs >= 3 else hs) - 2, cy + 2))
    can.alpha_composite(img(A / "fx-crown.png", 2).crop((0, 0, 128, 128)), (W // 2 + 180 * ui // 2, H // 2 - 200 * ui // 2))
    can.convert("RGB").save(OUT / f"mock-{theme}-{W}.png"); print(OUT / f"mock-{theme}-{W}.png")

mock("night", 1440, 790, 3, 2, 2); mock("day", 1440, 790, 3, 2, 2); mock("night", 390, 664, 2, 1, 1)
