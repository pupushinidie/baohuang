/**
 * 保皇规则引擎。规则书：~/Desktop/游戏规则/保皇.md；补充和勘误：保皇-补充.md（K1–K7、变体 V1–V12）。
 *
 * 纯函数：applyBaohuang 不改输入，返回新状态和事件。所有随机（座位、第 1 盘发牌起点、洗牌、暗独藏哪一张）
 * 都用状态里的种子随机数（state.rng），服务端持有，不下发。
 *
 * 一盘：发牌 → 抢独（选项）→ 登基 / 让位（贴牌选项）→ 逼位或重发 → 叫保 → 表态（明独跳过）→ 出牌 → 结算。
 */
import {
  canAscend,
  canCallTypes,
  compareCards,
  DECK_SIZE,
  fullDeck,
  HUANG_ID,
  isJoker,
  kindKey,
  kindOf,
  mustAscend,
  rankOf,
  SUITS,
  sortCards,
  type CardId,
  type Suit,
} from "./cards.js";
import { checkPlay, effRank, isWild, playOptions, type SetRules } from "./sets.js";
import { createRng, type Rng } from "./rng.js";
import type {
  BaohuangCommand,
  BaohuangConfig,
  BaohuangEvent,
  BaohuangOptions,
  BaohuangPlayer,
  BaohuangState,
  Declare,
  HandSummary,
  Mode,
} from "./types.js";

export const SEAT_COUNT = 5;
export const HISTORY_LIMIT = 60;
const SEATS = [0, 1, 2, 3, 4] as const;

export const DEFAULT_OPTIONS: BaohuangOptions = { hands: 5, grabSolo: false, bie6: false, rebel: true, tieCard: false, tehua: false };

export function baohuangConfig(options: Partial<BaohuangOptions> = {}, overrides: Partial<BaohuangConfig> = {}): BaohuangConfig {
  return {
    ...DEFAULT_OPTIONS,
    ...options,
    // 规则书 9.4：登基 / 让位 10 秒；叫保 15 秒；表态 10 秒；出牌 25 秒。抢独 5 秒（3.3）。结算画面 15 秒。
    grabSec: 5,
    abdicateSec: 10,
    callSec: 15,
    declareSec: 10,
    playSec: 25,
    handEndSec: 15,
    ...overrides,
  };
}

export interface NewPlayer {
  readonly id: string;
  readonly name: string;
  readonly bot?: boolean;
}

interface Ctx {
  readonly state: BaohuangState;
  readonly rng: Rng;
  readonly events: BaohuangEvent[];
  /** 这一步有没有公开的变化（同时选的阶段里单个人的选择没有）。 */
  publicChange: boolean;
}

/** 下家（下一个出牌的人）。 */
export const nextSeat = (seat: number) => (seat + 1) % SEAT_COUNT;
/** 上家（让位交给他）。 */
export const prevSeat = (seat: number) => (seat + SEAT_COUNT - 1) % SEAT_COUNT;

/**
 * 复制一份状态（比 structuredClone 快很多）：会被原地改的数组和玩家对象都复制一份；
 * 事件、上一手牌、结算这些创建后不再改的对象共用。改引擎时如果开始原地改别的字段，要加到这里
 * （随机对局测试会检查 apply 不改输入）。
 */
export function cloneState(state: BaohuangState): BaohuangState {
  const next: BaohuangState = {
    ...state,
    players: state.players.map((player) => ({ ...player, hand: [...player.hand] })),
    abdications: [...state.abdications],
    tiePile: [...state.tiePile],
    shownCards: [...state.shownCards],
    table: [...state.table],
    played: [...state.played],
    finishOrder: [...state.finishOrder],
    ready: [...state.ready],
    events: [...state.events],
    history: [...state.history],
  };
  if (state.log) next.log = [...state.log];
  if (state.timedOut) next.timedOut = [...state.timedOut];
  return next;
}

function fail(message: string): never {
  throw new Error(message);
}

/** 出牌用的规则（特画、憋 6）。 */
export function setRules(state: Pick<BaohuangState, "tehua" | "config">): SetRules {
  return { tehua: state.config.tehua ? state.tehua : null, bie6: state.config.bie6 };
}

// ---------------------------------------------------------------------------
// 查询

/** 现在要做决定的座位。 */
export function pendingSeats(state: BaohuangState): number[] {
  if (state.phase === "finished") return [];
  switch (state.stage) {
    case "grab":
      return SEATS.filter((seat) => state.players[seat]!.grab === null);
    case "declare":
      return SEATS.filter((seat) => seat !== state.emperor && state.players[seat]!.declare === null);
    case "handEnd":
      return SEATS.filter((seat) => !state.ready.includes(state.players[seat]!.id));
    default:
      return state.turn >= 0 ? [state.turn] : [];
  }
}

/** 当前这一步的限时（秒）。 */
export function stepSeconds(state: BaohuangState): number {
  const config = state.config;
  switch (state.stage) {
    case "grab":
      return config.grabSec;
    case "abdicate":
      return config.abdicateSec;
    case "call":
      return config.callSec;
    case "declare":
      return config.declareSec;
    case "playing":
      return config.playSec;
    case "handEnd":
      return config.handEndSec;
  }
}

/** 同时选的阶段（抢独、表态、结算）：所有人一起倒计时，不公开谁已经选了。 */
export const isSimultaneous = (state: Pick<BaohuangState, "stage">): boolean => state.stage === "grab" || state.stage === "declare" || state.stage === "handEnd";

