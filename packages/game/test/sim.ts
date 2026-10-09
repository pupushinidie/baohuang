/**
 * 随机对局：每一步在合法操作里随机挑（偶尔整步超时），一直打到整场结束，用普通代码检查不变量，
 * 最后汇总成一个违规清单（每步都 expect 太慢）。
 *
 * 检查的不变量：
 * - 配件守恒：手牌 + 打出的牌 = 168 张、不重复；handCount = 手牌张数；皇牌、贴牌在该在的人手里；
 * - 不卡死：没结束的状态总有人有合法操作；每场步数有上限；
 * - 回合推进：出牌阶段轮到的人手里有牌；version、step 不倒退；发牌张数 34/34/34/33/33；
 * - 计分：每盘零和，按名次独立重算的分数和引擎一致；一盘在「某一方都走完」的那一刻结束（不早不晚）；
 *   累计分 = 每盘得失之和；盘数、发牌起点（上一盘皇帝）对；终局赢家是最高分（可以并列）；
 * - 隐藏信息：每个座位视角、观战视角都拿不到种子、别人的手牌、别人的抢独 / 表态、没揭开的侍卫和暗独；
 *   任一座位的视角去掉自己的私有部分后，和公开视角一模一样（不会多漏任何东西）；
 *   暗独没揭开时，打出的牌里不会出现没亮的那张保牌；
 * - apply 不改输入。
 */
import {
  applyCommand,
  createGame,
  createRng,
  DECK_SIZE,
  HUANG_ID,
  kindKey,
  kindOf,
  legalCommands,
  pendingSeats,
  redactGameForViewer,
  spectatorGodView,
  timeoutTurn,
  type BaohuangState,
  type GameCommand,
  type GameOptions,
  type HandSummary,
} from "../src/index.js";

const SEATS = [0, 1, 2, 3, 4] as const;
const MAX_STEPS = 30_000;

export interface SimStats {
  games: number;
  hands: number;
  steps: number;
  redeals: number;
  modes: Record<string, number>;
  grabbed: number;
  forced: number;
  doubled: number;
  ties: number;
  tieCards: number;
  tehuaPlays: number;
  timeouts: number;
  violations: string[];
}

const open = (state: BaohuangState) => state.stage === "handEnd" || state.phase === "finished";

/** 去掉 viewer 自己的私有部分，应该和公开视角一样。 */
function stripPrivate(view: BaohuangState, viewer: number): BaohuangState {
  const copy = JSON.parse(JSON.stringify(view)) as BaohuangState;
  if (viewer < 0) return copy;
  const self = copy.players[viewer]!;
  self.grab = null;
  if (!open(copy)) {
    self.hand = [];
    self.declare = null;
    if (!copy.guardRevealed) {
      copy.guard = null;
      if (copy.mode === "darkSolo") copy.mode = "pair";
    }
  }
  return copy;
}

/** 按规则书第 6 节独立算一盘的分。 */
function expectedDeltas(summary: HandSummary): number[] {
  const { emperor, guard, mode, multiplier, places, finishOrder } = summary;
  if (mode === "pair") {
    const assumed = [...places];
    SEATS.filter((seat) => places[seat] === null).forEach((seat, index) => (assumed[seat] = finishOrder.length + 1 + index));
    const s = (6 - (assumed[emperor]! + assumed[guard]!)) * multiplier;
    return SEATS.map((seat) => (seat === emperor ? 2 * s : seat === guard ? s : -s) + 0);
  }
  const place = places[emperor];
  if (mode === "openSolo") return SEATS.map((seat) => (seat === emperor ? (place === 1 ? 24 : -24) : place === 1 ? -6 : 6));
  const win = place === 1 ? 1 : place === 2 ? 0 : -1;
  return SEATS.map((seat) => (seat === emperor ? 12 * win * multiplier : -3 * win * multiplier) + 0);
}

