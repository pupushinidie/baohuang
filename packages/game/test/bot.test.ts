/**
 * 人机决策单测：补充 1.8「人机最容易犯的蠢错」逐条摆局面，加上叫保、表态、只吃脱敏状态。
 */
import { describe, expect, it } from "vitest";
import {
  botCommand,
  botDecide,
  createScene,
  rankOf,
  redactGameForViewer,
  type BaohuangState,
  type GameCommand,
} from "../src/index.js";

const view = (state: BaohuangState, seat: number) => redactGameForViewer(state, state.players[seat]!.id);
const decide = (state: BaohuangState, seat: number) => botDecide(view(state, seat), seat);
const ranksOf = (command: GameCommand) => (command.type === "PLAY" ? command.cardIds.map(rankOf).sort((a, b) => a - b) : []);

/** 把「6 7 大 H9」这样的写法补上花色：没写花色的点数按 黑桃、梅花、方块、红桃 轮流取，每种花色点数最多 4 张。 */
function suited(hands: readonly string[]): string[] {
  const used = new Map<string, number>();
  for (const hand of hands) for (const token of hand.split(/\s+/)) if (/^[SHCD]/.test(token)) used.set(token, (used.get(token) ?? 0) + 1);
  const next = new Map<string, number>();
  return hands.map((hand) =>
    hand
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => {
        if (!/^(10|[6-9JQKA2])$/.test(token)) return token;
        for (let k = 0; k < 16; k += 1) {
          const i = next.get(token) ?? 0;
          next.set(token, i + 1);
          const kind = `${"SCDH"[i % 4]}${token}`;
          if ((used.get(kind) ?? 0) < 4) {
            used.set(kind, (used.get(kind) ?? 0) + 1);
            return kind;
          }
        }
        throw new Error(`${token} 不够了`);
      })
      .join(" "),
  );
}

/** 座位 0 叫红桃 9 当皇帝，座位 1 拿第 4 张红桃 9（侍卫）。hands 按座位给，表态默认全是暗保 / 不造反。 */
function pairScene(hands: string[], declares: string[] = ["darkGuard", "noRebel", "noRebel", "noRebel"], steps: string[] = []): BaohuangState {
  return createScene({
    deal: suited(hands),
    steps: ["0 ascend", "0 call H9 pair", ...declares.map((choice, i) => `${i + 1} declare ${choice}`), ...steps],
  });
}

const DECLARE_ALL = ["0 ascend", "0 call H9 pair", "1 declare darkGuard", "2 declare noRebel", "3 declare noRebel", "4 declare noRebel"];
const EMPEROR = "皇 H9 H9 H9 6 7 8 10 J Q K A";

describe("人机只看自己能看到的", () => {
  it("拿到没脱敏的状态直接报错；脱敏后正常", () => {
    const state = pairScene([EMPEROR, "H9 10 10 J", "6 7", "6 8", "7 8"]);
    expect(() => botCommand(state, 0)).toThrow(/脱敏/);
    expect(() => botCommand(view(state, 0), 0)).not.toThrow();
  });

  it("别人的手牌怎么换，人机的选择都一样", () => {
    const a = pairScene([EMPEROR, "H9 10 10 J", "6 7 8 K", "6 8 Q A", "7 8 J 2"], undefined, ["0 play 6"]);
    const b = pairScene([EMPEROR, "H9 10 10 J", "7 8 J 2", "6 7 8 K", "6 8 Q A"], undefined, ["0 play 6"]);
    expect(decide(a, 1)).toEqual(decide(b, 1));
    expect(decide(a, 1).command.type).toBe("PASS"); // 侍卫放皇帝的牌
  });
});

describe("叫保、表态", () => {
  it("有几种 3 张时叫点数最小的（不暴露大牌）", () => {
    const state = createScene({ deal: suited(["皇 SA SA SA H7 H7 H7 K K", "6 8", "6 9", "7 9", "8 10"]), steps: ["0 ascend"] });
    const command = decide(state, 0).command;
    expect(command).toMatchObject({ type: "CALL", rank: 7, mode: "pair" });
  });

  it("不能登基就让位，并说出原因", () => {
    const state = createScene({ deal: suited(["皇 6 7 8", "6 8", "6 9", "7 9", "8 10"]) });
    const decision = decide(state, 0);
    expect(decision.command.type).toBe("ABDICATE");
    expect(decision.reason).toMatch(/不能登基/);
  });

  it("两张以上大王一定登基", () => {
    const state = createScene({ deal: suited(["皇 大 H9 H9 H9 6 7 8", "6 8", "6 9", "7 9", "8 10"]) });
    expect(decide(state, 0).command.type).toBe("ASCEND");
  });

  it("弱牌不造反（一个人造反只会暴露自己）", () => {
    const state = createScene({ deal: suited([EMPEROR, "H9 10 10 J", "6 7", "6 8", "7 8"]), steps: ["0 ascend", "0 call H9 pair"] });
    expect(decide(state, 2).command).toEqual({ type: "DECLARE", choice: "noRebel" });
    expect(decide(state, 1).command).toEqual({ type: "DECLARE", choice: "darkGuard" });
  });
});

