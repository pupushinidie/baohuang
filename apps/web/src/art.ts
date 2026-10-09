/** 美术资源（简洁版由 art/simple.py 画，正式美术同名覆盖，见 art/spec.md）和座位色。 */
const BASE = `${import.meta.env.BASE_URL}art/`;

export const art = {
  /** 金銮殿场景（512×288）：夜间 / 白天。牌桌背景和首页主图。 */
  sceneNight: `${BASE}scene-night.png`,
  sceneDay: `${BASE}scene-day.png`,
  /** 座位头像 0–4。 */
  avatar: (index: number) => `${BASE}avatar-${index % 5}.png`,
};

/** 座位色（art/spec.md：Okabe-Ito 色盲安全色 + 银白），只区分座位，和阵营无关。 */
export const SEAT_COLORS = ["#e69f00", "#56b4e9", "#009e73", "#cc79a7", "#e8e4d8"] as const;

export function seatColor(index: number): string {
  return SEAT_COLORS[index % SEAT_COLORS.length]!;
}

/** 背景图 512×288，按整数倍放大到盖满一块区域。 */
export function coverSize(width: number, height: number): string {
  const scale = Math.max(1, Math.ceil(Math.max(width / 512, height / 288)));
  return `${512 * scale}px ${288 * scale}px`;
}