/** 一盘「该结束了」的条件（5.5）。 */
function handShouldEnd(mode: string, emperor: number, guard: number, done: ReadonlySet<number>): boolean {
  const rebels = SEATS.filter((seat) => seat !== emperor && seat !== guard);
  if (mode === "pair") return (done.has(emperor) && done.has(guard)) || rebels.every((seat) => done.has(seat));
  if (mode === "darkSolo") return done.has(emperor) || rebels.filter((seat) => done.has(seat)).length >= 2;
  return done.size > 0;
}

function pickCommand(state: BaohuangState, seat: number, rng: ReturnType<typeof createRng>): GameCommand | null {
  const options = legalCommands(state, state.players[seat]!.id);
  if (options.length === 0) return null;
  if (state.stage === "grab") return { type: "GRAB", grab: rng.next() < 0.08 };
  if (state.stage === "declare") {
    // 造反 20%、明保 30%：让「没被揭开的侍卫 / 暗独」的局面多一些，隐藏信息查得到。
    const choices = options.map((command) => (command.type === "DECLARE" ? command.choice : null));
    if (choices.includes("openGuard")) return { type: "DECLARE", choice: rng.next() < 0.3 ? "openGuard" : "darkGuard" };
    if (choices.includes("rebel")) return { type: "DECLARE", choice: rng.next() < 0.2 ? "rebel" : "noRebel" };
  }
  if (state.stage === "playing" && state.lastPlay && rng.next() < 0.35) return { type: "PASS" };
  return options[rng.int(options.length)]!;
}