describe("出牌：补充 1.8 的蠢错", () => {
  it("#1 不压已公开的队友（皇帝不压明保侍卫的牌）", () => {
    const state = pairScene([EMPEROR + " 2", "H9 K 10 10", "6 7", "6 8", "7 8"], ["openGuard", "noRebel", "noRebel", "noRebel"], [
      "0 play Q",
      "1 play K",
      "2 pass",
      "3 pass",
      "4 pass",
    ]);
    expect(state.turn).toBe(0);
    const decision = decide(state, 0);
    expect(decision.command.type).toBe("PASS");
    expect(decision.reason).toMatch(/队友/);
  });

  it("#2 平常自由出牌不把大王挂在小牌上，先出最小的一整组", () => {
    const state = pairScene([EMPEROR, "H9 10 10 J", "大 6 9 9 J Q K", "6 8", "7 8"], undefined, ["0 play 6", "1 pass", "2 play J", "3 pass", "4 pass", "0 pass", "1 pass"]);
    expect(state.turn).toBe(2);
    expect(state.lastPlay).toBeNull();
    expect(ranksOf(decide(state, 2).command)).toEqual([6]);
  });

  it("#3 不为了跟单张拆掉 7 张以上的控", () => {
    const state = pairScene([EMPEROR, "H9 10 10 J", "9 9 9 9 9 9 9 6 7 7", "6 8", "7 8"], undefined, ["0 play 8", "1 pass"]);
    expect(state.turn).toBe(2);
    expect(decide(state, 2).command.type).toBe("PASS");
  });

  it("#4 侍卫没揭开时不先出保牌那一组", () => {
    const state = pairScene([EMPEROR, "H9 10 10 J", "6 7 8", "6 8", "7 8"], undefined, ["0 play 6", "1 play 10", "2 pass", "3 pass", "4 pass", "0 pass"]);
    expect(state.turn).toBe(1);
    expect(state.lastPlay).toBeNull();
    expect(ranksOf(decide(state, 1).command)).not.toContain(9);
  });

  it("#6 对手只剩 2 张时不出对子，出他跟不了的张数", () => {
    const state = createScene({
      deal: suited(["皇 H9 H9 H9 Q Q 10", "H9 10 J", "7 7 7 8 8 6 K", "6 8 9", "7 8 9"]),
      steps: [...DECLARE_ALL, "0 play H9 H9 H9 皇", "1 pass", "2 pass", "3 pass", "4 pass", "0 play 10", "1 pass", "2 play K", "3 pass", "4 pass", "0 pass", "1 pass"],
    });
    expect(state.turn).toBe(2);
    expect(state.lastPlay).toBeNull();
    expect(state.players[0]!.handCount).toBe(2);
    const command = decide(state, 2).command;
    expect(command.type === "PLAY" && command.cardIds.length).toBeGreaterThan(2);
  });

  it("#7 能一手出完就出完", () => {
    const state = pairScene([EMPEROR, "H9 10 10 J", "8 8 小 7", "6 8", "7 8"], undefined, ["0 play 6", "1 pass", "2 play 7", "3 pass", "4 pass", "0 pass", "1 pass"]);
    expect(state.turn).toBe(2);
    const command = decide(state, 2).command;
    expect(command.type === "PLAY" && command.cardIds.length).toBe(3);
  });

  it("敌人只剩几张时不惜用大王拦", () => {
    const state = createScene({
      deal: suited(["皇 H9 H9 H9 A 6", "H9 10 J", "大 6 7 8", "6 8 9", "7 8 9"]),
      steps: [...DECLARE_ALL, "0 play H9 H9 H9 皇", "1 pass", "2 pass", "3 pass", "4 pass", "0 play A", "1 pass"],
    });
    expect(state.turn).toBe(2);
    expect(state.players[0]!.handCount).toBe(1);
    const command = decide(state, 2).command;
    expect(ranksOf(command)).toEqual([17]);
  });

  it("每一步都附一句中文理由", () => {
    const state = pairScene([EMPEROR, "H9 10 10 J", "6 7", "6 8", "7 8"]);
    const decision = decide(state, 0);
    expect(decision.reason.length).toBeGreaterThan(4);
    expect(decision.reason).toMatch(/[一-龥]/);
  });
});

