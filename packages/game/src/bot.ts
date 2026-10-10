/**
 * 保皇人机（只有「普通」一个难度）。策略参考 ~/Desktop/游戏规则/保皇-补充.md 第 1 节。
 *
 * 约定：botCommand(state, seat) / botDecide(state, seat) 只吃 redactGameForViewer(state, 这个座位的 id) 之后的状态，
 * 返回这个座位现在的一个合法操作（botDecide 另附一句玩家听得懂的理由，教程的「提示」用）。
 *
 * 做法：
 * - 手牌评估（补充 1.1）：手数 H（点数种类数）、控牌 C（大王、特画、≥7 张的一套、5–6 张的 2 算半个）、牌力分 S；
 *   阈值都按 S 的分位数（STRENGTH_QUANTILES 是 2 万手随机发牌算出来的，见 scripts/sim-baohuang.ts strength）。
 * - 出牌：每种出法看「出完以后手里的牌值 V 变了多少」（清掉一整组 +1，用大王 −1，拆掉 7 张以上的控 −1 …），
 *   再按「这一轮最大的那手是队友还是敌人」决定压不压。
 * - 队友判断只用公开信息：皇帝、明保 / 造反揭开的侍卫、造反失败公开的革命党；没揭开的侍卫按「谁压皇帝、谁放皇帝」
 *   从最近的历史事件里打嫌疑分（补充 1.6.1）。侍卫知道自己是侍卫，所以也知道皇帝是队友。
 * - 随机：同样的局面给同样的选择（用手牌和局面算哈希），测试可复现；不同的手牌之间看起来不机械。
 */
import { BIG_JOKER, canCallTypes, cardName, isJoker, kindKey, kindName, kindOf, NORMAL_RANKS, rankLabel, rankOf, RANK_TWO, SMALL_JOKER, type CardId } from "./cards.js";
import { declareChoices, legalCommands, setRules } from "./baohuang.js";
import { checkPlay, effRank, isWild, playOptions, type SetRules } from "./sets.js";
import type { BaohuangState, GameCommand } from "./types.js";

