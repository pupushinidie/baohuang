/**
 * 预览局面工厂（对外接口）：给界面预览页、教程、验收（含背靠背的规则核对）、测试造局面。
 *
 * 三层：
 * 1. buildDeal(spec)：按约束造一副完整的 168 张发牌（谁必须有哪些牌、谁不能有能叫的牌……）。
 * 2. createScene(spec)：指定座位、名字、人机、选项、发牌（完整 168 张或每人几张都行），
 *    再按「步骤」（"2 abdicate"、"0 play 9 9 小"……）用真的引擎走到想要的局面。局面一定是规则能走到的。
 * 3. scene(name) / sceneSnapshot(name)：按名字直接拿常用局面（SCENE_NAMES 列出全部），
 *    sceneSnapshot 还包成服务器发给网页的 LobbyRoomSnapshot（含离线、倒计时、托管）。
 *
 * 座位约定：场景里玩家 id 是 "p0"…"p4"，下标就是座位号；预览默认从座位 0（「我」）的视角看。
 */
import { applyBaohuang, createBaohuang, godView, legalCommands, nextSeat, redactBaohuang, setRules, stackDeal, stepSeconds, timeoutLead } from "./baohuang.js";
import { canCallTypes, DECK_SIZE, fullDeck, HUANG_ID, isJoker, kindKey, kindOf, mustAscend, parseCards, rankOf, sortCards, suitOf, type CardId, type Suit } from "./cards.js";
import { createRng } from "./rng.js";
import { playOptions } from "./sets.js";
import { DEFAULT_ROOM_ACCESS, type LobbyRoomSnapshot } from "./roomTypes.js";
import type { BaohuangCommand, BaohuangConfig, BaohuangOptions, BaohuangState, Declare, Mode } from "./types.js";

const SEATS = [0, 1, 2, 3, 4] as const;

// ---------------------------------------------------------------------------
// 1. 造完整的发牌

export interface DealSpec {
  /** 发牌起点（决定谁 34 张谁 33 张：起点和后面两个座位 34 张）。默认 0。 */
  readonly dealStart?: number;
  /** 每个座位的张数，默认按 dealStart 算；给了就用它（合计要 168）。 */
  readonly sizes?: readonly number[];
  /** 每个座位必须有的牌（parseCards 写法或牌 id）。皇牌不写就随机发。 */
  readonly must?: readonly (string | readonly CardId[] | undefined)[];
  /** 这些座位不能有任何能叫保的牌（同花同点恰好 3 或 4 张）。 */
  readonly noCall?: readonly number[];
  /** 这些座位不能有「恰好 3 张」（可以有 must 里给的 4 张）。 */
  readonly noThree?: readonly number[];
  /** 这些座位手里不能有 2（must 里给的除外）。 */
  readonly noTwo?: readonly number[];
  /** 每个座位随机补牌时不要的点数（must 里给的除外），例 [[14, 15]] = 座位 0 不再拿 A 和 2。 */
  readonly avoidRanks?: readonly (readonly number[] | undefined)[];
  readonly seed?: number;
}

const toCards = (value: string | readonly CardId[] | undefined, used: Set<CardId>): CardId[] => {
  if (value === undefined) return [];
  if (typeof value === "string") return parseCards(value, used);
  for (const card of value) {
    if (used.has(card)) throw new Error(`${card} 重复了`);
    used.add(card);
  }
  return [...value];
};

export const dealSizes = (dealStart: number): number[] => SEATS.map((seat) => ((seat - dealStart + 5) % 5 < 3 ? 34 : 33));

/**
 * 造一副满足约束的 168 张发牌（返回 5 手牌，下标是座位）。must 里给了同一种牌的座位不会再多拿这种牌
 * （「恰好 3 张梅花 J」就是恰好 3 张）。找不到就换种子重试，最后还不行就抛错。
 */
