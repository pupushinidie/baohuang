/**
 * 保皇的对局状态、操作、事件。规则书：~/Desktop/游戏规则/保皇.md，补充和勘误：保皇-补充.md。
 *
 * 座位 0–4 逆时针：座位 s 的下家（下一个出牌的人）是 (s+1)%5，上家是 (s+4)%5。
 * 引擎只按座位号算；屏幕上「自己在下方」由界面换算。
 *
 * 隐藏信息只经过 redactGameForViewer 下发（规则书 9.3）。每个字段的注释写明谁能看到：
 * 「公开」= 所有人；「自己」= 只有这个座位本人；「服务端」= 永远不下发。
 */
import type { CardId, Suit } from "./cards.js";

export interface BaohuangOptions {
  /** 一场打几盘（没人能登基重发的那次不算）。 */
  readonly hands: 3 | 5 | 8 | 10;
  /** 抢独（3.3）：发完牌后所有人同时有 5 秒可以抢「明独」。 */
  readonly grabSolo: boolean;
  /** 憋 6（5.7）：6 只能留到最后一手一次出完，不能挂王。 */
  readonly bie6: boolean;
  /** 造反（3.6）：关掉后表态阶段只有侍卫选明保 / 暗保。 */
  readonly rebel: boolean;
  /** 让位贴牌（补充 4.1）：本盘第 2 次让位起，每次让位多贴 1 张，贴牌跟着皇牌走。 */
  readonly tieCard: boolean;
  /** 特画（补充 4.2）：叫保时没亮的那张保牌当「超级王」（比大王大）。 */
  readonly tehua: boolean;
}

export interface BaohuangConfig extends BaohuangOptions {
  /** 各阶段限时（秒），超时按 timeoutCommand 自动处理（规则书 9.4、勘误 K4）。 */
  readonly grabSec: number;
  readonly abdicateSec: number;
  readonly callSec: number;
  readonly declareSec: number;
  readonly playSec: number;
  readonly handEndSec: number;
}

/**
 * 一盘里的阶段：
 * - grab 抢独（只有抢独选项打开时，所有人同时选，turn = -1）
 * - abdicate 登基 / 让位（turn = 拿着皇牌的人）
 * - call 叫保（turn = 皇帝）
 * - declare 表态（除皇帝外 4 人同时选，turn = -1；明独时跳过）
 * - playing 出牌（turn = 轮到的人）
 * - handEnd 一盘结算（所有人点「下一盘」或超时，turn = -1）
 */
export type Stage = "grab" | "abdicate" | "call" | "declare" | "playing" | "handEnd";

/** pair 二打三（有侍卫）；darkSolo 暗独；openSolo 明独（含抢独）。 */
export type Mode = "pair" | "darkSolo" | "openSolo";

/** 表态：侍卫选 openGuard 明保 / darkGuard 暗保；其他人选 rebel 造反 / noRebel 不造反。 */
export type Declare = "openGuard" | "darkGuard" | "rebel" | "noRebel";

/** 保牌：叫保时公开的「花色 + 点数」。 */
export interface GuardCard {
  readonly suit: Suit;
  readonly rank: number;
}

/** 当前这一轮最大的一套牌。ranks 是比较用的点数（从大到小，特画记 18）。 */
export interface TopPlay {
  readonly seat: number;
  readonly cards: CardId[];
  readonly ranks: number[];
}

/** 桌上每个座位这一轮最近一次的动作（新一轮开始时清空），界面显示用。 */
export type TableEntry = { readonly kind: "play"; readonly cards: CardId[] } | { readonly kind: "pass" };

