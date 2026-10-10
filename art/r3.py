"""保皇 正式美术第三轮：r2 里 fx-rebel 的动画服务器报错（Generation failed），重出；独保特效要更大的印章（v2 42px，字用代码画 2 倍）。"""
import sys
from concurrent.futures import ThreadPoolExecutor
import pixellab
import r2

r2.OUT = pixellab.ART / "out" / "r2"
SEAL = ("a square vermilion red Chinese seal stamp imprint, thick red border, blank empty middle, rough ink edges"
        + r2.SMALL)


def seal42():
    folder = pixellab.ART / "out" / "r3" / "v2" / "seal42"
    if folder.exists() and any(folder.glob("*.png")):
        return
    pixellab.generate_async("seal42", {"description": SEAL, "image_size": {"width": 42, "height": 42},
                                       "no_background": True, "seed": 2023}, folder, endpoint="/generate-image-v2")
    print("seal42 ok", flush=True)


def rebel():
    r2.run("fx-rebel")


if __name__ == "__main__":
    jobs = [seal42, rebel]
    with ThreadPoolExecutor(max_workers=2) as pool:
        for f in [pool.submit(j) for j in jobs]:
            try:
                f.result()
            except Exception as e:
                print("失败：", e, flush=True)
    print("全部跑完", flush=True)