export function buildDeal(spec: DealSpec = {}): CardId[][] {
  const sizes = spec.sizes ? [...spec.sizes] : dealSizes(spec.dealStart ?? 0);
  if (sizes.reduce((a, b) => a + b, 0) !== DECK_SIZE) throw new Error("张数合计要 168。");
  const used = new Set<CardId>();
  const base = SEATS.map((seat) => toCards(spec.must?.[seat], used));
  const locked = base.map((cards) => new Set(cards.map(kindOf).filter((kind): kind is string => kind !== null)));
  const capped = new Set([...(spec.noCall ?? []), ...(spec.noThree ?? [])]);
  const noTwo = new Set(spec.noTwo ?? []);
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const rng = createRng((spec.seed ?? 7) + attempt * 7919);
    const hands = base.map((cards) => [...cards]);
    const counts = hands.map((cards) => {
      const map = new Map<string, number>();
      for (const card of cards) if (kindOf(card)) map.set(kindOf(card)!, (map.get(kindOf(card)!) ?? 0) + 1);
      return map;
    });
    const pool = rng.shuffle(fullDeck().filter((card) => !used.has(card)));
    let ok = true;
    for (const card of pool) {
      const kind = kindOf(card);
      const eligible = SEATS.filter((seat) => {
        if (hands[seat]!.length >= sizes[seat]!) return false;
        if (!kind) return true;
        if (locked[seat]!.has(kind)) return false;
        if (noTwo.has(seat) && rankOf(card) === 15) return false;
        if (spec.avoidRanks?.[seat]?.includes(rankOf(card))) return false;
        // 不能叫保的座位：每种牌最多 2 张。
        if (capped.has(seat) && (counts[seat]!.get(kind) ?? 0) >= 2) return false;
        return true;
      });
      if (eligible.length === 0) {
        ok = false;
        break;
      }
      // 优先塞给还差得多的座位，免得最后剩下的牌没地方放。
      const need = (seat: number) => sizes[seat]! - hands[seat]!.length;
      const maxNeed = Math.max(...eligible.map(need));
      const pick = rng.pick(eligible.filter((seat) => need(seat) >= maxNeed - 2));
      hands[pick]!.push(card);
      if (kind) counts[pick]!.set(kind, (counts[pick]!.get(kind) ?? 0) + 1);
    }
    if (!ok) continue;
    const valid = SEATS.every((seat) => {
      const types = canCallTypes(hands[seat]!);
      if (spec.noCall?.includes(seat) && types.length > 0) return false;
      if (spec.noThree?.includes(seat) && mustAscend(hands[seat]!)) return false;
      return hands[seat]!.length === sizes[seat];
    });
    if (valid) return hands.map(sortCards);
  }
  throw new Error("造不出满足条件的发牌，约束太紧了。");
}

// ---------------------------------------------------------------------------
// 2. 按步骤走到想要的局面

export interface SceneSpec {
  readonly options?: Partial<BaohuangOptions>;
  readonly config?: Partial<BaohuangConfig>;
  /** 5 个座位的名字（默认 我 / 阿福 / 小翠 / 咕噜一号 / 咕噜二号）。 */
  readonly names?: readonly string[];
  /** 哪些座位是人机（默认 3、4）。 */
  readonly bots?: readonly number[];
  /** 发牌：DealSpec（造完整 168 张），或者直接给 5 手牌（教程可以每人几张）。不给就随机发。 */
  readonly deal?: DealSpec | readonly (string | readonly CardId[])[];
  readonly dealStart?: number;
  /** 第几盘、之前的累计分（开局前就设好）。 */
  readonly handNo?: number;
  readonly scores?: readonly number[];
  /** 依次执行的步骤，见 runStep。 */
  readonly steps?: readonly SceneStep[];
  readonly seed?: number;
}

/**
 * 一步：
 * - 字符串 `"<座位> <动作> [参数]"`：
 *   `2 abdicate`、`0 ascend`、`0 call H9 pair`（pair / dark / open）、`1 declare rebel`
 *   （openGuard / darkGuard / rebel / noRebel，也可以写 明保 / 暗保 / 造反 / 不造反）、
 *   `3 grab` / `3 nograb`、`0 play 9 9 小`（点数、H9 这样的花色点数、小 / 大 / 皇 / 特、或牌 id）、`4 pass`、`0 ready`、`2 auto on`；
 * - `"timeout"`：所有该决定的人超时；`"timeout 1 3"`：只有座位 1、3 超时；
 * - `"simple N"`：按「跟牌出最小的能压的（不用王）、否则过；自由出牌出最小的一整组」走 N 步（造出牌中的局面）；
 * - `"until <阶段>"`：用同样的简单打法一直走到某个阶段（abdicate / call / declare / playing / handEnd）；
 * - 或者直接给 { seat, command }。
 */
export type SceneStep = string | { readonly seat: number; readonly command: BaohuangCommand };

const DEFAULT_NAMES = ["我", "阿福", "小翠", "咕噜一号", "咕噜二号"];
const DECLARE_WORDS: Record<string, Declare> = { 明保: "openGuard", 暗保: "darkGuard", 造反: "rebel", 不造反: "noRebel" };
const MODE_WORDS: Record<string, Mode> = { pair: "pair", dark: "darkSolo", darkSolo: "darkSolo", open: "openSolo", openSolo: "openSolo", 暗独: "darkSolo", 明独: "openSolo", 侍卫: "pair" };