/** 这个座位在表态阶段能选的（看他自己能看到的信息就能算：侍卫知道自己是侍卫）。 */
export function declareChoices(state: BaohuangState, seat: number): Declare[] {
  if (seat === state.emperor) return [];
  if (state.mode === "pair" && state.guard === seat) return ["openGuard", "darkGuard"];
  return state.config.rebel ? ["rebel", "noRebel"] : ["noRebel"];
}

/** 还有牌的座位。 */
const activeSeats = (state: BaohuangState) => SEATS.filter((seat) => state.players[seat]!.hand.length > 0);

/** seat 之后（逆时针）第一个手里还有牌的人。 */
function nextActive(state: BaohuangState, seat: number): number {
  for (let k = 1; k <= SEAT_COUNT; k += 1) {
    const candidate = (seat + k) % SEAT_COUNT;
    if (state.players[candidate]!.hand.length > 0) return candidate;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// 开局

function blankHandFields(): Pick<BaohuangPlayer, "handDelta" | "hand" | "handCount" | "grab" | "declare" | "declarePublic" | "place"> {
  return { handDelta: 0, hand: [], handCount: 0, grab: null, declare: null, declarePublic: null, place: null };
}

export function createBaohuang(players: readonly NewPlayer[], seed: number, options: Partial<BaohuangOptions> = {}, overrides: Partial<BaohuangConfig> = {}): BaohuangState {
  if (players.length !== SEAT_COUNT) throw new Error("保皇需要 5 个座位。");
  const rng = createRng(seed);
  const seated = rng.shuffle(players);
  const state: BaohuangState = {
    config: baohuangConfig(options, overrides),
    phase: "playing",
    players: seated.map((player) => ({ id: player.id, name: player.name, bot: player.bot === true, auto: false, timeouts: 0, score: 0, ...blankHandFields() })),
    handNo: 0,
    redeals: 0,
    // 第 1 盘的发牌起点随机（开工拍板待确认 7）。
    dealStart: rng.int(SEAT_COUNT),
    stage: "abdicate",
    turn: -1,
    huangHolder0: null,
    huangHolder: null,
    abdications: [],
    tiePile: [],
    forced: false,
    grabber: null,
    emperor: null,
    guardCard: null,
    shownCards: [],
    tehua: null,
    guard: null,
    mode: null,
    declaresRevealed: false,
    doubled: false,
    doubleReason: null,
    guardRevealed: false,
    revealReason: null,
    rebelFailed: null,
    lastPlay: null,
    passes: 0,
    table: [null, null, null, null, null],
    played: [],
    finishOrder: [],
    summary: null,
    ready: [],
    events: [],
    history: [],
    version: 0,
    step: 0,
    seed,
    log: [],
  };
  const ctx: Ctx = { state, rng, events: [], publicChange: true };
  startHand(ctx);
  return finish(ctx);
}

function startHand(ctx: Ctx): void {
  const { state } = ctx;
  state.handNo += 1;
  state.redeals = 0;
  state.summary = null;
  state.ready = [];
  ctx.events.push({ type: "HandStarted", handNo: state.handNo, dealStart: state.dealStart });
  deal(ctx);
}

/** 清掉上一次发牌留下的东西（重发时也用）。 */
function resetDeal(state: BaohuangState): void {
  for (const player of state.players) Object.assign(player, { ...blankHandFields(), score: player.score });
  state.huangHolder0 = null;
  state.huangHolder = null;
  state.abdications = [];
  state.tiePile = [];
  state.forced = false;
  state.grabber = null;
  state.emperor = null;
  state.guardCard = null;
  state.shownCards = [];
  state.tehua = null;
  state.guard = null;
  state.mode = null;
  state.declaresRevealed = false;
  state.doubled = false;
  state.doubleReason = null;
  state.guardRevealed = false;
  state.revealReason = null;
  state.rebelFailed = null;
  state.lastPlay = null;
  state.passes = 0;
  state.table = [null, null, null, null, null];
  state.played = [];
  state.finishOrder = [];
  delete state.timedOut;
}

/**
 * 洗牌发牌（3.2）：168 张从发牌起点开始按座位顺序一张张发完——起点和它后面两个座位各 34 张，另外两个各 33 张。
 * hands 给了就直接用（测试、预览局面）。
 */
function deal(ctx: Ctx, hands?: readonly (readonly CardId[])[]): void {
  const { state, rng } = ctx;
  resetDeal(state);
  if (hands) {
    SEATS.forEach((seat) => {
      state.players[seat]!.hand = sortCards(hands[seat]!);
    });
  } else {
    const deck = rng.shuffle(fullDeck());
    deck.forEach((card, index) => {
      state.players[(state.dealStart + index) % SEAT_COUNT]!.hand.push(card);
    });
    for (const player of state.players) player.hand = sortCards(player.hand);
  }
  const holder = SEATS.find((seat) => state.players[seat]!.hand.includes(HUANG_ID));
  if (holder === undefined) fail("皇牌不在任何人手里。");
  state.huangHolder0 = holder;
  state.huangHolder = holder;
  ctx.events.push({ type: "Dealt", dealStart: state.dealStart, huangHolder: holder, redeal: state.redeals });
  if (state.config.grabSolo) {
    state.stage = "grab";
    state.turn = -1;
  } else {
    state.stage = "abdicate";
    state.turn = holder;
  }
  state.step += 1;
}

/**
 * 测试、预览局面用：用指定的 5 手牌重新发这一盘（发完进入抢独或登基阶段）。
 * 不要求 168 张（教程可以每人只发几张），但不能有重复的牌，皇牌必须在某人手里。
 */
export function stackDeal(state: BaohuangState, hands: readonly (readonly CardId[])[], dealStart?: number): BaohuangState {
  if (hands.length !== SEAT_COUNT) throw new Error("要给 5 手牌。");
  const all = hands.flat();
  if (new Set(all).size !== all.length) throw new Error("牌有重复。");
  const next = cloneState(state);
  const ctx: Ctx = { state: next, rng: createRng(next.rng ?? 1), events: [], publicChange: true };
  if (dealStart !== undefined) next.dealStart = dealStart;
  next.phase = "playing";
  next.summary = null;
  next.ready = [];
  deal(ctx, hands);
  return finish(ctx);
}

// ---------------------------------------------------------------------------
// 动作

export function applyBaohuang(input: BaohuangState, playerId: string, command: BaohuangCommand | { type: "TIMEOUT"; seats?: readonly number[] }): { state: BaohuangState; events: BaohuangEvent[] } {
  if (input.phase === "finished" && command.type !== "AUTO") fail("对局已经结束。");
  if (!command || typeof command !== "object" || typeof command.type !== "string") fail("不认识的操作。");
  const state = cloneState(input);
  const ctx: Ctx = { state, rng: createRng(state.rng ?? 1), events: [], publicChange: true };

  if (command.type === "TIMEOUT") {
    timeoutAll(ctx, command.seats);
    return { state: finish(ctx, input), events: ctx.events };
  }
  const seat = state.players.findIndex((player) => player.id === playerId);
  if (seat < 0) fail("你不在这局里。");
  if (command.type === "AUTO") {
    state.log?.push({ seat, command });
    setAuto(ctx, seat, command.on === true);
    return { state: finish(ctx, input), events: ctx.events };
  }
  act(ctx, seat, command);
  state.log?.push({ seat, command });
  // 同时选的阶段里单个人的选择不改公开字段（连「超时次数清零」也等公布时再算）。
  if (ctx.publicChange && command.type !== "GRAB" && command.type !== "DECLARE") state.players[seat]!.timeouts = 0;
  return { state: finish(ctx, input), events: ctx.events };
}

function setAuto(ctx: Ctx, seat: number, on: boolean): void {
  const player = ctx.state.players[seat]!;
  if (player.auto === on) {
    ctx.publicChange = false;
    return;
  }
  player.auto = on;
  player.timeouts = 0;
  ctx.events.push({ type: "AutoChanged", seat, on });
}

function act(ctx: Ctx, seat: number, command: BaohuangCommand, auto = false): void {
  switch (command.type) {
    case "GRAB":
      return chooseGrab(ctx, seat, command.grab === true);
    case "ASCEND":
      return ascend(ctx, seat);
    case "ABDICATE":
      return abdicate(ctx, seat);
    case "CALL":
      return callGuard(ctx, seat, command.suit, command.rank, command.mode);
    case "DECLARE":
      return chooseDeclare(ctx, seat, command.choice);
    case "PLAY":
      return play(ctx, seat, command.cardIds, auto);
    case "PASS":
      return pass(ctx, seat, auto);
    case "READY":
      return markReady(ctx, seat);
    case "AUTO":
      return setAuto(ctx, seat, command.on === true);
    default:
      fail("不认识的操作。");
  }
}

function requireTurn(state: BaohuangState, seat: number, stage: BaohuangState["stage"], message: string): void {
  if (state.stage !== stage) fail(message);
  if (state.turn !== seat) fail("还没轮到你。");
}

/** 把一些牌从 from 的手里挪到 to 的手里。 */
function moveCards(state: BaohuangState, from: number, to: number, cards: readonly CardId[]): void {
  if (from === to || cards.length === 0) return;
  const moving = new Set(cards);
  const giver = state.players[from]!;
  if (cards.some((card) => !giver.hand.includes(card))) fail("要交出的牌不在手里。");
  giver.hand = giver.hand.filter((card) => !moving.has(card));
  const taker = state.players[to]!;
  taker.hand = sortCards([...taker.hand, ...cards]);
}

// ---- 抢独（3.3）

function chooseGrab(ctx: Ctx, seat: number, grab: boolean): void {
  const { state } = ctx;
  if (state.stage !== "grab") fail("现在不是抢独的时候。");
  const player = state.players[seat]!;
  if (player.grab !== null) fail("你已经选过了。");
  player.grab = grab;
  ctx.publicChange = false;
  if (state.players.every((candidate) => candidate.grab !== null)) resolveGrab(ctx);
}

/** 所有人选完（或超时）：拿皇牌的人优先，然后从他的上家往上家方向数，最近的那个人抢成。 */
function resolveGrab(ctx: Ctx): void {
  const { state } = ctx;
  ctx.publicChange = true;
  const holder = state.huangHolder!;
  let winner: number | null = null;
  for (let k = 0; k < SEAT_COUNT; k += 1) {
    const seat = (holder - k + SEAT_COUNT) % SEAT_COUNT;
    if (state.players[seat]!.grab === true) {
      winner = seat;
      break;
    }
  }
  if (winner === null) {
    ctx.events.push({ type: "GrabResolved", seat: null, from: null });
    state.stage = "abdicate";
    state.turn = holder;
    state.step += 1;
    return;
  }
  // 抢成的人从持有者手里拿过皇牌（不贴牌，补充 V6），直接当明独皇帝，跳过登基、叫保、表态。
  moveCards(state, holder, winner, [HUANG_ID]);
  state.huangHolder = winner;
  state.grabber = winner;
  state.emperor = winner;
  state.guard = winner;
  state.mode = "openSolo";
  state.guardRevealed = true;
  state.revealReason = "openSolo";
  ctx.events.push({ type: "GrabResolved", seat: winner, from: holder });
  startPlay(ctx);
}

// ---- 登基、让位、逼位（3.4，补充 4.1）

function ascend(ctx: Ctx, seat: number): void {
  const { state } = ctx;
  requireTurn(state, seat, "abdicate", "现在不是登基的时候。");
  if (!canAscend(state.players[seat]!.hand)) fail("你没有能叫保的牌（同花色同点数恰好 3 张或 4 张），只能让位。");
  becomeEmperor(ctx, seat, false);
}

function becomeEmperor(ctx: Ctx, seat: number, forced: boolean): void {
  const { state } = ctx;
  state.emperor = seat;
  state.forced = forced;
  state.huangHolder = seat;
  state.tiePile = [];
  ctx.events.push({ type: "Ascended", seat, forced });
  state.stage = "call";
  state.turn = seat;
  state.step += 1;
}

/**
 * 让位贴牌选哪一张（补充 4.1 第 2、3 条）：手里点数最大的非王牌（有 2 就是 2）；同点数几张时，
 * 先选「这种花色+点数在手里不是 3 张也不是 4 张」的，再选这种牌张数多的，再按黑红梅方、id 小的。
 * carried 是要一起交出去的累积贴牌（不算在自己的手牌里）。
 */
export function chooseTieCard(hand: readonly CardId[], carried: readonly CardId[] = []): CardId | null {
  const carriedSet = new Set(carried);
  const own = hand.filter((card) => !carriedSet.has(card));
  const candidates = own.filter((card) => !isJoker(card));
  if (candidates.length === 0) return null;
  const top = Math.max(...candidates.map(rankOf));
  const counts = new Map<string, number>();
  for (const card of candidates) counts.set(kindOf(card)!, (counts.get(kindOf(card)!) ?? 0) + 1);
  const score = (card: CardId) => {
    const count = counts.get(kindOf(card)!)!;
    return [count === 3 || count === 4 ? 1 : 0, -count] as const;
  };
  return candidates
    .filter((card) => rankOf(card) === top)
    .sort((a, b) => {
      const [ta, ca] = score(a);
      const [tb, cb] = score(b);
      return ta - tb || ca - cb || compareCards(a, b);
    })[0]!;
}

function abdicate(ctx: Ctx, seat: number): void {
  const { state } = ctx;
  requireTurn(state, seat, "abdicate", "现在不是让位的时候。");
  const count = state.abdications.length + 1;
  const to = prevSeat(seat);
  let tie: CardId | null = null;
  if (state.config.tieCard && count >= 2) {
    tie = chooseTieCard(state.players[seat]!.hand.filter((card) => card !== HUANG_ID), state.tiePile);
    if (tie) state.tiePile = [...state.tiePile, tie];
  }
  const carried = [...state.tiePile];
  moveCards(state, seat, to, [HUANG_ID, ...carried]);
  state.abdications.push(seat);
  state.huangHolder = to;
  ctx.events.push({ type: "Abdicated", from: seat, to, count, tie, carried });
  if (state.abdications.length >= SEAT_COUNT) return forceAscend(ctx);
  state.turn = to;
  state.step += 1;
}

/**
 * 逼位（3.4 第 4 步，开工拍板待确认 3 + K7 选 A）：皇牌转了一整圈回到 H₀，按 H₀、H₀+1……的顺序，
 * 第一个有「恰好 3 张」的人必须登基，皇牌（和累积贴牌，不再新贴）交给他；都没有就重发。
 */
function forceAscend(ctx: Ctx): void {
  const { state } = ctx;
  const h0 = state.huangHolder0!;
  const holder = state.huangHolder!;
  for (let k = 0; k < SEAT_COUNT; k += 1) {
    const seat = (h0 + k) % SEAT_COUNT;
    if (!mustAscend(state.players[seat]!.hand)) continue;
    const carried = [...state.tiePile];
    moveCards(state, holder, seat, [HUANG_ID, ...carried]);
    ctx.events.push({ type: "Forced", from: holder, seat, carried });
    becomeEmperor(ctx, seat, true);
    return;
  }
  // 5 个人都没有「恰好 3 张」：本盘作废，重新洗牌发牌（发牌起点不变，盘数不加）。
  state.redeals += 1;
  ctx.events.push({ type: "Redeal", count: state.redeals });
  deal(ctx);
}

// ---- 叫保（3.5，补充 4.2 第 1 条）

function callGuard(ctx: Ctx, seat: number, suit: Suit, rank: number, mode: Mode): void {
  const { state, rng } = ctx;
  requireTurn(state, seat, "call", "现在不是叫保的时候。");
  if (!SUITS.includes(suit)) fail("花色不对。");
  const type = canCallTypes(state.players[seat]!.hand).find((candidate) => candidate.suit === suit && candidate.rank === rank);
  if (!type) fail("你手里没有这种能叫的牌（要同花色同点数恰好 3 张或 4 张）。");
  if (type.count === 3 && mode !== "pair") fail("3 张只能叫侍卫（4 张才能独保）。");
  if (type.count === 4 && mode !== "darkSolo" && mode !== "openSolo") fail("4 张同花同点只能独保：暗独或明独。");
  const kind = kindKey(suit, rank);
  const copies = state.players[seat]!.hand.filter((card) => kindOf(card) === kind);
  state.guardCard = { suit, rank };
  state.mode = mode;
  if (mode === "pair") {
    const guard = SEATS.find((other) => other !== seat && state.players[other]!.hand.some((card) => kindOf(card) === kind));
    if (guard === undefined) fail("第 4 张保牌不在任何人手里。");
    state.guard = guard;
    state.shownCards = sortCards(copies);
    const fourth = state.players[guard]!.hand.find((card) => kindOf(card) === kind)!;
    state.tehua = state.config.tehua ? fourth : null;
  } else if (mode === "darkSolo") {
    // 暗独：只亮 3 张；藏哪一张随机，免得从亮出的是哪几副看出是不是暗独。
    const hidden = copies[rng.int(copies.length)]!;
    state.guard = seat;
    state.shownCards = sortCards(copies.filter((card) => card !== hidden));
    state.tehua = state.config.tehua ? hidden : null;
  } else {
    state.guard = seat;
    state.shownCards = sortCards(copies);
    state.tehua = null;
    state.guardRevealed = true;
    state.revealReason = "openSolo";
  }
  ctx.events.push({ type: "GuardCalled", emperor: seat, suit, rank, shown: [...state.shownCards], open: mode === "openSolo" });
  if (mode === "openSolo") return startPlay(ctx);
  state.stage = "declare";
  state.turn = -1;
  state.step += 1;
}

// ---- 表态（3.6）

function chooseDeclare(ctx: Ctx, seat: number, choice: Declare): void {
  const { state } = ctx;
  if (state.stage !== "declare") fail("现在不是表态的时候。");
  if (seat === state.emperor) fail("皇帝不用表态。");
  const player = state.players[seat]!;
  if (player.declare !== null) fail("你已经选过了。");
  if (!declareChoices(state, seat).includes(choice)) fail(state.mode === "pair" && state.guard === seat ? "你是侍卫，只能选明保或暗保。" : "你只能选造反或不造反。");
  player.declare = choice;
  ctx.publicChange = false;
  if (SEATS.every((other) => other === state.emperor || state.players[other]!.declare !== null)) resolveDeclares(ctx);
}

/** 4 个人都选完（或超时）后一起公布（3.6 表格、9.3）。 */
function resolveDeclares(ctx: Ctx): void {
  const { state } = ctx;
  ctx.publicChange = true;
  const emperor = state.emperor!;
  const guard = state.guard!;
  const others = SEATS.filter((seat) => seat !== emperor);
  const guardSeat = state.mode === "pair" ? guard : null;
  const rebels = others.filter((seat) => seat !== guardSeat && state.players[seat]!.declare === "rebel");
  const openGuard = guardSeat !== null && state.players[guardSeat]!.declare === "openGuard";
  let reveal: "openGuard" | "rebel" | null = null;
  if (openGuard) reveal = "openGuard";
  else if (rebels.length >= 2) reveal = "rebel";
  for (const seat of others) {
    const player = state.players[seat]!;
    if (reveal) player.declarePublic = player.declare;
    else if (rebels.length === 1 && seat === rebels[0]) player.declarePublic = "rebel";
    // 侍卫暗保又没被揭开：对外和普通革命党一样显示「不造反」。
    else player.declarePublic = "noRebel";
  }
  if (reveal) {
    state.doubled = true;
    state.doubleReason = reveal;
    state.guardRevealed = true;
    state.revealReason = reveal;
  } else if (rebels.length === 1) {
    state.rebelFailed = rebels[0]!;
  }
  state.declaresRevealed = true;
  // 超时次数：自己选了的清零，超时的 +1（连续 2 次转托管）。公布时一起算，免得别人从这里看出谁先选了。
  const timedOut = new Set(state.timedOut ?? []);
  for (const seat of others) {
    const player = state.players[seat]!;
    if (timedOut.has(seat)) bumpTimeouts(ctx, seat);
    else player.timeouts = 0;
  }
  delete state.timedOut;
  ctx.events.push({
    type: "DeclaresRevealed",
    declares: state.players.map((player) => player.declarePublic),
    doubled: state.doubled,
    reason: state.doubleReason,
    guard: state.guardRevealed ? guard : null,
    soloRevealed: state.guardRevealed && state.mode === "darkSolo",
    rebelFailed: state.rebelFailed,
  });
  startPlay(ctx);
}

// ---- 出牌（4.3–4.5）

function startPlay(ctx: Ctx): void {
  const { state } = ctx;
  state.stage = "playing";
  state.turn = state.emperor!;
  state.lastPlay = null;
  state.passes = 0;
  state.table = [null, null, null, null, null];
  state.step += 1;
}

/**
 * 皇帝出保牌那种牌时，先用亮过的那几张（同一种牌长得一样，换一下 id 不影响玩法）。
 * 这样暗独时「没亮的那张」只有在 4 张都打出来时才会出现，别人不能从牌 id 提前看出是暗独。
 */
function preferShown(state: BaohuangState, seat: number, cardIds: readonly CardId[]): CardId[] {
  if (seat !== state.emperor || !state.guardCard) return [...cardIds];
  const kind = kindKey(state.guardCard.suit, state.guardCard.rank);
  const hand = new Set(state.players[seat]!.hand);
  const picked = new Set(cardIds);
  const spare = state.shownCards.filter((card) => hand.has(card) && !picked.has(card));
  return cardIds.map((card) => {
    if (kindOf(card) !== kind || state.shownCards.includes(card) || card === state.tehua || spare.length === 0) return card;
    return spare.shift()!;
  });
}

function play(ctx: Ctx, seat: number, cardIds: readonly CardId[], auto: boolean): void {
  const { state } = ctx;
  requireTurn(state, seat, "playing", "现在不是出牌的时候。");
  if (!Array.isArray(cardIds) || cardIds.length === 0 || cardIds.some((card) => typeof card !== "string")) fail("请选要出的牌。");
  if (new Set(cardIds).size !== cardIds.length) fail("同一张牌选了两次。");
  const player = state.players[seat]!;
  const ids = preferShown(state, seat, cardIds);
  const rules = setRules(state);
  const parsed = checkPlay(player.hand, ids, state.lastPlay?.ranks ?? null, rules);
  if (typeof parsed === "string") fail(parsed);
  const sorted = sortCards(ids);
  const used = new Set(ids);
  player.hand = player.hand.filter((card) => !used.has(card));
  state.played.push(...sorted);
  if (!state.lastPlay) state.table = [null, null, null, null, null];
  state.table[seat] = { kind: "play", cards: sorted };
  state.lastPlay = { seat, cards: sorted, ranks: parsed.ranks };
  state.passes = 0;
  ctx.events.push({ type: "Played", seat, cardIds: sorted, left: player.hand.length, ...(auto ? { auto } : {}) });
  checkReveal(ctx, seat, sorted);
  if (player.hand.length === 0) {
    player.place = state.finishOrder.length + 1;
    state.finishOrder.push(seat);
    ctx.events.push({ type: "Finished", seat, place: player.place });
    if (handOver(state)) return endHand(ctx);
  }
  state.turn = nextActive(state, seat);
  state.step += 1;
}

/** 打出保牌自动揭开身份（4.5、开工拍板待确认 5、补充 4.2 第 4 条）。只公开，不改倍数。 */
function checkReveal(ctx: Ctx, seat: number, cards: readonly CardId[]): void {
  const { state } = ctx;
  if (state.guardRevealed || !state.guardCard || state.mode === "openSolo") return;
  const kind = kindKey(state.guardCard.suit, state.guardCard.rank);
  const tehuaPlayed = state.tehua !== null && cards.includes(state.tehua);
  if (state.mode === "pair") {
    if (seat === state.emperor || !cards.some((card) => kindOf(card) === kind)) return;
  } else {
    // 暗独：特画一打出就公开；没有特画时皇帝 4 张保牌都打出来才公开。
    if (seat !== state.emperor) return;
    if (!tehuaPlayed && state.played.filter((card) => kindOf(card) === kind).length < 4) return;
  }
  state.guardRevealed = true;
  state.revealReason = tehuaPlayed ? "tehua" : "played";
  ctx.events.push({ type: "GuardRevealed", seat: state.guard!, solo: state.mode === "darkSolo", reason: tehuaPlayed ? "tehua" : "played" });
}

/** 一盘结束了没有（5.5，勘误 K2）。 */
function handOver(state: BaohuangState): boolean {
  const done = (seat: number) => state.players[seat]!.hand.length === 0;
  const emperor = state.emperor!;
  const rebels = SEATS.filter((seat) => seat !== emperor && seat !== state.guard);
  if (state.mode === "pair") return (done(emperor) && done(state.guard!)) || rebels.every(done);
  if (state.mode === "darkSolo") return done(emperor) || rebels.filter(done).length >= 2;
  return state.finishOrder.length > 0;
}

function pass(ctx: Ctx, seat: number, auto: boolean): void {
  const { state } = ctx;
  requireTurn(state, seat, "playing", "现在不是出牌的时候。");
  if (!state.lastPlay) fail("该你自由出牌，不能过。");
  state.table[seat] = { kind: "pass" };
  state.passes += 1;
  ctx.events.push({ type: "Passed", seat, ...(auto ? { auto } : {}) });
  const top = state.lastPlay.seat;
  const needed = activeSeats(state).filter((other) => other !== top).length;
  if (state.passes >= needed) {
    // 其他手里还有牌的人都过了：这一轮结束。最后出牌的人已经走科时，由他后面第一个有牌的人接风。
    const jiefeng = state.players[top]!.hand.length === 0;
    const leader = jiefeng ? nextActive(state, top) : top;
    ctx.events.push({ type: "TrickWon", winner: top, leader, jiefeng });
    state.turn = leader;
    state.lastPlay = null;
    state.passes = 0;
  } else {
    state.turn = nextActive(state, seat);
  }
  state.step += 1;
}

// ---------------------------------------------------------------------------
// 结算（第 6 节，勘误 K3）

/** 按规则算一盘的分（不改状态）。 */
export function scoreHand(state: BaohuangState): HandSummary {
  const emperor = state.emperor!;
  const guard = state.guard!;
  const mode = state.mode!;
  const order = state.finishOrder;
  const places = state.players.map((player) => player.place);
  const multiplier: 1 | 2 = state.doubled ? 2 : 1;
  const deltas = [0, 0, 0, 0, 0];
  let rankSum: number | null = null;
  let guardBase: number | null = null;
  if (mode === "pair") {
    // 没走科的人都是同一方，名次依次排在后面（谁先谁后不影响和）。
    const unfinished = SEATS.filter((seat) => places[seat] === null);
    const assumed = [...places];
    unfinished.forEach((seat, index) => {
      assumed[seat] = order.length + 1 + index;
    });
    rankSum = assumed[emperor]! + assumed[guard]!;
    guardBase = 6 - rankSum;
    const share = guardBase * multiplier;
    SEATS.forEach((seat) => {
      deltas[seat] = seat === emperor ? 2 * share : seat === guard ? share : -share;
    });
  } else {
    const place = places[emperor];
    const unit = mode === "openSolo" ? 6 : 3 * multiplier;
    // 暗独：头科 +4u，二科 0，三科或更差 −4u；明独：头科 +24，否则 −24（开工拍板待确认 4）。
    const sign = place === 1 ? 1 : mode === "darkSolo" && place === 2 ? 0 : -1;
    SEATS.forEach((seat) => {
      deltas[seat] = seat === emperor ? sign * 4 * unit : -sign * unit;
    });
  }
  const lead = deltas[emperor]!;
  return {
    handNo: state.handNo,
    emperor,
    guard,
    mode,
    guardCard: state.guardCard,
    grabbed: state.grabber !== null,
    forced: state.forced,
    doubleReason: state.doubleReason,
    multiplier,
    finishOrder: [...order],
    places,
    rankSum,
    guardBase,
    deltas: deltas.map((delta) => delta + 0),
    winner: lead > 0 ? "royal" : lead < 0 ? "rebel" : "draw",
    leftovers: state.players.map((player) => [...player.hand]),
  };
}

function endHand(ctx: Ctx): void {
  const { state } = ctx;
  const summary = scoreHand(state);
  SEATS.forEach((seat) => {
    const player = state.players[seat]!;
    player.handDelta = summary.deltas[seat]!;
    player.score += summary.deltas[seat]!;
  });
  state.summary = summary;
  state.stage = "handEnd";
  state.turn = -1;
  state.lastPlay = null;
  state.passes = 0;
  state.ready = [];
  state.step += 1;
  ctx.events.push({ type: "HandEnded", handNo: state.handNo, summary });
  if (state.handNo >= state.config.hands) finishGame(ctx);
}

function finishGame(ctx: Ctx): void {
  const { state } = ctx;
  const scores = state.players.map((player) => player.score);
  const ranks = scores.map((score) => 1 + scores.filter((other) => other > score).length);
  const top = Math.max(...scores);
  const winners = state.players.filter((player) => player.score === top).map((player) => player.id);
  state.phase = "finished";
  state.finalResult = { winners, ranks };
  ctx.events.push({ type: "GameEnded", winners });
}

function markReady(ctx: Ctx, seat: number): void {
  const { state } = ctx;
  if (state.stage !== "handEnd") fail("现在不是结算画面。");
  const id = state.players[seat]!.id;
  if (state.ready.includes(id)) {
    ctx.publicChange = false;
    return;
  }
  state.ready.push(id);
  if (state.ready.length === SEAT_COUNT) {
    // 第 2 盘起，发牌起点是上一盘皇帝的座位（待确认 7）。
    if (state.emperor !== null) state.dealStart = state.emperor;
    startHand(ctx);
  }
}

// ---------------------------------------------------------------------------
// 超时（9.4，勘误 K4，补充 4.2 第 7 条）

/** 自由出牌超时出的那一手：最小的一张普通牌（憋 6 时手里还有别的牌就跳过 6；只剩 6 就一次出完）；只剩王出小王，没有小王出大王，特画最后。 */
export function timeoutLead(state: BaohuangState, seat: number): CardId[] {
  const hand = state.players[seat]!.hand;
  const rules = setRules(state);
  const wild = (card: CardId) => isWild(card, rules);
  // 从小到大（同点数按黑红梅方、副数小的在前）。
  const ascending = (a: CardId, b: CardId) => effRank(a, rules) - effRank(b, rules) || compareCards(a, b);
  const normals = hand.filter((card) => !wild(card)).sort(ascending);
  if (rules.bie6) {
    const non6 = normals.filter((card) => rankOf(card) !== 6);
    const hasOther = hand.some((card) => wild(card) || rankOf(card) !== 6);
    if (non6.length > 0) return [non6[0]!];
    if (!hasOther) return [...hand];
  } else if (normals.length > 0) return [normals[0]!];
  const wilds = hand.filter(wild).sort(ascending);
  return [wilds[0]!];
}

export function timeoutCommand(state: BaohuangState, seat: number): BaohuangCommand {
  switch (state.stage) {
    case "grab":
      return { type: "GRAB", grab: false };
    case "abdicate":
      return { type: "ABDICATE" };
    case "call": {
      const types = canCallTypes(state.players[seat]!.hand);
      const three = types.find((type) => type.count === 3);
      if (three) return { type: "CALL", suit: three.suit, rank: three.rank, mode: "pair" };
      const four = types[0]!;
      return { type: "CALL", suit: four.suit, rank: four.rank, mode: "darkSolo" };
    }
    case "declare":
      return { type: "DECLARE", choice: state.mode === "pair" && state.guard === seat ? "darkGuard" : "noRebel" };
    case "playing":
      return state.lastPlay ? { type: "PASS" } : { type: "PLAY", cardIds: timeoutLead(state, seat) };
    case "handEnd":
      return { type: "READY" };
  }
}

function bumpTimeouts(ctx: Ctx, seat: number): void {
  const player = ctx.state.players[seat]!;
  player.timeouts += 1;
  if (player.timeouts >= 2 && !player.auto && !player.bot) setAuto(ctx, seat, true);
}

/** 给 seats（不给就是所有还没决定的人）套用默认动作；连续超时 2 次转托管（抢独、结算画面不算）。 */
function timeoutAll(ctx: Ctx, seats?: readonly number[]): void {
  const { state } = ctx;
  for (const seat of seats ?? pendingSeats(state)) {
    if (state.phase === "finished") return;
    // 前一个人的超时动作可能已经让局面往前走了。
    if (!pendingSeats(state).includes(seat)) continue;
    const command = timeoutCommand(state, seat);
    const stage = state.stage;
    state.log?.push({ seat, command: { type: "TIMEOUT" } });
    if (stage === "declare") {
      // 表态：不发「谁超时」的事件，超时次数等公布时一起算（见 resolveDeclares）。
      state.timedOut = [...(state.timedOut ?? []), seat];
      act(ctx, seat, command, true);
      continue;
    }
    if (stage === "grab") {
      act(ctx, seat, command, true);
      continue;
    }
    ctx.events.push({ type: "TimedOut", seat });
    act(ctx, seat, command, true);
    if (stage !== "handEnd") bumpTimeouts(ctx, seat);
  }
  // 超时把同时选的阶段推到公布时，ctx.publicChange 已经在公布时置回 true。
}

// ---------------------------------------------------------------------------

/**
 * 这位玩家现在能发的操作（测试、随机对局、调试牌桌用）。用他自己能看到的信息就能算，
 * 所以对 redactGameForViewer 之后的状态也能用。出牌给出每种「点数 × 张数 × 挂几张王」一种出法。
 */
export function legalCommands(state: BaohuangState, playerId: string): BaohuangCommand[] {
  const seat = state.players.findIndex((player) => player.id === playerId);
  if (seat < 0 || state.phase === "finished" || !pendingSeats(state).includes(seat)) return [];
  const hand = state.players[seat]!.hand;
  switch (state.stage) {
    case "grab":
      return [{ type: "GRAB", grab: true }, { type: "GRAB", grab: false }];
    case "abdicate":
      return canAscend(hand) ? [{ type: "ASCEND" }, { type: "ABDICATE" }] : [{ type: "ABDICATE" }];
    case "call":
      return canCallTypes(hand).flatMap((type): BaohuangCommand[] =>
        type.count === 3
          ? [{ type: "CALL", suit: type.suit, rank: type.rank, mode: "pair" }]
          : [
              { type: "CALL", suit: type.suit, rank: type.rank, mode: "darkSolo" },
              { type: "CALL", suit: type.suit, rank: type.rank, mode: "openSolo" },
            ],
      );
    case "declare":
      return declareChoices(state, seat).map((choice) => ({ type: "DECLARE", choice }));
    case "playing": {
      const plays = playOptions(hand, state.lastPlay?.ranks ?? null, setRules(state), guardCards(state, seat)).map((cardIds): BaohuangCommand => ({ type: "PLAY", cardIds }));
      return state.lastPlay ? [{ type: "PASS" }, ...plays] : plays;
    }
    case "handEnd":
      return [{ type: "READY" }];
  }
}

/** 这个座位手里的保牌（侍卫那张），列举出法时放到最后用，免得无意中亮出身份。 */
function guardCards(state: BaohuangState, seat: number): Set<CardId> {
  if (!state.guardCard || seat === state.emperor) return new Set();
  const kind = kindKey(state.guardCard.suit, state.guardCard.rank);
  return new Set(state.players[seat]!.hand.filter((card) => kindOf(card) === kind));
}

function finish(ctx: Ctx, input?: BaohuangState): BaohuangState {
  const { state } = ctx;
  for (const player of state.players) player.handCount = player.hand.length;
  state.rng = ctx.rng.state;
  if (!ctx.publicChange && input) {
    // 没有公开的变化（同时选的阶段里一个人的选择）：事件、历史、version 都不动，别人看到的状态和之前一模一样。
    state.events = input.events;
    state.history = input.history;
    return state;
  }
  state.events = ctx.events;
  state.history = [...state.history, ...ctx.events].slice(-HISTORY_LIMIT);
  state.version += 1;
  return state;
}

// ---------------------------------------------------------------------------
// 隐藏信息（4.7、9.3）

/** 一盘结算或整场结束：所有信息公开。 */
const allOpen = (state: BaohuangState) => state.stage === "handEnd" || state.phase === "finished";

/**
 * 给某位玩家看的状态。viewerId 为空串（或不在座）时只有公开信息。
 * - 别人的手牌只给张数（结算时公开剩下的牌）；
 * - guard 只发给侍卫本人（皇帝也不发；暗独时皇帝就是侍卫，所以皇帝自己能看到），揭开后公开；
 * - 暗独只发给皇帝本人，对别人 mode 显示成 pair，直到揭开；
 * - 抢独谁按了不发（只公开抢成的 grabber）；表态公布前别人的选择、甚至「选没选」都不发；
 * - 种子、随机数状态、操作记录、超时名单不发。
 */
export function redactBaohuang(state: BaohuangState, viewerId: string): BaohuangState {
  const view = cloneState(state);
  delete view.rng;
  delete view.seed;
  delete view.log;
  delete view.timedOut;
  const viewer = view.players.findIndex((player) => player.id === viewerId);
  const open = allOpen(view);
  view.players.forEach((player, seat) => {
    if (seat === viewer) return;
    player.grab = null;
    if (open) return;
    player.hand = [];
    player.declare = null;
  });
  if (!open && !view.guardRevealed) {
    if (viewer < 0 || viewer !== view.guard) view.guard = null;
    if (view.mode === "darkSolo" && viewer !== view.emperor) view.mode = "pair";
  }
  return view;
}

/** 观战的上帝视角（房主打开「观战看手牌」）：所有人的手牌、侍卫、暗独都能看到；种子、随机数状态、操作记录照样不发。 */
export function godView(state: BaohuangState): BaohuangState {
  const view = cloneState(state);
  delete view.rng;
  delete view.seed;
  delete view.log;
  delete view.timedOut;
  return view;
}

export { DECK_SIZE };