export function runSims(options: Partial<GameOptions>, games: number, seed: number): SimStats {
  const stats: SimStats = { games, hands: 0, steps: 0, redeals: 0, modes: {}, grabbed: 0, forced: 0, doubled: 0, ties: 0, tieCards: 0, tehuaPlays: 0, timeouts: 0, violations: [] };
  const fail = (game: number, step: number, message: string) => {
    if (stats.violations.length < 30) stats.violations.push(`第 ${game} 局第 ${step} 步：${message}`);
  };
  for (let game = 0; game < games; game += 1) {
    const rng = createRng(seed * 1000 + game);
    let state = createGame(SEATS.map((seat) => ({ id: `p${seat}`, name: `玩家${seat}`, bot: seat >= 3 })), seed * 7919 + game, { ...options, hands: 3 });
    let step = 0;
    let lastHand = 0;
    let lastEmperor: number | null = null;
    let scoreSum = [0, 0, 0, 0, 0];
    let handStartChecked = "";
    while (state.phase !== "finished") {
      step += 1;
      if (step > MAX_STEPS) {
        fail(game, step, "步数超过上限（卡死或死循环）");
        break;
      }
      const prev = state;
      // ---- 每一步的不变量
      const all = [...state.players.flatMap((player) => player.hand), ...state.played];
      if (all.length !== DECK_SIZE) fail(game, step, `牌数 ${all.length}`);
      if (state.players.some((player) => player.handCount !== player.hand.length)) fail(game, step, "handCount 不对");
      const pending = pendingSeats(state);
      const movable = pending.filter((seat) => legalCommands(state, state.players[seat]!.id).length > 0);
      if (movable.length === 0) fail(game, step, `卡死：阶段 ${state.stage}，没有人能操作`);
      if (state.stage === "playing" && state.players[state.turn]!.hand.length === 0) fail(game, step, "轮到的人没有牌");
      if (state.stage === "abdicate" || state.stage === "grab") {
        if (!state.players[state.huangHolder!]!.hand.includes(HUANG_ID)) fail(game, step, "皇牌不在持有者手里");
        for (const card of state.tiePile) if (!state.players[state.huangHolder!]!.hand.includes(card)) fail(game, step, "贴牌不在持有者手里");
      }
      // 新的一盘（或重发）：张数 34/34/34/33/33、不重复、盘数和发牌起点。
      const dealKey = `${state.handNo}:${state.redeals}`;
      if (dealKey !== handStartChecked && (state.stage === "abdicate" || state.stage === "grab") && state.abdications.length === 0) {
        handStartChecked = dealKey;
        if (new Set(all).size !== DECK_SIZE) fail(game, step, "牌有重复");
        const sizes = SEATS.map((seat) => state.players[seat]!.hand.length);
        const want = SEATS.map((seat) => ((seat - state.dealStart + 5) % 5 < 3 ? 34 : 33));
        if (sizes.join() !== want.join()) fail(game, step, `发牌张数 ${sizes} ≠ ${want}`);
        if (state.handNo !== lastHand && state.handNo !== lastHand + 1) fail(game, step, "盘数跳了");
        if (state.handNo === lastHand + 1 && lastEmperor !== null && state.dealStart !== lastEmperor) fail(game, step, "发牌起点不是上一盘皇帝");
      }
      // ---- 隐藏信息（同时选的阶段、叫保后每步都查，出牌阶段抽查）
      if (state.stage !== "playing" || step % 5 === 0) checkHidden(state, (message) => fail(game, step, message));

      // ---- 走一步
      let next: BaohuangState;
      const snapshot = step % 40 === 0 ? JSON.stringify(state) : "";
      if (rng.next() < 0.03) {
        next = timeoutTurn(state);
        stats.timeouts += 1;
      } else {
        const seat = movable[rng.int(movable.length)]!;
        const command = pickCommand(state, seat, rng);
        if (!command) {
          fail(game, step, "没有合法操作");
          break;
        }
        try {
          next = applyCommand(state, state.players[seat]!.id, command);
        } catch (error) {
          fail(game, step, `合法操作被拒：${JSON.stringify(command)} ${(error as Error).message}`);
          break;
        }
        if (command.type === "PLAY" && state.tehua && command.cardIds.includes(state.tehua)) stats.tehuaPlays += 1;
      }
      if (snapshot && JSON.stringify(state) !== snapshot) fail(game, step, "apply 改了输入");
      if (next.version < prev.version || next.step < prev.step) fail(game, step, "version / step 倒退");
      if (next.redeals > prev.redeals && next.handNo === prev.handNo) stats.redeals += 1;
      if (next.abdications.length > prev.abdications.length) {
        const last = next.events.find((event) => event.type === "Abdicated");
        if (last && last.type === "Abdicated" && last.tie) stats.tieCards += 1;
      }
      // 一盘刚结束
      if (next.stage === "handEnd" && prev.stage !== "handEnd") {
        const summary = next.summary!;
        stats.hands += 1;
        stats.modes[summary.mode] = (stats.modes[summary.mode] ?? 0) + 1;
        if (summary.grabbed) stats.grabbed += 1;
        if (summary.forced) stats.forced += 1;
        if (summary.multiplier === 2) stats.doubled += 1;
        if (summary.deltas.reduce((a, b) => a + b, 0) !== 0) fail(game, step, `不是零和：${summary.deltas}`);
        const expected = expectedDeltas(summary);
        if (expected.join() !== summary.deltas.join()) fail(game, step, `分数 ${summary.deltas} ≠ 规则 ${expected}`);
        const done = new Set(summary.finishOrder);
        if (done.size !== summary.finishOrder.length) fail(game, step, "走科顺序有重复");
        if (!handShouldEnd(summary.mode, summary.emperor, summary.guard, done)) fail(game, step, "还没到结束条件就结束了");
        const before = new Set(summary.finishOrder.slice(0, -1));
        if (handShouldEnd(summary.mode, summary.emperor, summary.guard, before)) fail(game, step, "该结束时没结束");
        summary.finishOrder.forEach((seat, index) => {
          if (summary.places[seat] !== index + 1) fail(game, step, "名次不对");
        });
        if (summary.places.filter((place) => place !== null).length !== summary.finishOrder.length) fail(game, step, "名次数量不对");
        const cards = [...summary.leftovers.flat(), ...next.played];
        if (cards.length !== DECK_SIZE || new Set(cards).size !== DECK_SIZE) fail(game, step, "结算时牌不守恒");
        scoreSum = scoreSum.map((sum, seat) => sum + summary.deltas[seat]!);
        if (next.players.some((player, seat) => player.score !== scoreSum[seat])) fail(game, step, "累计分不等于每盘之和");
        if (summary.mode === "pair") {
          const kind = kindKey(summary.guardCard!.suit, summary.guardCard!.rank);
          if (prev.played.concat(prev.players.flatMap((player) => player.hand)).filter((card) => kindOf(card) === kind).length !== 4) fail(game, step, "保牌不是 4 张");
        }
        lastHand = next.handNo;
        lastEmperor = summary.emperor;
      }
      state = next;
    }
    stats.steps += step;
    if (state.phase === "finished") {
      const scores = state.players.map((player) => player.score);
      const top = Math.max(...scores);
      const winners = state.players.filter((player) => player.score === top).map((player) => player.id);
      if (JSON.stringify(state.finalResult?.winners) !== JSON.stringify(winners)) fail(game, step, "终局赢家不对");
      if (winners.length > 1) stats.ties += 1;
      if (state.handNo !== 3) fail(game, step, `打了 ${state.handNo} 盘`);
      if (scores.reduce((a, b) => a + b, 0) !== 0) fail(game, step, "整场不是零和");
    }
  }
  return stats;
}