export function createScene(spec: SceneSpec = {}): BaohuangState {
  const names = spec.names ?? DEFAULT_NAMES;
  const bots = new Set(spec.bots ?? [3, 4]);
  const players = SEATS.map((seat) => ({ id: `p${seat}`, name: names[seat] ?? `玩家${seat + 1}`, bot: bots.has(seat) }));
  let state = createBaohuang(players, spec.seed ?? 20261009, spec.options ?? {}, spec.config ?? {});
  // createBaohuang 会随机排座位，这里按给的顺序排回来。
  state.players = SEATS.map((seat) => ({ ...state.players.find((player) => player.id === `p${seat}`)! }));
  if (spec.handNo !== undefined) state.handNo = spec.handNo;
  if (spec.scores) state.players.forEach((player, seat) => (player.score = spec.scores![seat] ?? 0));
  const dealStart = spec.dealStart ?? (spec.deal && !Array.isArray(spec.deal) ? (spec.deal as DealSpec).dealStart : undefined) ?? 0;
  const hands = !spec.deal
    ? buildDeal({ dealStart, seed: spec.seed ?? 11 })
    : Array.isArray(spec.deal)
      ? (() => {
          const used = new Set<CardId>();
          return (spec.deal as readonly (string | readonly CardId[])[]).map((hand) => toCards(hand, used));
        })()
      : buildDeal({ ...(spec.deal as DealSpec), dealStart });
  state = stackDeal(state, hands, dealStart);
  for (const step of spec.steps ?? []) state = runStep(state, step);
  return state;
}

/** 把出牌写法换成这个座位手里的牌 id（先用不是保牌的那几张，免得无意中亮出侍卫）。 */
export function pickCards(state: BaohuangState, seat: number, text: string): CardId[] {
  const hand = [...state.players[seat]!.hand];
  const guardKind = state.guardCard ? kindKey(state.guardCard.suit, state.guardCard.rank) : null;
  const ordered = sortCards(hand).sort((a, b) => Number(kindOf(a) === guardKind) - Number(kindOf(b) === guardKind));
  const taken = new Set<CardId>();
  const take = (test: (card: CardId) => boolean, token: string) => {
    const card = ordered.find((candidate) => !taken.has(candidate) && test(candidate));
    if (!card) throw new Error(`座位 ${seat} 手里没有 ${token}`);
    taken.add(card);
    return card;
  };
  const rankCodes: Record<string, number> = { J: 11, Q: 12, K: 13, A: 14, "2": 15 };
  return text.trim().split(/\s+/).filter(Boolean).map((token) => {
    if (hand.includes(token.toUpperCase())) return take((card) => card === token.toUpperCase(), token);
    if (token === "特") return take((card) => card === state.tehua, token);
    if (token === "皇") return take((card) => card === HUANG_ID, token);
    if (token === "小") return take((card) => isJoker(card) && rankOf(card) === 16, token);
    if (token === "大") {
      const nonHuang = ordered.find((card) => !taken.has(card) && rankOf(card) === 17 && card !== HUANG_ID);
      return nonHuang ? take((card) => card === nonHuang, token) : take((card) => card === HUANG_ID, token);
    }
    const kind = /^([SHCD])(10|[6-9JQKA2])$/i.exec(token);
    if (kind) {
      const suit = kind[1]!.toUpperCase() as Suit;
      const rank = rankCodes[kind[2]!.toUpperCase()] ?? Number(kind[2]);
      return take((card) => !isJoker(card) && suitOf(card) === suit && rankOf(card) === rank && card !== state.tehua, token);
    }
    const rank = rankCodes[token.toUpperCase()] ?? Number(token);
    if (!Number.isInteger(rank) || rank < 6 || rank > 15) throw new Error(`不认识的牌：${token}`);
    return take((card) => !isJoker(card) && rankOf(card) === rank && card !== state.tehua, token);
  });
}

/** 简单的确定性打法（造局面用，不是人机）：跟牌出最小的能压住、不用王的；自由出牌出点数最小的一整组。 */
export function simpleCommand(state: BaohuangState, seat: number): BaohuangCommand {
  const options = legalCommands(state, state.players[seat]!.id);
  if (state.stage !== "playing") {
    const pick =
      options.find((command) => command.type === "ASCEND") ??
      options.find((command) => command.type === "DECLARE" && (command.choice === "darkGuard" || command.choice === "noRebel")) ??
      options.find((command) => command.type === "GRAB" && !command.grab) ??
      options[0];
    if (!pick) throw new Error("没有能走的。");
    return pick;
  }
  const hand = state.players[seat]!.hand;
  const rules = setRules(state);
  if (state.lastPlay) {
    const beat = playOptions(hand, state.lastPlay.ranks, rules).filter((cards) => cards.every((card) => !isJoker(card) && card !== rules.tehua));
    return beat.length > 0 ? { type: "PLAY", cardIds: beat[0]! } : { type: "PASS" };
  }
  const lead = timeoutLead(state, seat);
  const rank = rankOf(lead[0]!);
  if (isJoker(lead[0]!) || lead[0] === rules.tehua) return { type: "PLAY", cardIds: lead };
  const group = hand.filter((card) => !isJoker(card) && card !== rules.tehua && rankOf(card) === rank);
  return { type: "PLAY", cardIds: rules.bie6 && rank === 6 ? lead : group };
}