export interface BaohuangPlayer {
  /** 座位 id（服务器的 playerId，如 p1；人机是 bot1…）。公开。 */
  readonly id: string;
  readonly name: string;
  /** 空座位上的人机。公开（规则书 8.2：人机当侍卫时也不加任何别的标记）。 */
  readonly bot: boolean;
  /** 托管：连续超时 2 次自动打开，由人机代打。公开。 */
  auto: boolean;
  /** 连续超时次数。公开。 */
  timeouts: number;
  /** 累计积分。公开。 */
  score: number;
  /** 本盘得失（结算时写入）。公开。 */
  handDelta: number;
  /** 手牌（从大到小）。自己；别人的是空数组（一盘结算时公开剩下的牌），张数看 handCount。 */
  hand: CardId[];
  /** 手牌张数。公开（4.6 报牌）。 */
  handCount: number;
  /** 抢独阶段自己的选择（true 抢 / false 不抢 / null 还没选）。自己；别人永远是 null（只公开抢成的人，见 grabber）。 */
  grab: boolean | null;
  /** 表态阶段自己的真实选择。自己；别人是 null（看 declarePublic）。一盘结算时公开。 */
  declare: Declare | null;
  /**
   * 表态公布后大家看到的样子（3.6、9.3）：明保、造反成功时公开所有选择；造反失败只公开那一个造反的人；
   * 侍卫暗保又没被揭开时对外显示成 noRebel。公布前是 null。公开。
   */
  declarePublic: Declare | null;
  /** 走科名次 1–5（还没出完是 null）。公开。 */
  place: number | null;
}

export interface HandSummary {
  readonly handNo: number;
  readonly emperor: number;
  /** 侍卫（独保时 = 皇帝）。 */
  readonly guard: number;
  readonly mode: Mode;
  readonly guardCard: GuardCard | null;
  /** 抢独产生的明独。 */
  readonly grabbed: boolean;
  /** 逼位产生的皇帝。 */
  readonly forced: boolean;
  /** 本盘分数 ×2 的原因：明保 / 造反成功；null 不加倍。 */
  readonly doubleReason: "openGuard" | "rebel" | null;
  readonly multiplier: 1 | 2;
  /** 走科顺序（座位）。 */
  readonly finishOrder: number[];
  /** 每个座位的名次（1–5）；结束时还没走科的是 null（勘误 K3：界面显示「未走科」）。 */
  readonly places: (number | null)[];
  /** 二打三时皇帝和侍卫的名次之和（没走科的按排在后面算，同一方先后不影响）；独保时 null。 */
  readonly rankSum: number | null;
  /** 二打三时侍卫的基础得分 6 − rankSum（加倍前）；独保时 null。 */
  readonly guardBase: number | null;
  /** 本盘得失（下标是座位），加起来是 0。 */
  readonly deltas: number[];
  /** 谁赢：royal 保皇派得分 > 0，rebel 革命党得分 > 0，draw 全部 0。 */
  readonly winner: "royal" | "rebel" | "draw";
  /** 结束时每个人剩下的手牌（公开）。 */
  readonly leftovers: CardId[][];
}

export interface FinalResult {
  /** 累计分最高的人（可以并列）。 */
  readonly winners: string[];
  /** 名次（并列同名次），下标是座位。 */
  readonly ranks: number[];
}

export type BaohuangCommand =
  /** 抢独阶段：抢 / 不抢。 */
  | { readonly type: "GRAB"; readonly grab: boolean }
  /** 登基阶段：拿着皇牌的人登基。 */
  | { readonly type: "ASCEND" }
  /** 登基阶段：让位（把皇牌交给上家；贴牌选项打开时系统自动贴牌）。 */
  | { readonly type: "ABDICATE" }
  /** 叫保：选一种能叫的「花色 + 点数」。mode：恰好 3 张只能 pair；4 张选 darkSolo（只亮 3 张）或 openSolo（亮 4 张）。 */
  | { readonly type: "CALL"; readonly suit: Suit; readonly rank: number; readonly mode: Mode }
  /** 表态：侍卫 openGuard / darkGuard，其他人 rebel / noRebel。 */
  | { readonly type: "DECLARE"; readonly choice: Declare }
  /** 出牌（牌 id）。 */
  | { readonly type: "PLAY"; readonly cardIds: readonly CardId[] }
  /** 过牌（不要）。 */
  | { readonly type: "PASS" }
  /** 结算画面：准备好下一盘。 */
  | { readonly type: "READY" }
  /** 托管开关。 */
  | { readonly type: "AUTO"; readonly on: boolean };

