/**
 * 保皇的牌：4 副扑克去掉 3、4、5，共 168 张（规则书第 2 节）。
 *
 * 牌 id 是字符串，带副数（0–3），这样 4 张「红桃 9」各有自己的 id：
 * - 普通牌：`${副}${花色}${点数}`，花色 S 黑桃 / H 红桃 / C 梅花 / D 方块，
 *   点数 6 7 8 9 10 J Q K A 2。例：`2H9` 第 3 副的红桃 9，`0S10` 第 1 副的黑桃 10，`3DA`、`1C2`。
 * - 小王：`${副}JS`（0JS … 3JS）；大王：`${副}JB`（0JB … 3JB）。
 * - **皇牌**就是 `0JB`（第 1 副的大王，带皇冠），出牌时和普通大王一样大。
 *
 * 点数（rank）：6–14（11 J、12 Q、13 K、14 A），15 是 2，16 小王，17 大王，18 特画（开房选项，见 sets.ts）。
 * 花色只在叫保时用来认「同一种牌」，平时不影响大小。
 */
export type CardId = string;

export const SUITS = ["S", "H", "C", "D"] as const;
export type Suit = (typeof SUITS)[number];

/** 普通点数从小到大：6 … A、2。 */
export const NORMAL_RANKS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
export const RANK_TWO = 15;
export const SMALL_JOKER = 16;
export const BIG_JOKER = 17;
/** 特画（开房选项打开、叫保之后，那张没亮的保牌）当「超级王」用的大小。 */
export const TEHUA_RANK = 18;
export const DECKS = 4;
export const DECK_SIZE = 168;
/** 皇牌：第 1 副的大王。 */
export const HUANG_ID: CardId = "0JB";

const RANK_CODE: Record<number, string> = { 6: "6", 7: "7", 8: "8", 9: "9", 10: "10", 11: "J", 12: "Q", 13: "K", 14: "A", 15: "2" };
const CODE_RANK: Record<string, number> = Object.fromEntries(Object.entries(RANK_CODE).map(([rank, code]) => [code, Number(rank)]));
const SUIT_NAMES: Record<Suit, string> = { S: "黑桃", H: "红桃", C: "梅花", D: "方块" };
const SUIT_ORDER: Record<string, number> = { S: 0, H: 1, C: 2, D: 3, J: 4 };

export const normalId = (deck: number, suit: Suit, rank: number): CardId => `${deck}${suit}${RANK_CODE[rank]}`;
export const smallJokerId = (deck: number): CardId => `${deck}JS`;
export const bigJokerId = (deck: number): CardId => `${deck}JB`;

export const isJoker = (card: CardId): boolean => card[1] === "J";
export const isHuang = (card: CardId): boolean => card === HUANG_ID;
export const deckOf = (card: CardId): number => Number(card[0]);

/** 牌面点数（不考虑特画）：6–15，小王 16，大王 17。 */
export function rankOf(card: CardId): number {
  if (card[1] === "J") return card[2] === "B" ? BIG_JOKER : SMALL_JOKER;
  const rank = CODE_RANK[card.slice(2)];
  if (rank === undefined) throw new Error(`不认识的牌：${card}`);
  return rank;
}

/** 花色；王是 "J"。 */
export const suitOf = (card: CardId): Suit | "J" => card[1] as Suit | "J";

/** 「花色 + 点数」，叫保认牌用；王返回 null。例：`H9`、`S10`。 */
export function kindOf(card: CardId): string | null {
  return isJoker(card) ? null : card.slice(1);
}
export const kindKey = (suit: Suit, rank: number): string => `${suit}${RANK_CODE[rank]}`;

export function rankLabel(rank: number): string {
  if (rank === SMALL_JOKER) return "小王";
  if (rank === BIG_JOKER) return "大王";
  if (rank === TEHUA_RANK) return "特画";
  return RANK_CODE[rank] ?? String(rank);
}
export const suitName = (suit: Suit): string => SUIT_NAMES[suit];
/** 「红桃 9」这样的叫法。 */
export const kindName = (suit: Suit, rank: number): string => `${SUIT_NAMES[suit]} ${rankLabel(rank)}`;

export function cardName(card: CardId): string {
  if (isHuang(card)) return "皇牌";
  if (isJoker(card)) return rankLabel(rankOf(card));
  return kindName(suitOf(card) as Suit, rankOf(card));
}