function pendingOf(state: BaohuangState): number[] {
  return SEATS.filter((seat) => legalCommands(state, state.players[seat]!.id).length > 0);
}

/** 执行一步（见 SceneStep）。 */
export function runStep(state: BaohuangState, step: SceneStep): BaohuangState {
  if (typeof step !== "string") return applyBaohuang(state, state.players[step.seat]!.id, step.command).state;
  const words = step.trim().split(/\s+/);
  if (words[0] === "timeout") {
    const seats = words.slice(1).map(Number);
    return applyBaohuang(state, "", { type: "TIMEOUT", ...(seats.length > 0 ? { seats } : {}) }).state;
  }
  if (words[0] === "simple" || words[0] === "until") {
    let current = state;
    const limit = words[0] === "simple" ? Number(words[1]) : 2000;
    for (let k = 0; k < limit; k += 1) {
      if (words[0] === "until" && current.stage === words[1]) break;
      if (current.phase === "finished") break;
      const seat = pendingOf(current)[0];
      if (seat === undefined) break;
      current = applyBaohuang(current, current.players[seat]!.id, simpleCommand(current, seat)).state;
    }
    return current;
  }
  const seat = Number(words[0]);
  const id = state.players[seat]?.id;
  if (id === undefined) throw new Error(`步骤写错了：${step}`);
  const verb = words[1];
  const rest = words.slice(2);
  let command: BaohuangCommand;
  switch (verb) {
    case "ascend":
      command = { type: "ASCEND" };
      break;
    case "abdicate":
      command = { type: "ABDICATE" };
      break;
    case "grab":
      command = { type: "GRAB", grab: true };
      break;
    case "nograb":
      command = { type: "GRAB", grab: false };
      break;
    case "call": {
      const [kind] = pickCards({ ...state, guardCard: null, tehua: null }, seat, rest[0]!);
      command = { type: "CALL", suit: suitOf(kind!) as Suit, rank: rankOf(kind!), mode: MODE_WORDS[rest[1] ?? "pair"] ?? "pair" };
      break;
    }
    case "declare":
      command = { type: "DECLARE", choice: DECLARE_WORDS[rest[0]!] ?? (rest[0] as Declare) };
      break;
    case "play":
      command = { type: "PLAY", cardIds: pickCards(state, seat, rest.join(" ")) };
      break;
    case "pass":
      command = { type: "PASS" };
      break;
    case "ready":
      command = { type: "READY" };
      break;
    case "auto":
      command = { type: "AUTO", on: rest[0] !== "off" };
      break;
    default:
      throw new Error(`步骤写错了：${step}`);
  }
  return applyBaohuang(state, id, command).state;
}

// ---------------------------------------------------------------------------
// 3. 常用局面

export interface SceneResult {
  /** 完整状态（服务端视角，含所有隐藏信息）。给网页用要先 redact，或者用 sceneSnapshot。 */
  readonly state: BaohuangState;
  /** 默认从哪个座位看（「我」）。 */
  readonly viewer: number;
  /** 这些座位的真人离线（对手离线的界面）。 */
  readonly offline?: readonly number[];
  /** 当前这一步还剩多少毫秒（超时的界面给 0 或很小）。 */
  readonly remainingMs?: number;
  /** 自己已经提交、还在随机延迟里的抢独 / 表态选择。 */
  readonly queued?: BaohuangCommand;
  /** 观战视角（viewer = -1）。 */
  readonly spectator?: boolean;
  /** 观战上帝视角（房主打开了「观战看手牌」）。 */
  readonly god?: boolean;
  /** 这个局面在演示什么。 */
  readonly note: string;
}

/** 二打三的一副牌：座位 0 拿皇牌、有红桃 9 ×3（能登基），座位 2 拿第 4 张红桃 9（侍卫）。 */
const PAIR_DEAL: DealSpec = { dealStart: 0, must: ["皇 H9 H9 H9 大 S2 S2 S2", "S7 S7", "H9 小", "DQ", "CA"], seed: 3 };
/** 座位 0 有红桃 9 ×4（能独保），还有梅花 7 ×3。 */
const SOLO_DEAL: DealSpec = { dealStart: 0, must: ["皇 H9 H9 H9 H9 C7 C7 C7 大 大 小 S2 S2 S2 S2", "", "", "", ""], seed: 5 };

