"""保皇 美术画廊：把 art/out/variants/ 里每样的定稿（pick）和备选（altN）拼成「上夜间底、下白天底」的预览图，
写成不阻塞的拍板 JSON：~/projects/pipeline/games/baohuang/assets/gallery-decision.json（由制作人 gpipe ask 发布）。
先跑 python art/export.py --variants，再跑 python art/gallery.py。"""
from __future__ import annotations

import json
import pathlib

from PIL import Image

ART = pathlib.Path(__file__).resolve().parent
VAR = ART / "out" / "variants"
GAL = ART / "out" / "gallery"
OUT = pathlib.Path.home() / "projects/pipeline/games/baohuang/assets/gallery-decision.json"
NIGHT, DAY = (13, 24, 45), (228, 207, 165)

# 文件名: (题目, 推荐理由, [备选说明...])
ITEMS = {
    "scene-night": ("夜间牌桌背景（scene-night.png，512×288，整数倍盖满）",
                    "和开工样张同一构图：空龙椅在殿后正中、宫灯点亮、前景圆桌；青绿彩画额枋最完整，和白天版是同一种子配对",
                    ["种子 51：宝座更大更亮，前景桌偏小", "大圆桌铺红布在殿中央（b 版）", "种子 23：宫灯偏少、画面偏暗"]),
    "scene-day": ("白天牌桌背景（scene-day.png，512×288）",
                  "和夜间定稿同一种子，构图几乎一样（同一座殿的白天），花窗斜射阳光，米黄赭色",
                  ["种子 51", "大圆桌铺红布（b 版）", "种子 37"]),
    "card-huang": ("皇牌（card-huang.png，41×57，和手牌同倍）",
                   "保留大王的小丑和左边 JOKER 红字（一看就是大王），小丑戴金冠、画框改金底，右上角小皇冠，叠成一列只露上沿也认得出",
                   ["小丑戴冠 49", "小丑戴冠 15（偏胖）", "红垫上的金冠（不像大王了）"]),
    "role-emperor": ("皇帝标记（role-emperor.png，32×32，2 倍）",
                     "五尖金冠、红蓝宝石，和登基特效、网站图标同一顶冠，缩到 64px 最清楚",
                     ["红丝绒内衬的金冠", "多宝石金冠", "冕旒（中式，但 32px 下像灯）"]),
    "role-guard": ("侍卫标记（role-guard.png，32×32）", "蓝盾竖剑，盾面没有纹章（避免像国徽），和侍卫特效同一造型",
                   ["窄盾", "剑压在盾前", "剑偏左"]),
    "role-rebel": ("革命党标记（role-rebel.png，32×32）", "三角红旗金边、长矛旗杆，没有任何图案，不会像国旗；和造反特效同一面旗",
                   ["旗面更长", "旗面带褶", "旗杆更斜"]),
    "role-solo": ("独保标记（role-solo.png，32×32）", "PixelLab 的朱红印章、金色内框，「独」字用像素字体代码写（白文），2 倍下字 24px",
                  ["无内框、印泥纹理粗", "暗红印面", "多重框线"]),
    "bao-show": ("叫保展示框（bao-show.png，145×71，三张牌位置按 spec）",
                 "金漆雕花框、上下有卷草冠饰，左右镜像对称，牌位按 spec 挖透明；比红框素净，不抢三张牌",
                 ["朱红描金 + 顶上小冠", "接近简洁版"]),
    "bao-tag": ("保牌种类小底框（bao-tag.png，53×69）", "红漆洒金的边框最有质感，右下角「保」是代码画的标记",
                ["红漆金线", "金边偏亮"]),
    "avatar-0": ("座位 0 头像（橙框 · 宫灯）", "六角宫灯点亮，和场景里的灯同款", ["宫灯 1", "宫灯 13", "宫灯 57"]),
    "avatar-1": ("座位 1 头像（天蓝框 · 折扇）", "展开的素面折扇，扇面没有字画", ["折扇 9", "折扇 49", "折扇 62"]),
    "avatar-2": ("座位 2 头像（蓝绿框 · 盖碗茶）", "青花盖碗带热气，最好认", ["盖碗 5", "盖碗 9", "盖碗 13"]),
    "avatar-3": ("座位 3 头像（紫红框 · 祥云）", "粉色祥云，卷纹清楚", ["祥云 12", "祥云 19", "祥云 0"]),
    "avatar-4": ("座位 4 头像（银白框 · 铜钱）", "外圆内方的铜钱，钱面没有字", ["铜钱 12", "铜钱 19", "铜钱 35"]),
    "fx-crown": ("登基特效（fx-crown.png，4 帧 × 64，steps(4)）",
                 "PixelLab 动画（冠上闪光）+ 代码加的上下浮动和绕圈星点；首帧就是静态皇冠，循环无缝",
                 ["动画种子 2（不加浮动和星点）", "动画种子 3（不加浮动和星点）", "纯代码浮动 + 星点"]),
    "fx-guard": ("侍卫公开特效（fx-guard.png）", "PixelLab 动画（剑上闪光）+ 代码浮动和白色星点",
                 ["动画种子 2（不加浮动和星点）", "动画种子 3（不加浮动和星点）", "纯代码浮动 + 星点"]),
    "fx-rebel": ("造反特效（fx-rebel.png）", "PixelLab 的旗，代码按列做波浪飘动（PixelLab 的 3 个动画种子旗面几乎不动）",
                 ["动画种子 1（几乎不动）", "动画种子 2（几乎不动）", "动画种子 3（几乎不动）"]),
    "result-win": ("结算横幅·胜（result-win.png，160×32，字由界面叠上）", "朱红绸带带褶皱和金边、燕尾；绸面右边一块像字的污点已用左边纹理盖掉",
                   ["亮红渐变（不太像像素画）", "亮红渐变 2"]),
    "result-lose": ("结算横幅·负（result-lose.png，160×32）", "灰蓝绸带、银边，和胜利横幅同一造型", ["金属感灰蓝", "带褶灰蓝"]),
    "seat-crest": ("皇帝座位冠饰（seat-crest.png，48×16）", "PixelLab 小金冠 + 两边金色祥云卷（左右镜像）", ["冠 25 + 云 10", "冠 1 + 云 0", "冠 33 + 云 18"]),
    "icon": ("网站图标（icon.png，32×32）", "红底上放皇帝标记同一顶金冠", ["另一顶冠", "小一号的冠"]),
}


