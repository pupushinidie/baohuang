/**
 * 保皇和教程有关的部分（共用的 tutorial/ 文件夹之外，每款游戏自己写的）：
 * 游戏 id、「提示」怎么说、「第一次遇到」小贴士什么时候出。
 */
import { botDecide, type BaohuangState, type GameCommand } from "@baohuang/game";

/** 本机记录（gm-tutorial-<id>、gm-tips-<id>）用的游戏 id。 */
export const GAME_ID = "baohuang";

export interface Hint {
  readonly say: string;
  readonly note?: string;
  /** 高亮哪个元素（data-tutorial）；null 不指。 */
  readonly anchor: string | null;
  /** 出牌提示：建议出的牌（牌桌会替你选好）。 */
  readonly command?: GameCommand;
}

function anchorOf(command: GameCommand): string | null {
  switch (command.type) {
    case "ASCEND":
      return "ascend-button";
    case "ABDICATE":
      return "abdicate-button";
    case "CALL":
      return `${command.mode === "pair" ? "call" : command.mode === "darkSolo" ? "dark" : "open"}-${command.suit}${command.rank}`;
    case "DECLARE":
      return { openGuard: "open-guard", darkGuard: "dark-guard", rebel: "rebel-button", noRebel: "no-rebel" }[command.choice];
    case "GRAB":
      return command.grab ? "grab-button" : "nograb-button";
    case "PLAY":
      return "play-button";
    case "PASS":
      return "pass-button";
    case "READY":
      return "next-hand";
    default:
      return null;
  }
}

/** 「提示」：让人机从你的位置算一步（界面拿到的本来就是你能看到的那份），配一句原因。 */
export function hintFor(game: BaohuangState, playerId: string): Hint {
  if (game.phase === "finished") return { say: "这一场已经结束了。", anchor: null };
  const seat = game.players.findIndex((player) => player.id === playerId);
  try {
    const decision = botDecide(game, seat);
    const command = decision.command;
    let say = "我会这么走。";
    if (command.type === "ASCEND") say = "我会登基。";
    else if (command.type === "ABDICATE") say = "我会让位。";
    else if (command.type === "CALL") say = command.mode === "pair" ? "我会叫这一种。" : command.mode === "darkSolo" ? "我会暗独。" : "我会明独。";
    else if (command.type === "DECLARE") say = `我会${{ openGuard: "明保", darkGuard: "暗保", rebel: "造反", noRebel: "不造反" }[command.choice]}。`;
    else if (command.type === "GRAB") say = command.grab ? "我会抢独。" : "我不抢。";
    else if (command.type === "PLAY") say = "我会出替你选好的这几张。";
    else if (command.type === "PASS") say = "我会不要。";
    return { say, note: decision.reason, anchor: anchorOf(command), command };
  } catch {
    return { say: "现在不用你做决定，等一下。", anchor: null };
  }
}

/** 「第一次遇到」小贴士的内容。 */
export const TIPS = {
  "you-guard": { title: "你是侍卫", text: "皇帝亮的那种牌，第 4 张在你手里：你是侍卫，只有你自己知道。帮皇帝早点出完，别太早打出那张保牌。" },
  "rebel-failed": { title: "造反失败", text: "只有 1 个人造反：不加倍，他自己暴露成革命党。2 个人以上同时造反才成功（×2）。" },
  "guard-revealed": { title: "侍卫露面了", text: "打出那张保牌的人就是侍卫，系统自动标出来，倍数不变。" },
  jiefeng: { title: "接风", text: "最后一手出完、这一轮没人压：由他后面第一个还有牌的人自由出牌。" },
  finished: { title: "走科", text: "出完的顺序叫头科、二科、三科、二落、大落。名次决定分数，队友的名次也算。" },
} as const;

/** 这一步该出哪些小贴士（按优先顺序；只出第一条没看过的）。 */
export function detectTips(game: BaohuangState, selfId: string): string[] {
  const ids: string[] = [];
  const self = game.players.findIndex((player) => player.id === selfId);
  for (const event of game.events) {
    if (event.type === "GuardCalled" && game.guard === self && self !== game.emperor) ids.push("you-guard");
    if (event.type === "DeclaresRevealed" && event.rebelFailed !== null) ids.push("rebel-failed");
    if (event.type === "GuardRevealed" || (event.type === "DeclaresRevealed" && event.guard !== null)) ids.push("guard-revealed");
    if (event.type === "TrickWon" && event.jiefeng) ids.push("jiefeng");
    if (event.type === "Finished") ids.push("finished");
  }
  return ids;
}
