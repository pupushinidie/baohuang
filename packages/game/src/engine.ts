/**
 * 服务端、网页、人机、测试只调这里：对局的创建、操作、超时、隐藏信息。
 */
import { botCommand as bhBot } from "./bot.js";
import {
  applyBaohuang,
  createBaohuang,
  godView,
  isSimultaneous,
  legalCommands as bhLegal,
  pendingSeats as bhPending,
  redactBaohuang,
  stepSeconds as bhStepSeconds,
  timeoutCommand as bhTimeoutCommand,
  type NewPlayer,
} from "./baohuang.js";
import type { BaohuangConfig, GameCommand, GameOptions, GameState } from "./types.js";

export type { NewPlayer };

export function createGame(players: readonly NewPlayer[], seed: number, options: Partial<GameOptions> = {}, overrides: Partial<BaohuangConfig> = {}): GameState {
  return createBaohuang(players, seed, options, overrides);
}

/** 玩家（或人机）的操作。不合法时抛出带中文说明的错误。 */
export function applyCommand(state: GameState, playerId: string, command: GameCommand): GameState {
  return applyBaohuang(state, playerId, command).state;
}

/** 系统操作：到时间了，给还没决定的人（seats 只给这些座位）套用默认动作（连续超时 2 次转托管）。 */
export function timeoutTurn(state: GameState, seats?: readonly number[]): GameState {
  return applyBaohuang(state, "", { type: "TIMEOUT", ...(seats ? { seats } : {}) }).state;
}

/** 现在要做决定的座位（只在服务端用完整状态算；同时选的阶段不要把它发给别人）。 */
export const pendingSeats = (state: GameState) => bhPending(state);
/** 当前这一步的限时（秒）。 */
export const stepSeconds = (state: GameState) => bhStepSeconds(state);
/** 同时选的阶段（抢独、表态、结算）：倒计时对所有人一样，不显示谁选了。 */
export const simultaneousStage = (state: GameState) => isSimultaneous(state);
/**
 * 人机的决定。**只能传 redactGameForViewer(state, 这个座位的 id) 之后的状态**（人机不能看到别人的牌和侍卫是谁）。
 * 现在是占位实现（bot.ts），人机阶段会换成正式策略。
 */
export const botCommand = (state: GameState, seat: number): GameCommand => bhBot(state, seat);
/** 超时的默认动作（规则书 9.4、勘误 K4）。 */
export const timeoutCommand = (state: GameState, seat: number): GameCommand => bhTimeoutCommand(state, seat);
/** 给某个座位看的状态；viewerId 为空串时只有公开信息。 */
export const redactGameForViewer = (state: GameState, viewerId: string): GameState => redactBaohuang(state, viewerId);
/** 观战「看手牌」时的上帝视角（所有手牌、侍卫、暗独都能看到；种子等照样不发）。 */
export const spectatorGodView = (state: GameState): GameState => godView(state);
/** 决定点的标识；变了就重新计时（同时选的阶段里单个人的选择不改它）。 */
export const timerKey = (state: GameState) => `${state.handNo}:${state.redeals}:${state.step}`;
/** 列表、日志里显示的分数。 */
export const scoreOf = (state: GameState, seat: number): number => state.players[seat]!.score;
/** 这位玩家现在能发的操作（测试、调试牌桌、陪玩脚本用；对 redact 之后的状态也能用）。 */
export const legalCommands = (state: GameState, playerId: string) => bhLegal(state, playerId);