/**
 * 事件：每次操作后放进 state.events（这一步的）和 state.history（最近若干条）。**所有事件都是公开的**，
 * 所以事件里永远不放隐藏信息：不记谁抢没抢独、谁表态选了什么（只在公布时一起给）、谁是因为不能登基才让位的。
 */
export type BaohuangEvent =
  | { readonly type: "HandStarted"; readonly handNo: number; readonly dealStart: number }
  /** 发牌完毕；redeal 是这一盘第几次重发（0 是第一次发）。 */
  | { readonly type: "Dealt"; readonly dealStart: number; readonly huangHolder: number; readonly redeal: number }
  /** 抢独结果：seat 抢成的人（明独），null 没人抢。 */
  | { readonly type: "GrabResolved"; readonly seat: number | null; readonly from: number | null }
  | { readonly type: "Ascended"; readonly seat: number; readonly forced: boolean }
  /** 让位：from 交给 to；tie 是这次新贴的牌，carried 是一起交出去的全部贴牌（含 tie）。 */
  | { readonly type: "Abdicated"; readonly from: number; readonly to: number; readonly count: number; readonly tie: CardId | null; readonly carried: CardId[] }
  /** 逼位：皇牌（和贴牌）交给必须登基的人。 */
  | { readonly type: "Forced"; readonly from: number; readonly seat: number; readonly carried: CardId[] }
  /** 5 个人都没有「恰好 3 张」，重新洗牌发牌。 */
  | { readonly type: "Redeal"; readonly count: number }
  /** 叫保：亮出的牌（3 张，明独 4 张）。open = 明独。暗独对外和二打三一样（open 为 false）。 */
  | { readonly type: "GuardCalled"; readonly emperor: number; readonly suit: Suit; readonly rank: number; readonly shown: CardId[]; readonly open: boolean }
  /**
   * 表态公布（3.6）。declares 是每个座位公布后的样子（同 declarePublic），doubled 本盘 ×2，
   * guard 公开的侍卫（明保 / 造反成功；暗独被揭开时是皇帝），rebelFailed 造反失败被公开的人。
   */
  | {
      readonly type: "DeclaresRevealed";
      readonly declares: (Declare | null)[];
      readonly doubled: boolean;
      readonly reason: "openGuard" | "rebel" | null;
      readonly guard: number | null;
      readonly soloRevealed: boolean;
      readonly rebelFailed: number | null;
    }
  | { readonly type: "Played"; readonly seat: number; readonly cardIds: CardId[]; readonly left: number; readonly auto?: boolean }
  | { readonly type: "Passed"; readonly seat: number; readonly auto?: boolean }
  /** 打出保牌（或特画）自动揭开侍卫；暗独时 solo 为 true（公开「独保」）。 */
  | { readonly type: "GuardRevealed"; readonly seat: number; readonly solo: boolean; readonly reason: "played" | "tehua" }
  /** 走科：place 是名次。 */
  | { readonly type: "Finished"; readonly seat: number; readonly place: number }
  /** 一轮结束，leader 自由出下一轮；jiefeng 为 true 表示最后出牌的人已经走科，由他后面第一个有牌的人接风。 */
  | { readonly type: "TrickWon"; readonly winner: number; readonly leader: number; readonly jiefeng: boolean }
  | { readonly type: "HandEnded"; readonly handNo: number; readonly summary: HandSummary }
  /** 超时自动处理（同时表态的阶段不发这条，免得看出谁没选）。 */
  | { readonly type: "TimedOut"; readonly seat: number }
  | { readonly type: "AutoChanged"; readonly seat: number; readonly on: boolean }
  | { readonly type: "GameEnded"; readonly winners: readonly string[] };