function checkHidden(state: BaohuangState, fail: (message: string) => void): void {
  const publicView = redactGameForViewer(state, "");
  const publicJson = JSON.stringify(publicView);
  const isOpen = open(state);
  for (const key of ["rng", "seed", "log", "timedOut"] as const) {
    if (key in publicView) fail(`公开视角带了 ${key}`);
  }
  for (const viewer of SEATS) {
    const view = redactGameForViewer(state, state.players[viewer]!.id);
    for (const key of ["rng", "seed", "log", "timedOut"] as const) if (key in view) fail(`座位 ${viewer} 的视角带了 ${key}`);
    SEATS.forEach((other) => {
      if (other === viewer) return;
      const player = view.players[other]!;
      if (player.grab !== null) fail(`座位 ${viewer} 看到了 ${other} 的抢独选择`);
      if (!isOpen && player.hand.length > 0) fail(`座位 ${viewer} 看到了 ${other} 的手牌`);
      if (!isOpen && player.declare !== null) fail(`座位 ${viewer} 看到了 ${other} 的表态`);
    });
    if (!isOpen && !state.guardRevealed) {
      if (view.guard !== null && viewer !== state.guard) fail(`座位 ${viewer} 看到了侍卫是谁`);
      if (view.mode === "darkSolo" && viewer !== state.emperor) fail(`座位 ${viewer} 看到了暗独`);
    }
    if (JSON.stringify(stripPrivate(view, viewer)) !== publicJson) fail(`座位 ${viewer} 的视角比公开视角多了别的东西`);
  }
  // 暗独没揭开：打出的牌里没有没亮的那张保牌（同一种牌先用亮过的）。
  if (state.mode === "darkSolo" && !state.guardRevealed && state.guardCard) {
    const kind = kindKey(state.guardCard.suit, state.guardCard.rank);
    if (state.played.some((card) => kindOf(card) === kind && !state.shownCards.includes(card))) fail("暗独没揭开就打出了没亮的那张");
  }
  // 公开视角里没揭开的侍卫：DeclaresRevealed / GuardRevealed 事件里不带他。
  if (!isOpen && !state.guardRevealed) {
    const thisHand = publicView.history.slice(publicView.history.map((event) => event.type).lastIndexOf("HandStarted"));
    if (thisHand.some((event) => event.type === "GuardRevealed" || (event.type === "DeclaresRevealed" && event.guard !== null))) fail("事件里提前公开了侍卫");
  }
  // 观战上帝视角也不带种子。
  const god = spectatorGodView(state);
  for (const key of ["rng", "seed", "log", "timedOut"] as const) if (key in god) fail(`观战上帝视角带了 ${key}`);
}
