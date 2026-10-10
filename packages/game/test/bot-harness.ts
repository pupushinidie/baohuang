/**
 * 人机测量用的对局框架：每个座位一个策略，策略只拿到 redactGameForViewer 之后的状态（和服务器一样）。
 * 自对弈测试（bot-selfplay.test.ts）和强度模拟（scripts/sim-baohuang.ts）共用。
 *
 * 基线（补充 1.7）：
 * - random（B0）：所有决定在合法选项里随机；跟牌 30% 过牌；能登基时 50% 登基；不抢独。
 * - b1（最小压牌，不看队伍）：能登基就登基，叫第一种 3 张（没有就暗独）；侍卫暗保；不造反；
 *   自由出牌出点数最小的一整组（不挂王）；跟牌能用「不拆、不用王」的压就用最小的压，否则过。
 * - b2（认队友贪心）：b1 + 确定的队友出的牌不压；敌人剩 ≤5 张时允许用王压。
 */
import {
  applyCommand,
  botCommand,
  canCallTypes,
  createGame,
  createRng,
  isWild,
  legalCommands,
  pendingSeats,
  playOptions,
  rankOf,
  redactGameForViewer,
  setRules,
  teamView,
  timeoutLead,
  type BaohuangState,
  type CardId,
  type GameCommand,
  type GameOptions,
  type HandSummary,
} from "../src/index.js";

export type Policy = (view: BaohuangState, seat: number) => GameCommand;

export const MAX_STEPS = 40_000;

function randomPolicy(seed: number): Policy {
  const rng = createRng(seed);
  return (view, seat) => {
    const options = legalCommands(view, view.players[seat]!.id);
    if (view.stage === "grab") return { type: "GRAB", grab: false };
    if (view.stage === "abdicate" && options.length > 1) return rng.next() < 0.5 ? { type: "ASCEND" } : { type: "ABDICATE" };
    if (view.stage === "playing" && view.lastPlay) {
      const plays = options.filter((command) => command.type === "PLAY");
      if (plays.length === 0 || rng.next() < 0.3) return { type: "PASS" };
      return plays[rng.int(plays.length)]!;
    }
    return options[rng.int(options.length)]!;
  };
}

/** b1 / b2 的出牌：不拆、不用王的最小压法；自由出牌出最小的一整组。 */
function greedyPlay(view: BaohuangState, seat: number, teamAware: boolean): GameCommand {
  const hand = view.players[seat]!.hand;
  const rules = setRules(view);
  const count = (rank: number) => hand.filter((card) => !isWild(card, rules) && rankOf(card) === rank).length;
  if (!view.lastPlay) {
    const lead = timeoutLead(view, seat);
    const first = lead[0]!;
    if (isWild(first, rules)) return { type: "PLAY", cardIds: lead };
    const rank = rankOf(first);
    const group = hand.filter((card) => !isWild(card, rules) && rankOf(card) === rank);
    return { type: "PLAY", cardIds: rules.bie6 && rank === 6 ? lead : group };
  }
  const all = playOptions(hand, view.lastPlay.ranks, rules);
  if (all.some((cards) => cards.length === hand.length)) return { type: "PLAY", cardIds: all.find((cards) => cards.length === hand.length)! };
  let allowWild = false;
  if (teamAware) {
    const { ally } = teamView(view, seat);
    const owner = view.lastPlay.seat;
    if (ally[owner]! >= 0.99) return { type: "PASS" };
    if (ally[owner]! <= 0.01 && view.players[owner]!.handCount <= 5) allowWild = true;
  }
  const clean = all.filter((cards: CardId[]) => cards.every((card) => !isWild(card, rules)) && count(rankOf(cards[0]!)) === cards.length);
  if (clean.length > 0) return { type: "PLAY", cardIds: clean[0]! };
  if (allowWild && all.length > 0) return { type: "PLAY", cardIds: all[0]! };
  return { type: "PASS" };
}

function simplePolicy(teamAware: boolean): Policy {
  return (view, seat) => {
    const hand = view.players[seat]!.hand;
    switch (view.stage) {
      case "grab":
        return { type: "GRAB", grab: false };
      case "abdicate":
        return canCallTypes(hand).length > 0 ? { type: "ASCEND" } : { type: "ABDICATE" };
      case "call": {
        const types = canCallTypes(hand);
        const three = types.find((type) => type.count === 3);
        if (three) return { type: "CALL", suit: three.suit, rank: three.rank, mode: "pair" };
        return { type: "CALL", suit: types[0]!.suit, rank: types[0]!.rank, mode: "darkSolo" };
      }
      case "declare": {
        const options = legalCommands(view, view.players[seat]!.id);
        return options.find((command) => command.type === "DECLARE" && (command.choice === "darkGuard" || command.choice === "noRebel"))!;
      }
      case "playing":
        return greedyPlay(view, seat, teamAware);
      case "handEnd":
        return { type: "READY" };
    }
  };
}

export const POLICY_NAMES = ["bot", "random", "b1", "b2"] as const;
export type PolicyName = (typeof POLICY_NAMES)[number];