export interface BaohuangState {
  readonly config: BaohuangConfig;
  /** 整场：进行中 / 结束。公开。 */
  phase: "playing" | "finished";
  players: BaohuangPlayer[];
  /** 第几盘，从 1 开始（重发不加）。公开。 */
  handNo: number;
  /** 这一盘重发了几次。公开。 */
  redeals: number;
  /** 发牌起点（第 1 盘随机，之后是上一盘的皇帝）。公开。 */
  dealStart: number;
  stage: Stage;
  /** 轮到谁（登基、叫保、出牌）；同时选的阶段是 -1。公开。 */
  turn: number;
  /** 发到皇牌的人 H₀。公开。 */
  huangHolder0: number | null;
  /** 现在拿着皇牌的人。公开。 */
  huangHolder: number | null;
  /** 本盘让位的顺序（座位）。公开。 */
  abdications: number[];
  /** 贴牌（让位贴牌选项）：跟着皇牌走，正面公开，牌在持有者手里。公开。 */
  tiePile: CardId[];
  /** 皇帝是逼位产生的。公开。 */
  forced: boolean;
  /** 抢独抢成的人（明独）。公开；谁按了没抢成不公开。 */
  grabber: number | null;
  emperor: number | null;
  /** 保牌种类。公开。 */
  guardCard: GuardCard | null;
  /** 皇帝亮出的牌（3 张；明独 4 张）。公开。 */
  shownCards: CardId[];
  /** 特画那张牌的 id（特画选项打开、二打三或暗独时，没亮的那张保牌）。是哪张公开（看亮牌就能推出），谁拿着不公开。 */
  tehua: CardId | null;
  /** 侍卫（暗独、明独时 = 皇帝）。只发给侍卫本人（皇帝也不发）；揭开后、结算时公开。 */
  guard: number | null;
  /** 二打三 / 暗独 / 明独。暗独只发给皇帝本人，对别人显示成 pair，直到揭开。 */
  mode: Mode | null;
  /** 表态已经公布。公开。 */
  declaresRevealed: boolean;
  /** 本盘 ×2（明保或造反成功）。公开。 */
  doubled: boolean;
  doubleReason: "openGuard" | "rebel" | null;
  /** 侍卫身份已公开（暗独揭开、明独都算）。公开。 */
  guardRevealed: boolean;
  revealReason: "openGuard" | "rebel" | "played" | "tehua" | "openSolo" | null;
  /** 造反失败被公开的那个人。公开。 */
  rebelFailed: number | null;
  /** 当前这一轮最大的一套；null 表示轮到的人自由出牌。公开。 */
  lastPlay: TopPlay | null;
  /** lastPlay 之后连续过牌的人数。公开。 */
  passes: number;
  /** 桌上每个座位这一轮的动作。公开。 */
  table: (TableEntry | null)[];
  /** 本盘打出过的所有牌。公开。 */
  played: CardId[];
  /** 走科顺序。公开。 */
  finishOrder: number[];
  summary: HandSummary | null;
  /** 结算画面里点了「下一盘」的玩家 id。公开。 */
  ready: string[];
  events: BaohuangEvent[];
  history: BaohuangEvent[];
  finalResult?: FinalResult;
  /** 每一步公开的变化 +1（界面看它触发动画）。同时选的阶段里单个人的选择不加，免得别人从计数看出几个人选了。 */
  version: number;
  /** 每到一个新的决定点（换阶段、轮到下一个人）+1；服务端据此重置计时。 */
  step: number;
  /** 以下只在服务端（redact 时删掉）。 */
  rng?: number;
  seed?: number;
  /** 表态阶段超时的座位（公布时才算进超时次数）。 */
  timedOut?: number[];
  log?: { seat: number; command: BaohuangCommand | { type: "TIMEOUT" } }[];
}

export type GameState = BaohuangState;
export type GameCommand = BaohuangCommand;
export type GameEvent = BaohuangEvent;
export type GameOptions = BaohuangOptions;