export interface BotDecision {
  readonly command: GameCommand;
  /** 一句玩家听得懂的理由（教程「提示」用）。 */
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// 手牌评估

export interface HandEval {
  /** 每个普通点数的张数（下标 6–15）。 */
  readonly counts: number[];
  readonly small: number;
  readonly big: number;
  /** 特画（选项打开、在自己手里时）。 */
  readonly tehua: number;
  /** 手数：点数种类数（只剩王时算 1）。 */
  readonly H: number;
  /** 控牌数。 */
  readonly C: number;
  /** 牌力分（补充 1.1）。 */
  readonly S: number;
}

export function evalHand(hand: readonly CardId[], rules: Pick<SetRules, "tehua">): HandEval {
  const counts = new Array<number>(16).fill(0);
  let small = 0;
  let big = 0;
  let tehua = 0;
  for (const card of hand) {
    if (card === rules.tehua) tehua += 1;
    else if (isJoker(card)) {
      if (rankOf(card) === BIG_JOKER) big += 1;
      else small += 1;
    } else counts[rankOf(card)]! += 1;
  }
  let kinds = 0;
  let bigGroups = 0;
  for (const rank of NORMAL_RANKS) {
    if (counts[rank]! > 0) kinds += 1;
    if (counts[rank]! >= 7) bigGroups += 1;
  }
  const H = kinds === 0 ? (small + big + tehua > 0 ? 1 : 0) : kinds;
  const twos = counts[RANK_TWO]!;
  const C = big + tehua + bigGroups + (twos >= 5 && twos <= 6 ? 0.5 : 0);
  const S = 3 * (big + tehua) + 1.5 * small + 0.8 * twos + 0.3 * counts[14]! + bigGroups - 0.5 * (H - 9);
  return { counts, small, big, tehua, H, C, S };
}

/**
 * 手里牌的「值」：手数越少越好，控牌越多越好。出牌前后相减就是这手牌的代价 / 收益。
 * 清掉一整组 +1；用一张大王 −1；小王 −0.4；拆掉 7 张以上的一组让它不再是控 −1。
 */
function handValue(e: HandEval): number {
  return -e.H + e.C + 0.4 * e.small + 0.05 * e.counts[RANK_TWO]!;
}

/**
 * 牌力分 S 的分位数表 [百分位, S]，34 张一手、不考虑特画，1.2 万手随机发牌算出
 * （`npx tsx scripts/sim-baohuang.ts strength` 可以重算）。
 */
export const STRENGTH_QUANTILES: readonly (readonly [number, number])[] = [
  [0, 0.3], [0.05, 2.7], [0.1, 3.5], [0.15, 4.0], [0.2, 4.5], [0.25, 4.9], [0.3, 5.3], [0.35, 5.7], [0.4, 6.1], [0.45, 6.4],
  [0.5, 6.8], [0.55, 7.2], [0.6, 7.5], [0.65, 7.9], [0.7, 8.4], [0.75, 8.8], [0.8, 9.3], [0.85, 10.0], [0.9, 10.8], [0.95, 11.9],
  [0.97, 12.7], [0.98, 13.4], [0.99, 14.3], [1, 18.9],
];

/** S 在随机手牌里的百分位（0–1）。 */
export function strengthPercentile(S: number): number {
  const q = STRENGTH_QUANTILES;
  if (S <= q[0]![1]) return 0;
  for (let i = 1; i < q.length; i += 1) {
    const [p1, s1] = q[i]!;
    if (S <= s1) {
      const [p0, s0] = q[i - 1]!;
      return p0 + (s1 > s0 ? ((S - s0) / (s1 - s0)) * (p1 - p0) : p1 - p0);
    }
  }
  return 1;
}

/** 确定性的「随机数」（0–1）：同样的手牌和局面得到同样的值。 */
function hashRand(state: BaohuangState, seat: number, salt: string): number {
  const text = `${state.players[seat]!.hand.join("")}|${state.handNo}|${state.redeals}|${state.version}|${seat}|${salt}`;
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const pct = (p: number) => `${Math.max(1, Math.round(p * 100))}%`;

// ---------------------------------------------------------------------------
// 抢独、登基、叫保、表态

function grabDecision(state: BaohuangState, seat: number): BotDecision {
  const e = evalHand(state.players[seat]!.hand, setRules(state));
  const p = strengthPercentile(e.S);
  const holder = state.huangHolder === seat;
  const gate = holder ? 0.97 : 0.98;
  if (e.big >= 2 && e.C >= e.H - 2 && p >= gate) {
    return { command: { type: "GRAB", grab: true }, reason: `${e.big} 张大王、牌力在前 ${pct(1 - p)}，有把握一个人拿头科，抢独。` };
  }
  return { command: { type: "GRAB", grab: false }, reason: "明独要一个人拿头科，任何一个对手先出完就输 24 分，这手牌不够硬，不抢。" };
}

/** 4 张同花同点时要不要独、独哪种。null = 不够独。 */
function soloChoice(e: HandEval, p: number): "openSolo" | "darkSolo" | null {
  if (e.big >= 2 && e.C >= e.H - 1 && p >= 0.99) return "openSolo";
  if (e.C >= e.H - 2 && p >= 0.95) return "darkSolo";
  return null;
}

function abdicateDecision(state: BaohuangState, seat: number): BotDecision {
  const hand = state.players[seat]!.hand;
  const types = canCallTypes(hand);
  if (types.length === 0) return { command: { type: "ABDICATE" }, reason: "手里没有 3 张或 4 张同花色同点数的牌，不能登基，只能让位。" };
  const e = evalHand(hand, setRules(state));
  const p = strengthPercentile(e.S);
  const hasThree = types.some((type) => type.count === 3);
  if (!hasThree && !soloChoice(e, p)) {
    return { command: { type: "ABDICATE" }, reason: "只有 4 张同花同点，登基就得一个人打四个，牌不够硬，让位。" };
  }
  // 皇牌是转过来的：上家方向的人都没要，当皇帝的环境更好，门槛降一档。
  const passedOn = state.abdications.length > 0;
  const mid = passedOn ? 0.4 : 0.5;
  const low = passedOn ? 0.15 : 0.25;
  if (e.big >= 2 || p >= mid) return { command: { type: "ASCEND" }, reason: `牌力不错（${e.big} 张大王、前 ${pct(1 - p)}），让位等于送上家一张大王，登基。` };
  if (p < low && e.counts[RANK_TWO]! <= 2) return { command: { type: "ABDICATE" }, reason: "牌偏弱，王和 2 都少，当皇帝要被三个人围攻，让位。" };
  if (hashRand(state, seat, "ascend") < 0.7) return { command: { type: "ASCEND" }, reason: "牌力中等，让位要白送一张大王，还是登基。" };
  return { command: { type: "ABDICATE" }, reason: "牌力中等偏弱，这把让给上家。" };
}

function callDecision(state: BaohuangState, seat: number): BotDecision {
  const hand = state.players[seat]!.hand;
  const types = canCallTypes(hand);
  const e = evalHand(hand, setRules(state));
  const p = strengthPercentile(e.S);
  const fours = types.filter((type) => type.count === 4);
  const solo = fours.length > 0 ? soloChoice(e, p) : null;
  const threes = types.filter((type) => type.count === 3);
  if (fours.length > 0 && (solo || threes.length === 0)) {
    // 4 张里挑点数小的（亮出来的牌泄露信息少）。
    const four = [...fours].sort((a, b) => a.rank - b.rank)[0]!;
    const mode = solo ?? "darkSolo";
    const name = kindName(four.suit, four.rank);
    return {
      command: { type: "CALL", suit: four.suit, rank: four.rank, mode },
      reason:
        mode === "openSolo"
          ? `${e.big} 张大王、控牌够多，明独一打四，赢了 +24。叫${name}。`
          : solo
            ? `手里 4 张${name}、牌很硬，暗独：只亮 3 张，别人以为还有侍卫。`
            : `只能叫 4 张的${name}，暗独，别人以为还有侍卫。`,
    };
  }
  // 叫点数小的（亮出 3 张等于告诉大家自己有这个点数）；同点数时挑手里这个点数总张数多的。
  const best = [...threes].sort((a, b) => a.rank - b.rank || e.counts[b.rank]! - e.counts[a.rank]!)[0]!;
  const name = kindName(best.suit, best.rank);
  return {
    command: { type: "CALL", suit: best.suit, rank: best.rank, mode: "pair" },
    reason: best.rank <= 10 ? `叫${name}：叫小牌不暴露自己的大牌，侍卫也容易把它藏在小牌里晚点出。` : `叫${name}，拿着第 4 张的人就是侍卫。`,
  };
}

function declareDecision(state: BaohuangState, seat: number): BotDecision {
  const choices = declareChoices(state, seat);
  const e = evalHand(state.players[seat]!.hand, setRules(state));
  const p = strengthPercentile(e.S);
  if (choices.includes("openGuard")) {
    const rank = state.guardCard?.rank ?? 0;
    if (!state.forced && p >= 0.75 && rank >= 10) {
      return { command: { type: "DECLARE", choice: "openGuard" }, reason: "牌很硬、皇帝亮的也是大牌，明保：公开身份，分数翻倍。" };
    }
    return { command: { type: "DECLARE", choice: "darkGuard" }, reason: "暗保：先藏着身份，革命党不知道该打谁。" };
  }
  if (!choices.includes("rebel")) return { command: { type: "DECLARE", choice: "noRebel" }, reason: "这一局不能造反。" };
  let gate = 0.7;
  if (state.forced || state.abdications.length >= 3) gate = 0.55;
  if ((state.guardCard?.rank ?? 0) >= 14) gate = 0.8;
  if (p >= gate) return { command: { type: "DECLARE", choice: "rebel" }, reason: `牌力在前 ${pct(1 - p)}，造反：两个人以上一起造反就翻倍，还能揭出侍卫。` };
  return { command: { type: "DECLARE", choice: "noRebel" }, reason: "牌力一般，一个人造反只会暴露自己，不造反。" };
}

// ---------------------------------------------------------------------------
// 谁是队友

const SEATS = [0, 1, 2, 3, 4];

/**
 * 每个座位「和我同一方」的概率（自己是 1）。只用这个座位看得到的信息。
 * suspicion 是没揭开的侍卫嫌疑分（公开历史算出来的；侍卫用它判断自己是不是已经被怀疑了）。
 */
export function teamView(state: BaohuangState, seat: number): { ally: number[]; suspicion: number[]; emperor: number } {
  const emperor = state.emperor ?? -1;
  const ally: number[] = SEATS.map((s) => (s === seat ? 1 : 0.5));
  const suspicion = guardSuspicion(state);
  if (emperor < 0) return { ally, suspicion, emperor };
  const knownRebel = new Set<number>();
  if (state.rebelFailed !== null) knownRebel.add(state.rebelFailed);
  for (const s of SEATS) if (state.players[s]!.declarePublic === "rebel") knownRebel.add(s);
  const mode = state.mode;
  const guard = state.guard;
  const iAmEmperor = seat === emperor;
  const soloKnown = mode === "openSolo" || (mode === "darkSolo" && (iAmEmperor || state.guardRevealed)) || (state.guardRevealed && guard === emperor);
  for (const s of SEATS) {
    if (s === seat) continue;
    if (soloKnown) {
      ally[s] = iAmEmperor || s === emperor ? 0 : 1;
      continue;
    }
    if (iAmEmperor) {
      if (guard !== null && guard !== emperor) ally[s] = s === guard ? 1 : 0;
      else ally[s] = knownRebel.has(s) ? 0 : NaN; // 待定，下面按嫌疑分算
      continue;
    }
    if (guard === seat) {
      // 我是侍卫：皇帝是队友，其他人都是敌人。
      ally[s] = s === emperor ? 1 : 0;
      continue;
    }
    // 我是革命党（暗独没揭开时我也以为有侍卫）。
    if (s === emperor) ally[s] = 0;
    else if (guard !== null) ally[s] = s === guard ? 0 : 1;
    else ally[s] = knownRebel.has(s) ? 1 : NaN;
  }
  // 待定的人：按嫌疑分 softmax 算「他是侍卫」的概率（革命党视角留 4% 给「其实是暗独」）。
  const unknown = SEATS.filter((s) => Number.isNaN(ally[s]!));
  if (unknown.length > 0) {
    const weights = unknown.map((s) => Math.exp(suspicion[s]!));
    const total = weights.reduce((a, b) => a + b, 0);
    const mass = iAmEmperor ? 1 : 0.96;
    unknown.forEach((s, i) => {
      const pGuard = (mass * weights[i]!) / total;
      ally[s] = iAmEmperor ? pGuard : 1 - pGuard;
    });
  }
  return { ally, suspicion, emperor };
}

/**
 * 侍卫嫌疑分（补充 1.6.1）：从本盘最近的公开历史里看谁压皇帝（减分）、谁放皇帝的小牌（加分）、
 * 谁压已知革命党的牌（加分）。history 只保留最近 60 条，相当于「记得最近几轮」。
 */
export function guardSuspicion(state: BaohuangState): number[] {
  const g = [0, 0, 0, 0, 0];
  const emperor = state.emperor;
  if (emperor === null) return g;
  const knownRebel = new Set<number>();
  if (state.rebelFailed !== null) knownRebel.add(state.rebelFailed);
  const rules = setRules(state);
  let start = 0;
  state.history.forEach((event, i) => {
    if (event.type === "HandStarted" || event.type === "Dealt") start = i + 1;
  });
  let top: { seat: number; wild: boolean; maxRank: number } | null = null;
  for (const event of state.history.slice(start)) {
    if (event.type === "TrickWon") top = null;
    else if (event.type === "Played") {
      const j = event.seat;
      const wild = event.cardIds.some((card) => isWild(card, rules));
      if (top && j !== emperor) {
        if (top.seat === emperor) g[j]! -= wild ? 2 : 1;
        else if (knownRebel.has(top.seat)) g[j]! += 1;
      }
      top = { seat: j, wild, maxRank: Math.max(...event.cardIds.map((card) => effRank(card, rules))) };
    } else if (event.type === "Passed") {
      const j = event.seat;
      if (top && top.seat === emperor && j !== emperor && !top.wild && top.maxRank <= 13) g[j]! += 0.6;
    }
  }
  return g;
}

// ---------------------------------------------------------------------------
// 出牌

interface Pool {
  readonly counts: number[];
  readonly small: number;
  readonly big: number;
  readonly tehua: number;
}

/** 还没见过的牌（不在自己手里、没打出过）按大小统计，判断一手牌「还有没有人压得住」。 */
function unseenPool(state: BaohuangState, seat: number, rules: SetRules): Pool {
  const counts = new Array<number>(16).fill(16);
  let small = 4;
  let big = 4;
  let tehua = 0;
  if (rules.tehua) {
    tehua = 1;
    counts[rankOf(rules.tehua)]! -= 1;
  }
  for (const card of [...state.played, ...state.players[seat]!.hand]) {
    if (card === rules.tehua) tehua -= 1;
    else if (isJoker(card)) {
      if (rankOf(card) === BIG_JOKER) big -= 1;
      else small -= 1;
    } else counts[rankOf(card)]! -= 1;
  }
  return { counts, small, big, tehua };
}

/** 对手里最多的手牌张数 ≥ 张数，并且没见过的牌凑得出一套压住 ranks 的牌。 */
function beatable(ranks: readonly number[], pool: Pool, maxOpponentCards: number): boolean {
  const k = ranks.length;
  if (maxOpponentCards < k) return false;
  const sorted = [...ranks].sort((a, b) => b - a);
  const check = (cand: number[]) => cand.every((rank, i) => rank > sorted[i]!);
  for (let t = 0; t <= Math.min(pool.tehua, k); t += 1) {
    for (let b = 0; b <= Math.min(pool.big, k - t); b += 1) {
      for (let s = 0; s <= Math.min(pool.small, k - t - b); s += 1) {
        const n = k - t - b - s;
        const wild = [...Array<number>(t).fill(18), ...Array<number>(b).fill(BIG_JOKER), ...Array<number>(s).fill(SMALL_JOKER)];
        if (n === 0) {
          if (check(wild)) return true;
          continue;
        }
        for (const rank of NORMAL_RANKS) {
          if (pool.counts[rank]! < n) continue;
          if (check([...wild, ...Array<number>(n).fill(rank)].sort((a, b2) => b2 - a))) return true;
        }
      }
    }
  }
  return false;
}

interface Candidate {
  readonly cards: CardId[];
  /** 普通牌的点数（只有王时是 99）。 */
  readonly base: number;
  readonly wilds: number;
  /** 出完以后手牌值的变化。 */
  readonly dV: number;
  /** 出完手里就没牌了。 */
  readonly finishes: boolean;
  /** 打出去就会亮出侍卫身份（含侍卫那张保牌或特画）。 */
  readonly reveals: boolean;
  /** 没人压得住（按没见过的牌算）；第一次用到时才算。 */
  readonly ranks: number[];
  safeCache?: boolean;
}

/** 「3 张 9 挂大王」这样的说法。 */
export function describeSet(cards: readonly CardId[], rules: Pick<SetRules, "tehua">): string {
  const normals = cards.filter((card) => !isWild(card, rules));
  const wild = cards.filter((card) => isWild(card, rules));
  const parts: string[] = [];
  if (normals.length > 0) parts.push(normals.length === 1 ? `一张 ${rankLabel(rankOf(normals[0]!))}` : `${normals.length} 张 ${rankLabel(rankOf(normals[0]!))}`);
  const te = wild.filter((card) => card === rules.tehua).length;
  const big = wild.filter((card) => card !== rules.tehua && rankOf(card) === BIG_JOKER).length;
  const small = wild.filter((card) => card !== rules.tehua && rankOf(card) === SMALL_JOKER).length;
  const jokers: string[] = [];
  if (te) jokers.push("特画");
  if (big) jokers.push(`${big > 1 ? `${big} 张` : ""}大王`);
  if (small) jokers.push(`${small > 1 ? `${small} 张` : ""}小王`);
  if (jokers.length > 0) parts.push(normals.length > 0 ? `挂${jokers.join("、")}` : jokers.join("、"));
  return parts.join(" ");
}

const leadKey = (cand: Candidate, score: number) => score - 0.06 * (cand.base === 99 ? 12 : cand.base - 6);

function playingDecision(state: BaohuangState, seat: number): BotDecision {
  const me = state.players[seat]!;
  const hand = me.hand;
  const rules = setRules(state);
  const before = evalHand(hand, rules);
  const v0 = handValue(before);
  const { ally, suspicion, emperor } = teamView(state, seat);
  const iAmGuard = state.guard === seat && seat !== emperor;
  const guardHidden = iAmGuard && !state.guardRevealed;
  const guardKind = state.guardCard ? kindKey(state.guardCard.suit, state.guardCard.rank) : null;
  const pool = unseenPool(state, seat, rules);
  const opponents = SEATS.filter((s) => s !== seat && state.players[s]!.handCount > 0);
  const maxOpp = Math.max(0, ...opponents.map((s) => state.players[s]!.handCount));
  const top = state.lastPlay;
  const avoid = new Set<CardId>(guardKind && seat !== emperor ? hand.filter((card) => kindOf(card) === guardKind) : []);

  const candidates: Candidate[] = playOptions(hand, top?.ranks ?? null, rules, avoid).map((cards) => {
    const used = new Set(cards);
    const rest = hand.filter((card) => !used.has(card));
    const ranks = cards.map((card) => effRank(card, rules));
    const normal = cards.find((card) => !isWild(card, rules));
    return {
      cards,
      base: normal ? rankOf(normal) : 99,
      wilds: cards.filter((card) => isWild(card, rules)).length,
      dV: rest.length === 0 ? 100 : handValue(evalHand(rest, rules)) - v0,
      finishes: rest.length === 0,
      reveals: seat !== emperor && cards.some((card) => card === rules.tehua || (guardKind !== null && kindOf(card) === guardKind)),
      ranks,
    };
  });
  const isSafe = (cand: Candidate) => (cand.safeCache ??= !beatable(cand.ranks, pool, maxOpp));
  const play = (cand: Candidate, reason: string): BotDecision => ({ command: { type: "PLAY", cardIds: cand.cards }, reason });
  const pass = (reason: string): BotDecision => ({ command: { type: "PASS" }, reason });
  const say = (cand: Candidate) => describeSet(cand.cards, rules);

  // 能一手出完就出完（最后一手不需要压得住别人，打出去就走科）。
  const finisher = candidates.find((cand) => cand.finishes);
  if (finisher) return play(finisher, `出${say(finisher)}，一手出完就走科。`);

  // 藏身份：侍卫没揭开时，含保牌的出法打折（皇帝快出完了、或者自己已经被怀疑得最多时就不藏了）。
  const emperorCards = emperor >= 0 ? state.players[emperor]!.handCount : 99;
  const others = SEATS.filter((s) => s !== seat && s !== emperor);
  const mostSuspected = others.every((s) => suspicion[seat]! >= suspicion[s]! + 2);
  const hidePenalty = guardHidden && emperorCards > 8 && !mostSuspected ? 1.5 : 0;
  const score = (cand: Candidate) => cand.dV - (cand.reveals ? hidePenalty : 0);

  const enemies = opponents.filter((s) => ally[s]! <= 0.4);
  const minEnemyCards = Math.min(99, ...enemies.map((s) => state.players[s]!.handCount));

  if (top) {
    if (candidates.length === 0) return pass("压不住这手牌，过。");
    const owner = top.seat;
    const a = ally[owner]!;
    const ownerCards = state.players[owner]!.handCount;
    const best = [...candidates].sort((x, y) => score(y) - score(x) || x.wilds - y.wilds || x.base - y.base)[0]!;
    // 侍卫没揭开、皇帝出的牌：多半放行，偶尔用便宜的牌压一下，免得一眼被认出来（补充 1.6.4）。
    if (guardHidden && owner === emperor) {
      if (emperorCards > 15 && best.wilds === 0 && score(best) >= 0 && hashRand(state, seat, "act") < 0.3) {
        return play(best, `用${say(best)}压一下，不让人看出我在放皇帝的牌。`);
      }
      return pass("这是皇帝的牌，放他过去。");
    }
    if (a >= 0.65) return pass(a >= 0.99 ? "这是队友的牌，不压，让他拿出牌权。" : "这手多半是队友出的，不压。");
    const enemySure = a <= 0.35;
    // 敌人快出完了：不惜代价拦住（王也用上）。
    if (enemySure && (ownerCards <= 5 || minEnemyCards <= 3)) {
      const blocker = [...candidates].sort((x, y) => Number(isSafe(y)) - Number(isSafe(x)) || score(y) - score(x))[0]!;
      return play(blocker, `对手只剩 ${Math.min(ownerCards, minEnemyCards)} 张，用${say(blocker)}拦住。`);
    }
    // 自己快出完了：抢出牌权更要紧。
    const nearDone = before.H <= 2;
    const threshold = enemySure ? (nearDone ? -1.2 : -0.45) : nearDone ? -0.5 : 0;
    if (score(best) >= threshold) {
      const why = best.dV >= 0.99 ? "正好清掉一整组" : best.wilds > 0 ? "用王换出牌权" : "代价不大";
      return play(best, enemySure ? `压对手的牌：出${say(best)}，${why}。` : `出${say(best)}，${why}。`);
    }
    return pass(enemySure ? "要压得拆牌或用王，划不来，先过（过了这一轮还能再上）。" : "看不准这手是谁的人，压的代价也不小，先过。");
  }

  // 自由出牌（本轮先出或接风）。
  if (candidates.length === 0) throw new Error("自由出牌却没有出法。");
  // 能跑完：控牌够多时先出没人压得住的，留最后一手。
  if (before.C >= before.H - 1 && before.H >= 2) {
    const safe = candidates.filter(isSafe).sort((x, y) => score(y) - score(x) || x.base - y.base);
    if (safe.length > 0) return play(safe[0]!, `出${say(safe[0]!)}，没人压得住，拿回出牌权一路出完。`);
  }
  // 敌人快出完：出比他手牌张数还多的一套，他根本跟不了。
  if (minEnemyCards <= 4) {
    const over = candidates.filter((cand) => cand.cards.length > minEnemyCards).sort((x, y) => leadKey(y, score(y)) - leadKey(x, score(x)));
    if (over.length > 0 && score(over[0]!) >= -1) return play(over[0]!, `对手只剩 ${minEnemyCards} 张，出 ${over[0]!.cards.length} 张的一套，他跟不了。`);
    const safe = candidates.filter(isSafe).sort((x, y) => score(y) - score(x));
    if (safe.length > 0) return play(safe[0]!, `对手快出完了，出${say(safe[0]!)}，没人压得住。`);
  }
  // 队友快出完：出他张数一样的小牌喂他。
  const friend = opponents.find((s) => ally[s]! >= 0.99 && state.players[s]!.handCount <= 4);
  if (friend !== undefined && minEnemyCards > 4) {
    const n = state.players[friend]!.handCount;
    const feed = candidates.filter((cand) => cand.cards.length === n && cand.wilds === 0 && !cand.reveals).sort((x, y) => x.base - y.base);
    if (feed.length > 0 && feed[0]!.base <= 12) return play(feed[0]!, `队友只剩 ${n} 张，出${say(feed[0]!)}让他接上走科。`);
  }
  // 平常：先出小的、整组出（不拆、不挂王），王和大张数的套留到后面拿出牌权。
  const lead = [...candidates].sort((x, y) => leadKey(y, score(y)) - leadKey(x, score(x)) || x.wilds - y.wilds)[0]!;
  const why = lead.base <= 9 ? "先把小牌出掉" : lead.wilds > 0 ? "挂王让它压不住" : "整组出，不拆牌";
  return play(lead, `出${say(lead)}：${why}，王和大套留着后面拿出牌权。`);
}

// ---------------------------------------------------------------------------

export function botDecide(state: BaohuangState, seat: number): BotDecision {
  const player = state.players[seat];
  if (!player) throw new Error("没有这个座位。");
  // 只有服务端的完整状态才带随机数状态和种子：人机拿到它说明调用方忘了 redactGameForViewer。
  if (state.rng !== undefined || state.seed !== undefined || state.log !== undefined) throw new Error("人机只能看脱敏后的状态（redactGameForViewer）。");
  if (legalCommands(state, player.id).length === 0) throw new Error("现在不该这个座位行动。");
  switch (state.stage) {
    case "grab":
      return grabDecision(state, seat);
    case "abdicate":
      return abdicateDecision(state, seat);
    case "call":
      return callDecision(state, seat);
    case "declare":
      return declareDecision(state, seat);
    case "playing": {
      const decision = playingDecision(state, seat);
      if (decision.command.type === "PLAY" && typeof checkPlay(player.hand, decision.command.cardIds, state.lastPlay?.ranks ?? null, setRules(state)) === "string") {
        throw new Error(`人机出了不合法的牌：${decision.command.cardIds.map(cardName).join(" ")}`);
      }
      return decision;
    }
    case "handEnd":
      return { command: { type: "READY" }, reason: "看完结算，准备下一盘。" };
  }
}

export function botCommand(state: BaohuangState, seat: number): GameCommand {
  return botDecide(state, seat).command;
}