const scenes: Record<string, () => SceneResult> = {
  start: () => ({
    state: createScene({ deal: PAIR_DEAL }),
    viewer: 0,
    note: "开局：第 1 盘，我拿到皇牌、有三张红桃 9，可以登基或让位",
  }),
  "start-cannot": () => ({
    state: createScene({ deal: { dealStart: 0, must: ["皇", "", "", "", ""], noCall: [0], seed: 9 } }),
    viewer: 0,
    note: "开局：我拿到皇牌但没有能叫的牌，只能让位（服务器 2–6 秒后自动让位）",
  }),
  "start-other": () => ({
    state: createScene({ deal: { dealStart: 2, must: ["H9 H9 H9", "", "皇", "", ""], seed: 4 } }),
    viewer: 0,
    note: "开局：皇牌在座位 2，他在想登基还是让位，我等着",
  }),
  abdicating: () => ({
    state: createScene({ deal: { dealStart: 2, must: ["H9 H9 H9", "", "皇", "", ""], noCall: [1, 2], seed: 4 }, steps: ["2 abdicate", "1 abdicate"] }),
    viewer: 0,
    note: "让位中：座位 2、1 先后让位，皇牌转到我手里",
  }),
  "tie-abdicating": () => ({
    state: createScene({
      options: { tieCard: true },
      deal: { dealStart: 2, must: ["H9 H9 H9", "", "皇", "", ""], noCall: [1, 2, 4], seed: 4 },
      steps: ["2 abdicate", "1 abdicate"],
    }),
    viewer: 0,
    note: "让位贴牌：第 2 次让位起每次贴 1 张（公开），贴牌跟着皇牌到了我手里",
  }),
  forced: () => ({
    state: createScene({
      deal: { dealStart: 2, must: ["", "", "皇", "CJ CJ CJ", "D7 D7 D7"], noCall: [0, 1, 2], seed: 6 },
      steps: ["2 abdicate", "1 abdicate", "0 abdicate", "4 abdicate", "3 abdicate"],
    }),
    viewer: 0,
    note: "逼位：5 个人都让位，按 2、3、4…找第一个有恰好 3 张的人，座位 3 被逼登基，正在叫保",
  }),
  "forced-me": () => ({
    state: createScene({
      deal: { dealStart: 2, must: ["CJ CJ CJ", "", "皇", "", ""], noCall: [1, 2, 3, 4], seed: 6 },
      steps: ["2 abdicate", "1 abdicate", "0 abdicate", "4 abdicate", "3 abdicate"],
    }),
    viewer: 0,
    note: "逼位到我：我必须登基，现在叫保",
  }),
  call: () => ({
    state: createScene({ deal: SOLO_DEAL, steps: ["0 ascend"] }),
    viewer: 0,
    note: "叫保：我是皇帝，可以叫梅花 7（3 张，有侍卫）或红桃 9（4 张：暗独 / 明独）",
  }),
  "call-other": () => ({
    state: createScene({ deal: PAIR_DEAL, steps: ["0 ascend"] }),
    viewer: 2,
    note: "叫保：皇帝（座位 0）在选叫哪种牌，我（座位 2）等着",
  }),
  "declare-guard": () => ({
    state: createScene({ deal: PAIR_DEAL, steps: ["0 ascend", "0 call H9 pair"] }),
    viewer: 2,
    note: "表态：我（座位 2）拿着第 4 张红桃 9，是侍卫，选明保或暗保（只有我知道）",
  }),
  "declare-rebel": () => ({
    state: createScene({ deal: PAIR_DEAL, steps: ["0 ascend", "0 call H9 pair"] }),
    viewer: 1,
    note: "表态：我（座位 1）是革命党，选造反或不造反；看不到别人选没选",
  }),
  "declare-waiting": () => ({
    state: createScene({ deal: PAIR_DEAL, steps: ["0 ascend", "0 call H9 pair", "1 declare rebel"] }),
    viewer: 1,
    note: "表态：我已经选了造反，等其他人（看不到谁选了）",
  }),
  "declare-queued": () => ({
    state: createScene({ deal: PAIR_DEAL, steps: ["0 ascend", "0 call H9 pair"] }),
    viewer: 1,
    queued: { type: "DECLARE", choice: "rebel" },
    note: "表态：我刚点了造反，服务器随机延迟 1–3 秒才生效（snapshot.queued）",
  }),
  "declare-emperor": () => ({
    state: createScene({ deal: PAIR_DEAL, steps: ["0 ascend", "0 call H9 pair"] }),
    viewer: 0,
    note: "表态：我是皇帝，等其他 4 人表态（我也不知道侍卫是谁）",
  }),
  "reveal-open": () => ({
    state: createScene({ deal: PAIR_DEAL, steps: ["0 ascend", "0 call H9 pair", "2 declare openGuard", "1 declare rebel", "3 declare noRebel", "4 declare noRebel"] }),
    viewer: 1,
    note: "表态公布：侍卫（座位 2）明保，身份公开，本盘 ×2；座位 1 的造反照样公布但没有效果",
  }),
  "reveal-rebel": () => ({
    state: createScene({ deal: PAIR_DEAL, steps: ["0 ascend", "0 call H9 pair", "2 declare darkGuard", "1 declare rebel", "3 declare rebel", "4 declare noRebel"] }),
    viewer: 1,
    note: "表态公布：2 人造反，造反成功，侍卫（座位 2）被揭开，本盘 ×2",
  }),
  "reveal-fail": () => ({
    state: createScene({ deal: PAIR_DEAL, steps: ["0 ascend", "0 call H9 pair", "2 declare darkGuard", "1 declare rebel", "3 declare noRebel", "4 declare noRebel"] }),
    viewer: 4,
    note: "表态公布：只有座位 1 造反，造反失败，不加倍，只公开他是革命党；侍卫仍然保密",
  }),
  "reveal-none": () => ({
    state: createScene({ deal: PAIR_DEAL, steps: ["0 ascend", "0 call H9 pair", "timeout"] }),
    viewer: 1,
    note: "表态公布：没人造反（全部超时 = 暗保 / 不造反），什么都不发生，皇帝先出",
  }),
  "reveal-darksolo": () => ({
    state: createScene({ deal: SOLO_DEAL, steps: ["0 ascend", "0 call H9 dark", "1 declare rebel", "2 declare rebel", "3 declare noRebel", "4 declare noRebel"] }),
    viewer: 1,
    note: "表态公布：暗独被 2 人造反揭开，公开「独保」，本盘 ×2",
  }),
  "dark-solo": () => ({
    state: createScene({ deal: SOLO_DEAL, steps: ["0 ascend", "0 call H9 dark", "timeout"] }),
    viewer: 0,
    note: "暗独：我是皇帝（自己看得到是暗独），别人看到的是普通二打三",
  }),
  "dark-solo-other": () => ({
    state: createScene({ deal: SOLO_DEAL, steps: ["0 ascend", "0 call H9 dark", "timeout", "0 play C7 C7 C7"] }),
    viewer: 2,
    note: "暗独（座位 2 视角）：看起来和二打三一样，不知道侍卫是谁",
  }),
  "open-solo": () => ({
    state: createScene({ deal: SOLO_DEAL, steps: ["0 ascend", "0 call H9 open"] }),
    viewer: 0,
    note: "明独：亮出 4 张红桃 9，一打四，跳过表态，我先出",
  }),
  grab: () => ({
    state: createScene({ options: { grabSolo: true }, deal: PAIR_DEAL }),
    viewer: 1,
    note: "抢独：发完牌所有人同时有 5 秒可以按抢独（看不到别人按没按）",
  }),
  "grab-won": () => ({
    state: createScene({ options: { grabSolo: true }, deal: PAIR_DEAL, steps: ["1 grab", "0 nograb", "2 nograb", "3 nograb", "4 grab"] }),
    viewer: 1,
    note: "抢独结果：座位 1、4 都按了，从皇牌持有者 0 往上家数，4 先到——座位 4 抢成明独，只公开他",
  }),
  playing: () => ({
    state: createScene({ deal: PAIR_DEAL, steps: ["0 ascend", "0 call H9 pair", "timeout", "simple 7"] }),
    viewer: 0,
    note: "出牌中：一轮打了几手，桌上有每个人这一轮的出牌 / 不要",
  }),
  lead: () => ({
    state: createScene({ deal: PAIR_DEAL, steps: ["0 ascend", "0 call H9 pair", "timeout"] }),
    viewer: 0,
    note: "出牌：我是皇帝，本盘第一手，自由出牌",
  }),
  follow: () => ({
    state: createScene({ deal: PAIR_DEAL, steps: ["0 ascend", "0 call H9 pair", "timeout", "0 play 2 2"] }),
    viewer: 1,
    note: "跟牌：皇帝出了一对 2，轮到我（座位 1），要出 2 张更大的或者不要",
  }),
  jiefeng: () => {
    const state = createScene({
      deal: ["皇 H9 H9 H9 S6", "S7 S8", "H9 SK", "DQ DJ D10", "CA C10 C8"],
      bots: [3, 4],
      steps: ["0 ascend", "0 call H9 pair", "timeout", "0 play S6", "1 play S8", "2 play SK", "3 pass", "4 play CA", "0 play 皇", "1 pass", "2 pass", "3 pass", "4 pass", "0 play H9 H9 H9", "1 pass", "2 pass", "3 pass", "4 pass"],
    });
    return { state, viewer: 1, note: "接风：皇帝（座位 0）打出最后一手走科，没人压，由他后面第一个有牌的座位 1 接风自由出牌" };
  },
  "guard-revealed": () => ({
    state: createScene({
      deal: ["皇 H9 H9 H9 S6 S6", "S7 S8 S8", "H9 SK SK", "DQ DJ D10", "CA C10 C8"],
      steps: ["0 ascend", "0 call H9 pair", "timeout", "0 play S6", "1 play S7", "2 play H9"],
    }),
    viewer: 1,
    note: "侍卫被揭开：座位 2 打出了第 4 张红桃 9（保牌），自动标记成侍卫，所有人可见，倍数不变",
  }),
  tehua: () => ({
    state: createScene({ options: { tehua: true }, deal: PAIR_DEAL, steps: ["0 ascend", "0 call H9 pair", "timeout"] }),
    viewer: 2,
    note: "特画：我（座位 2）手里那张红桃 9 是特画（超级王，比大王大），只有我知道它在我手里",
  }),
  "tehua-played": () => ({
    state: createScene({
      options: { tehua: true },
      deal: ["皇 H9 H9 H9 S6 S6", "大 S8 S8", "H9 SK SK", "DQ DJ D10", "CA C10 C8"],
      steps: ["0 ascend", "0 call H9 pair", "timeout", "0 play S6", "1 play 大", "2 play 特"],
    }),
    viewer: 1,
    note: "特画打出：座位 2 用特画压住大王，自动揭开侍卫身份",
  }),
  bie6: () => ({
    state: createScene({
      options: { bie6: true },
      deal: ["H9 SK", "皇 H9 H9 H9 S6 S6 S9 S9 小", "DQ DJ D10", "CA C10 C8", "S7 S8"],
      steps: ["1 ascend", "1 call H9 pair", "timeout"],
    }),
    viewer: 1,
    note: "憋 6：我（皇帝）先出，手里还有 9、小王，6 要留到最后一次出完，现在不能出 6、也不能 6 挂王",
  }),
  "few-cards": () => ({
    state: createScene({
      deal: ["皇 H9 H9 H9 S6 S6 S7 S7 S8", "S8 S9 S10", "H9 SK SK SQ", "DQ DJ D10 D8 D7 D6", "CA C10 C8 C7"],
      steps: ["0 ascend", "0 call H9 pair", "timeout"],
    }),
    viewer: 0,
    note: "报牌：好几个人手里剩 5 张及以下，要高亮",
  }),
  "max-hand": () => ({
    state: createScene({
      options: { tieCard: true },
      deal: { dealStart: 2, must: ["S2", "H2", "皇", "CJ CJ CJ", "D7 D7 D7"], noCall: [0, 1, 2], avoidRanks: [[15], [15], [15]], seed: 2 },
      steps: ["2 abdicate", "1 abdicate", "0 abdicate", "4 abdicate", "3 abdicate"],
    }),
    viewer: 3,
    note: "最多的手牌：贴牌 + 逼位后皇帝（座位 3）手里 38 张",
  }),
  "hand-end": () => ({
    state: createScene({
      deal: ["皇 H9 H9 H9 S6", "S7 S8 S9", "H9 SK", "DQ DJ D10", "CA C10 C8"],
      steps: ["0 ascend", "0 call H9 pair", "2 declare openGuard", "timeout", "0 play S6", "1 play S8", "2 play SK", "3 pass", "4 play CA", "0 play 皇", "1 pass", "2 pass", "3 pass", "4 pass", "0 play H9 H9 H9", "1 pass", "2 pass", "3 pass", "4 pass", "1 play S7", "2 play H9"],
    }),
    viewer: 1,
    note: "一盘结算：明保 ×2，皇帝头科、侍卫二科：侍卫 +6、皇帝 +12、革命党各 −6",
  }),
  "hand-end-solo": () => ({
    state: createScene({
      deal: ["皇 H9 H9 H9 H9", "S7", "SK S8", "DQ DJ", "CA C10"],
      steps: ["0 ascend", "0 call H9 dark", "timeout", "0 play H9 H9 H9 H9", "1 pass", "2 pass", "3 pass", "4 pass", "0 play 皇"],
    }),
    viewer: 2,
    note: "一盘结算（暗独）：皇帝头科 +12，其余各 −3；结算时公开是暗独",
  }),
  "game-end": () => ({
    state: createScene({
      handNo: 5,
      scores: [0, 9, -3, -3, -3],
      deal: ["皇 H9 H9 H9 S6", "S7 S8 S9", "H9 SK", "DQ DJ D10", "CA C10 C8"],
      steps: ["0 ascend", "0 call H9 pair", "timeout", "0 play S6", "1 play S8", "2 play SK", "3 pass", "4 play CA", "0 play 皇", "1 pass", "2 pass", "3 pass", "4 pass", "0 play H9 H9 H9", "1 pass", "2 pass", "3 pass", "4 pass", "1 play S7", "2 play H9"],
    }),
    viewer: 0,
    note: "整场终局（5 盘打完）：我和座位 1 并列第一",
  }),
  offline: () => ({
    state: createScene({ deal: PAIR_DEAL, steps: ["0 ascend", "0 call H9 pair", "timeout", "0 play 2 2"] }),
    viewer: 0,
    offline: [1],
    note: "对手离线：座位 1 离线，由人机代打（3 秒后），他用原昵称回来能接上",
  }),
  timeout: () => ({
    state: createScene({ deal: PAIR_DEAL, steps: ["0 ascend", "0 call H9 pair", "timeout", "0 play 2 2", "timeout", "simple 3", "timeout"] }),
    viewer: 0,
    remainingMs: 1200,
    note: "超时：座位 1 连续超时 2 次被转成托管（人机代打），这一步的倒计时只剩 1.2 秒",
  }),
  "spectate-god": () => ({
    state: createScene({ deal: PAIR_DEAL, steps: ["0 ascend", "0 call H9 pair", "timeout", "simple 4"] }),
    viewer: -1,
    spectator: true,
    god: true,
    note: "观战（房主打开了「观战看手牌」）：上帝视角，所有手牌和侍卫都看得到",
  }),
  spectate: () => ({
    state: createScene({ deal: PAIR_DEAL, steps: ["0 ascend", "0 call H9 pair", "timeout", "simple 4"] }),
    viewer: -1,
    spectator: true,
    note: "观战（只看公开信息）：看不到任何人的手牌、侍卫是谁",
  }),
};

