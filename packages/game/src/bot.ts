/**
 * 人机：**占位实现**（引擎阶段写的），人机阶段（guluga-game-bot）会整个替换这个文件。
 *
 * 约定（替换时保持）：botCommand(state, seat) 只吃 redactGameForViewer(state, 这个座位的 id) 之后的状态，
 * 返回这个座位现在的一个合法操作。
 *
 * 占位策略：抢独不抢；能登基就登基（叫第一种能叫的牌，4 张时暗独）；表态侍卫暗保、别人不造反；
 * 出牌在合法出法里随机挑（跟牌时 30% 过牌）。随机数用 Math.random（人机不需要可复现）。
 */
import { legalCommands } from "./baohuang.js";
import type { GameCommand, GameState } from "./types.js";

export function botCommand(state: GameState, seat: number): GameCommand {
  const player = state.players[seat];
  if (!player) throw new Error("没有这个座位。");
  const options = legalCommands(state, player.id);
  if (options.length === 0) throw new Error("现在不该这个座位行动。");
  switch (state.stage) {
    case "grab":
      return { type: "GRAB", grab: false };
    case "abdicate":
      return options.find((command) => command.type === "ASCEND") ?? options[0]!;
    case "call":
      return options[0]!;
    case "declare":
      return options.find((command) => command.type === "DECLARE" && (command.choice === "darkGuard" || command.choice === "noRebel")) ?? options[0]!;
    case "playing": {
      const plays = options.filter((command) => command.type === "PLAY");
      if (plays.length === 0) return { type: "PASS" };
      if (state.lastPlay && Math.random() < 0.3) return { type: "PASS" };
      return plays[Math.floor(Math.random() * plays.length)]!;
    }
    case "handEnd":
      return { type: "READY" };
  }
}
