/** 美术资源（PixelLab 正式美术，文件名、尺寸、倍数见 art/spec.md）和座位色。 */
const BASE = `${import.meta.env.BASE_URL}art/`;

export type RoleArt = "emperor" | "guard" | "rebel" | "solo";
export type FxArt = "crown" | "guard" | "rebel" | "solo";

export const art = {
  /** 金銮殿场景（512×288）：夜间 / 白天。牌桌背景和首页主图，居中裁。 */
  sceneNight: `${BASE}scene-night.png`,
  sceneDay: `${BASE}scene-day.png`,
  /** 座位头像 0–4（40×40，按座位号取）。 */
  avatar: (index: number) => `${BASE}avatar-${((index % 5) + 5) % 5}.png`,
  /** 身份标记 32×32：皇冠、盾、旗、「独」印章。 */
  role: (role: RoleArt) => `${BASE}role-${role}.png`,
  /** 「保」「特」16×16，只在自己手里的保牌 / 特画右上角。 */
  markBao: `${BASE}mark-bao.png`,
  markTehua: `${BASE}mark-tehua.png`,
  /** 名次徽章 40×20：1 头科 … 5 大落。 */
  rank: (place: number) => `${BASE}rank-${place}.png`,
  /** 叫保展示框 145×71（三格透明，牌左上角在 (7,7)、(53,7)、(99,7)）。 */
  baoShow: `${BASE}bao-show.png`,
  /** 保牌小底框 53×69（牌放 (6,6)）。 */
  baoTag: `${BASE}bao-tag.png`,
  /** 特效 256×64，4 帧横排。 */
  fx: (kind: FxArt) => `${BASE}fx-${kind}.png`,
  /** 结算绸带 160×32（不带字）。 */
  resultWin: `${BASE}result-win.png`,
  resultLose: `${BASE}result-lose.png`,
  /** 皇帝名牌上沿 48×16。 */
  crest: `${BASE}seat-crest.png`,
};

/** 名次叫法（规则书第 1 节）。 */
export const PLACE_NAMES = ["", "头科", "二科", "三科", "二落", "大落"] as const;

/** 座位色（art/spec.md：Okabe-Ito 色盲安全色 + 银白），只区分座位，和阵营无关。 */
export const SEAT_COLORS = ["#e69f00", "#56b4e9", "#009e73", "#cc79a7", "#e8e4d8"] as const;

export function seatColor(index: number): string {
  return SEAT_COLORS[((index % SEAT_COLORS.length) + SEAT_COLORS.length) % SEAT_COLORS.length]!;
}

/** 背景图 512×288，按整数倍放大到盖满一块区域（配合 background-position: center 居中裁）。 */
export function coverSize(width: number, height: number): string {
  const scale = Math.max(1, Math.ceil(Math.max(width / 512, height / 288)));
  return `${512 * scale}px ${288 * scale}px`;
}

/** 预加载正式美术（特效、徽章第一次出现时不闪）。 */
export function preloadArt(): void {
  const list = [
    art.markBao,
    art.markTehua,
    art.baoShow,
    art.baoTag,
    art.resultWin,
    art.resultLose,
    art.crest,
    ...(["emperor", "guard", "rebel", "solo"] as const).map(art.role),
    ...(["crown", "guard", "rebel", "solo"] as const).map(art.fx),
    ...[1, 2, 3, 4, 5].map(art.rank),
  ];
  for (const src of list) {
    const image = new Image();
    image.src = src;
  }
}
