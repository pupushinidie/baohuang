"""动画检查（照宝石商人 finalize.py 的 report / has_glitch_frame 改的）：art/out/final/ 下 fx-*.png 每条横排精灵图，
按 spec 的帧数切开，算每帧和首帧相比变了多少像素、有没有坏帧（某帧突变又变回）、首末帧能不能接上（循环的那几条）。

用法：python art/finalize.py report [目录]   默认 art/out/final
"""
import pathlib
import sys

from PIL import Image, ImageChops

ROOT = pathlib.Path(__file__).resolve().parent
# 文件名: (帧数, 是否循环)
FX = {"fx-crown": (4, True), "fx-guard": (4, True), "fx-rebel": (4, True), "fx-solo": (4, True)}


def frames(path: pathlib.Path, n: int) -> list[Image.Image]:
    strip = Image.open(path).convert("RGBA")
    w = strip.width // n
    return [strip.crop((i * w, 0, (i + 1) * w, strip.height)) for i in range(n)]


def changed(a: Image.Image, b: Image.Image) -> float:
    diff = ImageChops.difference(a, b).convert("L").point(lambda v: 255 if v > 24 else 0)
    return sum(1 for v in diff.getdata() if v) / (a.width * a.height)


def frame_changes(fr):
    return [changed(fr[0], f) for f in fr[1:]]


def has_glitch_frame(fr) -> bool:
    """相邻帧变化里某一步特别大（≥15% 且 ≥ 中位数 2.5 倍），而前后两帧彼此很像 → 中间那帧是坏帧。"""
    steps = [changed(fr[i], fr[i + 1]) for i in range(len(fr) - 1)]
    for i in range(1, len(fr) - 1):
        jump = min(steps[i - 1], steps[i])
        around = changed(fr[i - 1], fr[i + 1])
        med = sorted(steps)[len(steps) // 2]
        if jump >= 0.15 and jump >= 2.5 * max(med, 0.01) and around < jump / 2:
            return True
    return False


def report(folder: pathlib.Path, only=None) -> int:
    bad = 0
    for name, (n, loop) in FX.items():
        if only and name not in only:
            continue
        p = folder / f"{name}.png"
        if not p.exists():
            print(f"{name}: 缺文件")
            bad += 1
            continue
        fr = frames(p, n)
        ch = frame_changes(fr)
        worst = max(ch)
        steps = [changed(fr[i], fr[i + 1]) for i in range(n - 1)]
        loop_gap = changed(fr[-1], fr[0])
        flags = []
        if loop and worst > 0.45:
            flags.append("走形?")
        if worst < 0.03:
            flags.append("太静?")
        if has_glitch_frame(fr):
            flags.append("有坏帧")
        if loop and loop_gap > max(steps) * 1.5 + 0.01:
            flags.append("循环接不上")
        bad += bool(flags)
        print(f"{name}: {n} 帧，最大变化 {worst:5.1%}，相邻帧 {min(steps):.1%}–{max(steps):.1%}"
              + (f"，末帧→首帧 {loop_gap:.1%}" if loop else "") + (" " + " ".join(flags) if flags else " 通过"))
    return bad


if __name__ == "__main__":
    cmd, *rest = sys.argv[1:] or ["report"]
    folder = pathlib.Path(rest[0]) if rest else ROOT / "out" / "final"
    sys.exit(1 if report(folder) else 0)