export function makePolicy(name: PolicyName, seed: number): Policy {
  if (name === "bot") return botCommand;
  if (name === "random") return randomPolicy(seed);
  return simplePolicy(name === "b2");
}

export interface GameResult {
  steps: number;
  hands: HandSummary[];
  scores: number[];
  /** timeBot 座位每次决策的毫秒数。 */
  botMs: number[];
  problems: string[];
}

/** 打完一整场。timed：这些座位的决策计时。 */
export function playGame(policies: Policy[], seed: number, options: Partial<GameOptions> = {}, timed: ReadonlySet<number> = new Set()): GameResult {
  const players = policies.map((_, seat) => ({ id: `p${seat}`, name: `座${seat}`, bot: true }));
  let state = createGame(players, seed, options);
  const hands: HandSummary[] = [];
  const botMs: number[] = [];
  const problems: string[] = [];
  let steps = 0;
  while (state.phase !== "finished") {
    if (steps > MAX_STEPS) {
      problems.push(`超过 ${MAX_STEPS} 步没打完`);
      break;
    }
    const pending = pendingSeats(state);
    if (pending.length === 0) {
      problems.push(`没人能动：stage=${state.stage}`);
      break;
    }
    for (const seat of pending) {
      if (!pendingSeats(state).includes(seat)) continue;
      const id = state.players[seat]!.id;
      const view = redactGameForViewer(state, id);
      const t0 = performance.now();
      let command: GameCommand;
      try {
        command = policies[seat]!(view, seat);
      } catch (error) {
        problems.push(`座 ${seat} 策略出错（${state.stage}）：${(error as Error).message}`);
        return { steps, hands, scores: state.players.map((player) => player.score), botMs, problems };
      }
      if (timed.has(seat)) botMs.push(performance.now() - t0);
      try {
        state = applyCommand(state, id, command);
      } catch (error) {
        problems.push(`座 ${seat} 不合法（${state.stage}）：${JSON.stringify(command)} ${(error as Error).message}`);
        return { steps, hands, scores: state.players.map((player) => player.score), botMs, problems };
      }
      steps += 1;
      for (const event of state.events) if (event.type === "HandEnded") hands.push(event.summary);
    }
  }
  return { steps, hands, scores: state.players.map((player) => player.score), botMs, problems };
}

export function timing(ms: number[]): { avg: number; p99: number; max: number } {
  if (ms.length === 0) return { avg: 0, p99: 0, max: 0 };
  const sorted = [...ms].sort((a, b) => a - b);
  return { avg: ms.reduce((a, b) => a + b, 0) / ms.length, p99: sorted[Math.floor(sorted.length * 0.99)]!, max: sorted[sorted.length - 1]! };
}

export type Role = "emperor" | "guard" | "rebel" | "solo";

export function roleOf(summary: HandSummary, seat: number): Role {
  if (seat === summary.emperor) return summary.mode === "pair" ? "emperor" : "solo";
  if (seat === summary.guard) return "guard";
  return "rebel";
}

export interface MatchStats {
  hands: number;
  /** 强人机每盘平均得分。 */
  mean: number;
  /** 95% 置信区间半宽。 */
  ci: number;
  byRole: Record<Role, { n: number; mean: number }>;
  /** 强人机整场第一（含并列）的比例。 */
  gameWin: number;
  games: number;
  problems: string[];
}

/** 1 个 hero 策略 + 4 个 villain 策略，hero 轮换座位。 */
export function match(hero: PolicyName, villain: PolicyName, games: number, seed: number, options: Partial<GameOptions> = { hands: 10 }): MatchStats {
  const deltas: number[] = [];
  const byRole: Record<Role, number[]> = { emperor: [], guard: [], rebel: [], solo: [] };
  let wins = 0;
  const problems: string[] = [];
  for (let g = 0; g < games; g += 1) {
    const heroSeat = g % 5;
    const policies = [0, 1, 2, 3, 4].map((seat) => makePolicy(seat === heroSeat ? hero : villain, seed + g * 7 + seat));
    const result = playGame(policies, seed + g, options);
    problems.push(...result.problems);
    for (const summary of result.hands) {
      const d = summary.deltas[heroSeat]!;
      deltas.push(d);
      byRole[roleOf(summary, heroSeat)].push(d);
    }
    const best = Math.max(...result.scores);
    if (result.scores[heroSeat] === best) wins += 1;
  }
  const mean = deltas.reduce((a, b) => a + b, 0) / Math.max(1, deltas.length);
  const variance = deltas.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, deltas.length - 1);
  const roleStats = Object.fromEntries(
    Object.entries(byRole).map(([role, list]) => [role, { n: list.length, mean: list.reduce((a, b) => a + b, 0) / Math.max(1, list.length) }]),
  ) as Record<Role, { n: number; mean: number }>;
  return { hands: deltas.length, mean, ci: 1.96 * Math.sqrt(variance / Math.max(1, deltas.length)), byRole: roleStats, gameWin: wins / games, games, problems };
}