/** 全部 168 张，按副数、花色、点数排好（发牌前要洗）。 */
export function fullDeck(): CardId[] {
  const cards: CardId[] = [];
  for (let deck = 0; deck < DECKS; deck += 1) {
    for (const suit of SUITS) for (const rank of NORMAL_RANKS) cards.push(normalId(deck, suit, rank));
    cards.push(smallJokerId(deck), bigJokerId(deck));
  }
  return cards;
}

/** 比较用：点数大的在前，同点数按花色（黑红梅方）、再按副数。 */
export function compareCards(a: CardId, b: CardId): number {
  return rankOf(b) - rankOf(a) || SUIT_ORDER[a[1]!]! - SUIT_ORDER[b[1]!]! || deckOf(a) - deckOf(b);
}
export const sortCards = (cards: readonly CardId[]): CardId[] => [...cards].sort(compareCards);

export interface CallableType {
  readonly suit: Suit;
  readonly rank: number;
  /** 手里这种牌的张数：3（叫了有侍卫）或 4（叫了就是独保）。 */
  readonly count: 3 | 4;
}

/**
 * 能叫保的牌（规则书 3.4、9.1）：按「花色 + 点数」统计普通牌（不含王），张数恰好 3 或 4 的种类。
 * 2 也能叫（开工拍板待确认 2）。按点数从小到大、花色黑红梅方排（超时「叫第一种恰好 3 张」就按这个顺序）。
 */
export function canCallTypes(hand: readonly CardId[]): CallableType[] {
  const counts = new Map<string, number>();
  for (const card of hand) {
    const kind = kindOf(card);
    if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const result: CallableType[] = [];
  for (const rank of NORMAL_RANKS) {
    for (const suit of SUITS) {
      const count = counts.get(kindKey(suit, rank)) ?? 0;
      if (count === 3 || count === 4) result.push({ suit, rank, count });
    }
  }
  return result;
}

/** 能登基：至少有一种能叫保的牌。 */
export const canAscend = (hand: readonly CardId[]): boolean => canCallTypes(hand).length > 0;
/** 逼位时必须登基的资格：至少有一种「恰好 3 张」（勘误 K7 选 A：同时有 4 张的也不豁免）。 */
export const mustAscend = (hand: readonly CardId[]): boolean => canCallTypes(hand).some((type) => type.count === 3);

/**
 * 测试、预览局面、教程用：把「H9 H9 S10 小 大 皇」这样的写法换成牌 id。
 * - 普通牌：花色字母 + 点数（S/H/C/D + 6 7 8 9 10 J Q K A 2），例 H9、S10、DA、C2；
 * - 小 / 小王、大 / 大王、皇 / 皇牌；
 * - 也可以直接写完整 id（2H9、1JS、0JB）。
 * 同一种牌依次取第 1、2、3、4 副；`used` 传进来可以让几手牌之间不重复（整副分给 5 个人时用）。
 * 写「大」时先用第 2–4 副，最后才用皇牌那一张。
 */
export function parseCards(text: string, used: Set<CardId> = new Set()): CardId[] {
  const out: CardId[] = [];
  const take = (candidates: CardId[], token: string): CardId => {
    const card = candidates.find((candidate) => !used.has(candidate));
    if (!card) throw new Error(`${token} 超过了 4 张`);
    used.add(card);
    return card;
  };
  for (const raw of text.trim().split(/\s+/).filter(Boolean)) {
    const token = raw.toUpperCase();
    if (/^[0-3](JS|JB|[SHCD](10|[6-9JQKA2]))$/.test(token)) {
      if (used.has(token)) throw new Error(`${token} 重复了`);
      used.add(token);
      out.push(token);
      continue;
    }
    if (raw === "小" || raw === "小王") out.push(take([0, 1, 2, 3].map(smallJokerId), raw));
    else if (raw === "大" || raw === "大王") out.push(take([1, 2, 3, 0].map(bigJokerId), raw));
    else if (raw === "皇" || raw === "皇牌") out.push(take([HUANG_ID], raw));
    else {
      const match = /^([SHCD])(10|[6-9JQKA2])$/.exec(token);
      if (!match) throw new Error(`不认识的牌：${raw}`);
      const suit = match[1] as Suit;
      const rank = CODE_RANK[match[2]!]!;
      out.push(take([0, 1, 2, 3].map((deck) => normalId(deck, suit, rank)), raw));
    }
  }
  return out;
}