/** 所有常用局面的名字。 */
export const SCENE_NAMES = Object.keys(scenes);

/** 按名字拿常用局面（完整状态 + 默认视角 + 说明）。 */
export function scene(name: string): SceneResult {
  const make = scenes[name];
  if (!make) throw new Error(`没有这个局面：${name}（可选：${SCENE_NAMES.join("、")}）`);
  return make();
}

export interface SnapshotOptions {
  /** 从哪个座位看（默认场景自带的 viewer）；-1 是观战。 */
  readonly viewer?: number;
  readonly offline?: readonly number[];
  readonly remainingMs?: number;
  readonly queued?: BaohuangCommand;
  /** 观战上帝视角（viewer = -1 时）。 */
  readonly god?: boolean;
}

/**
 * 包成服务器发给网页的样子（LobbyRoomSnapshot）：成员是非人机的座位（座位 0 是房主），
 * 对局按 viewer 的视角脱敏。网页的 socket id 要冒充成 `sock-<座位>`。
 */
export function toSnapshot(state: BaohuangState, options: SnapshotOptions = {}): LobbyRoomSnapshot {
  const viewer = options.viewer ?? 0;
  const offline = new Set(options.offline ?? []);
  const members = state.players
    .map((player, seat) => ({ player, seat }))
    .filter(({ player }) => !player.bot)
    .map(({ player, seat }) => ({ id: `sock-${seat}`, playerId: player.id, name: player.name, isHost: seat === 0, connected: !offline.has(seat) }));
  const viewerId = viewer >= 0 ? state.players[viewer]!.id : "";
  return {
    code: "BAOHNG",
    options: {
      hands: state.config.hands,
      grabSolo: state.config.grabSolo,
      bie6: state.config.bie6,
      rebel: state.config.rebel,
      tieCard: state.config.tieCard,
      tehua: state.config.tehua,
    },
    status: "playing",
    members,
    spectators: viewer < 0 ? [{ id: "sock-spectator", name: "看客" }] : [],
    access: { ...DEFAULT_ROOM_ACCESS, spectatorsSeeAll: viewer < 0 && options.god === true },
    chat: [],
    voice: [],
    turnRemainingMs: options.remainingMs ?? stepSeconds(state) * 1000,
    ...(options.queued ? { queued: options.queued } : {}),
    ...(state.phase === "finished" ? { rematch: { remainingMs: 60_000, acceptedIds: [] } } : {}),
    game: viewer < 0 && options.god ? godView(state) : redactBaohuang(state, viewerId),
  };
}

/** 按名字拿常用局面，直接包成 LobbyRoomSnapshot（预览页用）。 */
export function sceneSnapshot(name: string, overrides: SnapshotOptions = {}): LobbyRoomSnapshot {
  const result = scene(name);
  const viewer = overrides.viewer ?? result.viewer;
  const offline = overrides.offline ?? result.offline;
  const remainingMs = overrides.remainingMs ?? result.remainingMs;
  const queued = overrides.queued ?? result.queued;
  const god = overrides.god ?? result.god;
  return toSnapshot(result.state, {
    viewer,
    ...(god ? { god } : {}),
    ...(offline ? { offline } : {}),
    ...(remainingMs !== undefined ? { remainingMs } : {}),
    ...(queued ? { queued } : {}),
  });
}

export { nextSeat };
