/**
 * 一套牌（「糊」）的识别和比较（规则书 4.1、4.2，勘误 K1；憋 6 见 5.7；特画见补充 4.2）。
 *
 * - 合法的一套：同点数的普通牌若干张（6–2），可以再挂任意张王；或者只有王。没有顺子，2 不能混进别的点数。
 * - 比较：张数相同，两套各自从大到小排，每一张都严格大于对应的那张。
 * - 特画（选项打开、叫保之后那张没亮的保牌）按王算，大小 18；它不当原来的点数用。
 * - 憋 6：6 不能挂王（特画也算王）；手里除了 6 还有别的牌时不能出 6；自由出牌时剩下的 6 要一次出完。
 */
import { BIG_JOKER, isJoker, NORMAL_RANKS, rankOf, SMALL_JOKER, sortCards, TEHUA_RANK, type CardId } from "./cards.js";

export interface SetRules {
  /** 特画那张牌的 id（没有特画是 null）。 */
  readonly tehua: CardId | null;
  /** 憋 6。 */
  readonly bie6: boolean;
}

export const NO_RULES: SetRules = { tehua: null, bie6: false };

/** 这张牌出牌时的大小：特画 18，其余按牌面。 */
export function effRank(card: CardId, rules: Pick<SetRules, "tehua">): number {
  return card === rules.tehua ? TEHUA_RANK : rankOf(card);
}

/** 按「王」处理的牌：大小王和特画。 */
export const isWild = (card: CardId, rules: Pick<SetRules, "tehua">): boolean => isJoker(card) || card === rules.tehua;

export interface ParsedSet {
  /** 从大到小的比较点数。 */
  readonly ranks: number[];
  /** 普通牌的点数；只有王时是 null。 */
  readonly base: number | null;
  /** 普通牌张数、挂的王张数。 */
  readonly normals: number;
  readonly wilds: number;
}

/** 识别一套牌（只看牌本身，不看手牌）；不合法返回中文原因。 */
export function parseSet(cards: readonly CardId[], rules: SetRules = NO_RULES): ParsedSet | string {
  if (cards.length === 0) return "请选要出的牌。";
  if (new Set(cards).size !== cards.length) return "同一张牌选了两次。";
  let base: number | null = null;
  let normals = 0;
  for (const card of cards) {
    if (isWild(card, rules)) continue;
    const rank = rankOf(card);
    if (base !== null && rank !== base) return rank === 15 || base === 15 ? "2 不能和别的点数一起出（2 不能挂）。" : "一套牌里普通牌只能是同一个点数（没有顺子）。";
    base = rank;
    normals += 1;
  }
  const wilds = cards.length - normals;
  if (rules.bie6 && base === 6 && wilds > 0) return "憋 6：6 不能挂王。";
  const ranks = cards.map((card) => effRank(card, rules)).sort((a, b) => b - a);
  return { ranks, base, normals, wilds };
}

/** next 能不能压住 prev（两组都是从大到小的比较点数）：张数相同、逐张严格大于。 */
export function beats(next: readonly number[], prev: readonly number[]): boolean {
  if (next.length !== prev.length) return false;
  const a = [...next].sort((x, y) => y - x);
  const b = [...prev].sort((x, y) => y - x);
  return a.every((rank, index) => rank > b[index]!);
}

/**
 * 出这套牌合不合法（含憋 6 对手牌的要求）。top 是要压的那套（null = 自由出牌）。
 * 合法返回识别结果，否则返回中文原因。
 */
export function checkPlay(hand: readonly CardId[], cards: readonly CardId[], top: readonly number[] | null, rules: SetRules): ParsedSet | string {
  const inHand = new Set(hand);
  if (cards.some((card) => !inHand.has(card))) return "这些牌不在你手里。";
  return checkShape(cards, top, rules, hand.length, hand.some((card) => isWild(card, rules) || rankOf(card) !== 6));
}

