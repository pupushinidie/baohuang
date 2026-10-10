"""保皇 正式美术定稿导出：python art/export.py [--variants]
按 art/selection.json 把定稿写到 art/out/final/（同 public/art/ 的文件名和尺寸）、封面写到 art/out/covers/cover-final.png。
--variants：把每样的备选也按同样规则导出到 art/out/variants/<文件名>/，画廊和自查用。"""
from __future__ import annotations

import json
import pathlib
import shutil
import sys

from PIL import Image

import final as F

ART = F.ART
SEL = json.loads((ART / "selection.json").read_text())
SPEC = {  # 文件名: (宽, 高)
    "scene-night.png": (512, 288), "scene-day.png": (512, 288), "card-huang.png": (41, 57),
    **{f"role-{k}.png": (32, 32) for k in ("emperor", "guard", "rebel", "solo")},
    "mark-bao.png": (16, 16), "mark-tehua.png": (16, 16), **{f"rank-{i}.png": (40, 20) for i in range(1, 6)},
    "bao-show.png": (145, 71), "bao-tag.png": (53, 69), **{f"avatar-{i}.png": (40, 40) for i in range(5)},
    **{f"fx-{k}.png": (256, 64) for k in ("crown", "guard", "rebel", "solo")},
    "result-win.png": (160, 32), "result-lose.png": (160, 32), "seat-crest.png": (48, 16), "icon.png": (32, 32),
}


def build(name: str, pick, entry: dict) -> Image.Image:
    if name.startswith("scene-"):
        return Image.open(ART / "out" / pick).convert("RGB")
    if name == "card-huang.png":
        return F.card_huang(pick, entry.get("field", "gold"))
    if name == "role-solo.png":
        return F.seal_solo(pick, 1, 5)
    if name.startswith("role-"):
        return F.role(pick)
    if name.startswith(("mark-", "rank-")):
        return F.load(pick)
    if name == "bao-show.png":
        return F.bao_show(pick)
    if name == "bao-tag.png":
        return F.bao_tag(pick)
    if name.startswith("avatar-"):
        return F.avatar(int(name[7]), pick)
    if name.startswith("fx-"):
        first = entry.get("first")
        if name == "fx-solo.png":
            return F.code_fx(F.seal_solo(SEL["role-solo.png"]["pick"], 1, 5))
        if pick == "wave":
            return F.wave_flag(first, entry.get("amp", 3.2))
        first_im = F.center(F.load(first), 64, 64)
        if pick == "code":
            return F.code_fx(first_im, color=(255, 255, 255) if "guard" in name else F.PAL["gold_l"])
        color = (255, 255, 255) if "guard" in name else F.PAL["gold_l"]
        return F.strip_from_frames(ART / "out" / pick, first_im, 4, entry.get("sparkle", False), color, entry.get("bob"))
    if name.startswith("result-"):
        return F.ribbon(pick, entry.get("patch") if pick == entry["pick"] else None)
    if name == "seat-crest.png":
        return F.crest(*pick)
    if name == "icon.png":
        return F.favicon(pick)
    raise KeyError(name)


def main(variants: bool = False) -> None:
    out = F.OUT
    out.mkdir(parents=True, exist_ok=True)
    for name, size in SPEC.items():
        entry = SEL[name]
        im = build(name, entry["pick"], entry)
        assert im.size == size, (name, im.size, size)
        im.save(out / name)
        if variants:
            folder = F.VAR / name.removesuffix(".png")
            folder.mkdir(parents=True, exist_ok=True)
            for k, alt in enumerate(entry.get("alts", [])):
                try:
                    v = build(name, alt, entry if not name.startswith("fx-") else {**entry, "bob": None, "sparkle": False})
                    v.save(folder / f"alt{k + 1}.png")
                except Exception as e:  # 备选做不出来不挡定稿
                    print("备选失败", name, alt, e)
            im.save(folder / "pick.png")
    cov = SEL["cover"]["pick"]
    (ART / "out" / "covers").mkdir(exist_ok=True)
    shutil.copy(ART / "out" / cov, ART / "out" / "covers" / "cover-final.png")
    print("导出", len(SPEC), "个文件到", out)


if __name__ == "__main__":
    main("--variants" in sys.argv)
