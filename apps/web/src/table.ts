/**
 * 牌桌用的小工具：倒计时、量牌桌区域、按区域大小挑牌的倍数（像素图只按整数倍放大）。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LobbyRoomSnapshot } from "@baohuang/game";

/** 当前这一步还剩几秒（服务器给的 turnRemainingMs 按本地时钟往下数）。 */
export function useCountdown(room: LobbyRoomSnapshot): number | null {
  const [now, setNow] = useState(Date.now());
  const [anchor, setAnchor] = useState({ at: Date.now(), ms: room.turnRemainingMs });
  useEffect(() => setAnchor({ at: Date.now(), ms: room.turnRemainingMs }), [room]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  if (anchor.ms === undefined) return null;
  return Math.max(0, Math.ceil((anchor.ms - Math.max(0, now - anchor.at)) / 1000));
}

export const CARD_W = 41;
export const CARD_H = 57;

export interface Layout {
  readonly mobile: boolean;
  /** 自己手牌的倍数。 */
  readonly hs: number;
  /** 桌上出的牌的倍数。 */
  readonly ps: number;
  /** 手牌相邻两列的间距（像素，可以比牌宽小 = 横向重叠）。 */
  readonly colStep: number;
  /** 同一列里相邻两张竖着错开的像素。 */
  readonly stack: number;
}

/** 桌面版各块的高度（像素）。 */
const PAD = 12;
const GAP = 8;
const PLATE_H = 96;
const PLAY_LABEL = 22;
const MID_MIN = 136;
const COL_HEAD = 30;
const LIFT = 8;

/**
 * 按牌桌区域大小挑倍数：手牌尽量大（3 → 2 → 1），出的牌 2 → 1；
 * 手牌每列至少露出 8 个原始像素（角上的点数），能露出 20 个（点数 + 花色）最好。
 * columns 是手牌有几列，maxStack 是最高的一列有几张。
 */
export function pickLayout(width: number, height: number, columns: number, maxStack: number): Layout {
  const cols = Math.max(1, columns);
  const extra = Math.max(0, maxStack - 1);
  if (width < 700) {
    const colStep = cols > 1 ? Math.min(CARD_W + 6, Math.floor((width - 16 - CARD_W) / (cols - 1))) : CARD_W;
    // 手机：上面的对手、状态、操作大约 330px，手牌列顶两行字 52px。
    const avail = height - 330 - 52 - CARD_H;
    const stack = extra > 0 ? Math.max(6, Math.min(16, Math.floor(avail / extra))) : 16;
    return { mobile: true, hs: 1, ps: 1, colStep, stack };
  }
  const options: [number, number][] = [
    [3, 2],
    [2, 2],
    [2, 1],
    [1, 1],
  ];
  for (const [hs, ps] of options) {
    const minCol = Math.round(CARD_W * hs * 0.7);
    if (cols > 1 && CARD_W * hs + (cols - 1) * minCol > width - 2 * PAD) continue;
    const base = 2 * PAD + PLATE_H + GAP + CARD_H * ps + PLAY_LABEL + GAP + Math.max(CARD_H * ps + 40, MID_MIN) + GAP + COL_HEAD + CARD_H * hs + LIFT;
    const minStack = 8 * hs;
    if (base + extra * minStack > height && hs > 1) continue;
    const stack = extra > 0 ? Math.max(4 * hs, Math.min(20 * hs, Math.floor((height - base) / extra))) : 20 * hs;
    const colStep = cols > 1 ? Math.min(CARD_W * hs + 8, Math.floor((width - 2 * PAD - CARD_W * hs) / (cols - 1))) : CARD_W * hs;
    return { mobile: false, hs, ps, colStep, stack };
  }
  return { mobile: false, hs: 1, ps: 1, colStep: CARD_W, stack: 8 };
}

/** 量一个元素的大小（随窗口变化）。 */
export function useBox(): [React.RefObject<HTMLDivElement | null>, { width: number; height: number }] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ width: 1100, height: 700 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setBox({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, box];
}