/** checkPlay 去掉「在不在手里」的部分；handSize、handHasNon6 是手牌的张数和「除了 6 还有别的牌」。 */
function checkShape(cards: readonly CardId[], top: readonly number[] | null, rules: SetRules, handSize: number, handHasNon6: boolean): ParsedSet | string {
  if (top && cards.length !== top.length) return `要出 ${top.length} 张（张数必须相同）。`;
  const parsed = parseSet(cards, rules);
  if (typeof parsed === "string") return parsed;
  if (rules.bie6 && parsed.base === 6) {
    if (handHasNon6) return "憋 6：手里还有别的牌时不能出 6。";
    if (!top && cards.length !== handSize) return "憋 6：剩下的 6 要一次出完。";
  }
  if (top && !beats(parsed.ranks, top)) return "压不住：两套各自从大到小排，每一张都要比对面那张大。";
  return parsed;
}

interface HandGroups {
  /** 每个普通点数的牌（出牌时先用的排前面）。 */
  readonly byRank: Map<number, CardId[]>;
  readonly small: CardId[];
  readonly big: CardId[];
  readonly tehua: CardId[];
}

/**
 * 手牌按点数分组。同点数里 avoid 中的牌（比如侍卫手里那张保牌）排在最后，
 * 这样列举出来的出法默认不先动它（人机、超时、调试按钮都不会无意中亮出侍卫身份）。
 */
function groupHand(hand: readonly CardId[], rules: SetRules, avoid: ReadonlySet<CardId>): HandGroups {
  const byRank = new Map<number, CardId[]>();
  const small: CardId[] = [];
  const big: CardId[] = [];
  const tehua: CardId[] = [];
  for (const card of sortCards(hand)) {
    if (card === rules.tehua) tehua.push(card);
    else if (rankOf(card) === SMALL_JOKER) small.push(card);
    else if (rankOf(card) === BIG_JOKER) big.push(card);
    else {
      const list = byRank.get(rankOf(card)) ?? [];
      list.push(card);
      byRank.set(rankOf(card), list);
    }
  }
  for (const list of byRank.values()) list.sort((a, b) => Number(avoid.has(a)) - Number(avoid.has(b)));
  return { byRank, small, big, tehua };
}

/**
 * 列出所有不同的出法（每种「点数 × 张数 × 挂几张小王、大王、特画」一种，具体用哪几张按 groupHand 的顺序取）。
 * top 为 null 时是自由出牌，否则只列能压住 top 的。都已经按 checkPlay 过滤（含憋 6）。
 */
export function playOptions(hand: readonly CardId[], top: readonly number[] | null, rules: SetRules, avoid: ReadonlySet<CardId> = new Set()): CardId[][] {
  const groups = groupHand(hand, rules, avoid);
  const out: CardId[][] = [];
  const want = top?.length;
  const handHasNon6 = hand.some((card) => isWild(card, rules) || rankOf(card) !== 6);
  const tryAdd = (cards: CardId[]) => {
    if (cards.length === 0) return;
    if (want !== undefined && cards.length !== want) return;
    if (typeof checkShape(cards, top, rules, hand.length, handHasNon6) !== "string") out.push(cards);
  };
  const wildCombos = (maxTotal: number, fn: (wild: CardId[]) => void) => {
    for (let t = 0; t <= groups.tehua.length; t += 1) {
      for (let b = 0; b <= groups.big.length; b += 1) {
        for (let s = 0; s <= groups.small.length; s += 1) {
          if (t + b + s > maxTotal) continue;
          fn([...groups.tehua.slice(0, t), ...groups.big.slice(0, b), ...groups.small.slice(0, s)]);
        }
      }
    }
  };
  for (const rank of NORMAL_RANKS) {
    const cards = groups.byRank.get(rank);
    if (!cards) continue;
    for (let k = 1; k <= cards.length; k += 1) {
      if (want !== undefined && k > want) break;
      const normals = cards.slice(0, k);
      wildCombos(want === undefined ? 99 : want - k, (wild) => tryAdd([...normals, ...wild]));
    }
  }
  wildCombos(want === undefined ? 99 : want, (wild) => tryAdd(wild));
  return out;
}