def panel(path: pathlib.Path, scale: int) -> Image.Image:
    im = Image.open(path).convert("RGBA")
    big = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
    pad = 12
    can = Image.new("RGB", (big.width + 2 * pad + im.width + pad, (big.height + 2 * pad) * 2))
    for k, bg in enumerate((NIGHT, DAY)):
        y = k * (big.height + 2 * pad)
        can.paste(bg, (0, y, can.width, y + big.height + 2 * pad))
        can.paste(big, (pad, y + pad), big)
        can.paste(im, (big.width + 2 * pad, y + pad), im)  # 右边 1× 原大
    return can


def main() -> None:
    GAL.mkdir(parents=True, exist_ok=True)
    questions = []
    for name, (q, why, alts) in ITEMS.items():
        folder = VAR / name
        opts = []
        files = [("pick", why, True)] + [(f"alt{i + 1}", d, False) for i, d in enumerate(alts)]
        for key, desc, rec in files:
            src = folder / f"{key}.png"
            if not src.exists():
                continue
            if name.startswith("scene"):
                img = src
            else:
                w = Image.open(src).width
                scale = 2 if w >= 145 else (3 if w > 48 else 4)
                img = GAL / f"{name}-{key}.png"
                panel(src, scale).save(img)
            opt = {"value": f"{name}-{key}", "label": "我挑的" if rec else f"备选 {key[3:]}",
                   "images": [str(img)], "description": desc}
            if rec:
                opt["recommended"] = True
            opts.append(opt)
        questions.append({"id": name, "type": "choice", "question": q, "options": opts, "allowOther": True, "required": False})
    covers = [("covers/cover-hall-892.png", "殿内近景：空龙椅、金屏风上的小龙、台阶上红垫托着金冠，暖金灯光。最贴题、没有字、没有人", True),
              ("covers/cover-scene-11.png", "和牌桌夜间背景同一张图裁的，进游戏前后一致", False),
              ("covers/cover-gate-805.png", "宫门夜景、两排红灯笼，喜庆但和牌桌无关", False),
              ("covers/cover-crown-804.png", "牌桌上的金冠和几张牌，偏暗偏红", False)]
    questions.append({"id": "cover", "type": "choice", "question": "大厅封面（384×192）", "allowOther": True, "required": False,
                      "options": [{"value": pathlib.Path(p).stem, "label": "我挑的" if r else "备选", "images": [str(ART / "out" / p)],
                                   "description": d, **({"recommended": True} if r else {})} for p, d, r in covers]})
    data = {
        "id": "art-gallery", "title": "保皇：美术画廊（可随时换图）", "stage": "art", "blocking": False,
        "intro": ("保皇正式美术（PixelLab，金銮殿）。每样我已经挑定一张（标「推荐」），按 spec 导出到 `art/out/final/`；"
                  "你想换哪张随时选，不选就按推荐。小图每张上半是夜间底、下半是白天底，右边是 1× 原大。"
                  "「保」「特」、名次徽章、「独」字是代码画的像素字（不让模型写字），不在这里选。"),
        "questions": questions,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    print("写好", OUT, len(questions), "题")


if __name__ == "__main__":
    main()
