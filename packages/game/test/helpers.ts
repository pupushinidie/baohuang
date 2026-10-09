import {
  applyCommand,
  createGame,
  createScene,
  legalCommands,
  pendingSeats,
  redactGameForViewer,
  runStep,
  type BaohuangState,
  type GameCommand,
  type SceneSpec,
  type SceneStep,
} from "../src/index.js";

export const SEATS = [0, 1, 2, 3, 4] as const;

/** 跑一串步骤（createScene 的写法）。 */
export function steps(state: BaohuangState, list: readonly SceneStep[]): BaohuangState {
  return list.reduce((current, step) => runStep(current, step), state);
}

export const scene = (spec: SceneSpec) => createScene(spec);

export function act(state: BaohuangState, seat: number, command: GameCommand): BaohuangState {
  return applyCommand(state, state.players[seat]!.id, command);
}

export function view(state: BaohuangState, seat: number): BaohuangState {
  return redactGameForViewer(state, seat < 0 ? "" : state.players[seat]!.id);
}

/** 发牌起点是 dealStart 的一局（第 1 盘发牌起点随机，换种子找）。 */
export function gameWithDealStart(dealStart: number, options = {}): BaohuangState {
  for (let seed = 1; seed < 500; seed += 1) {
    const state = createGame(SEATS.map((seat) => ({ id: `p${seat}`, name: `玩家${seat}` })), seed, options);
    if (state.dealStart === dealStart) return state;
  }
  throw new Error("找不到");
}

export const counts = (state: BaohuangState) => state.players.map((player) => player.hand.length);
export const deltas = (state: BaohuangState) => state.summary!.deltas;
export const pending = pendingSeats;
export const legal = (state: BaohuangState, seat: number) => legalCommands(state, state.players[seat]!.id);
