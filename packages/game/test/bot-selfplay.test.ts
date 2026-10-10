/**
 * 人机自对弈：5 个座位全是人机，打完整场。每一步都合法（harness 用 applyCommand 校验）、不死循环（MAX_STEPS）、
 * 决策够快（服务器 2 核十几款游戏共用：平均 < 50ms，最坏 < 300ms）；行为不机械（不会每盘都造反 / 都让位）。
 */
import { describe, expect, it } from "vitest";
import { botCommand, type GameOptions } from "../src/index.js";
import { MAX_STEPS, match, playGame, timing, type Policy } from "./bot-harness.js";

function selfPlay(options: Partial<GameOptions>, games: number, seed: number) {
  const counts = { rebel: 0, noRebel: 0, ascend: 0, abdicateWithChoice: 0, openGuard: 0, darkGuard: 0 };
  const policy: Policy = (view, seat) => {
    const command = botCommand(view, seat);
    if (command.type === "DECLARE") counts[command.choice] += 1;
    if (view.stage === "abdicate" && command.type === "ASCEND") counts.ascend += 1;
    return command;
  };
  const ms: number[] = [];
  const problems: string[] = [];
  let hands = 0;
  let maxSteps = 0;
  for (let g = 0; g < games; g += 1) {
    const result = playGame([policy, policy, policy, policy, policy], seed + g, options, new Set([0, 1, 2, 3, 4]));
    ms.push(...result.botMs);
    problems.push(...result.problems);
    hands += result.hands.length;
    maxSteps = Math.max(maxSteps, result.steps);
  }
  return { counts, ms, problems, hands, maxSteps, time: timing(ms) };
}

describe("人机自对弈", () => {
  for (const [name, options] of [
    ["默认选项", { hands: 3 }],
    ["全开（抢独、憋 6、贴牌、特画）", { hands: 3, grabSolo: true, bie6: true, tieCard: true, tehua: true }],
    ["不能造反", { hands: 3, rebel: false }],
  ] as [string, Partial<GameOptions>][]) {
    it(`${name}：300 场 × 3 盘，步步合法、不卡死、够快`, () => {
      const r = selfPlay(options, 300, 4100);
      console.log(`[人机自对弈 ${name}]`, JSON.stringify({ hands: r.hands, maxSteps: r.maxSteps, decisions: r.ms.length, ...r.time, counts: r.counts }));
      expect(r.problems).toEqual([]);
      expect(r.hands).toBe(900);
      expect(r.maxSteps).toBeLessThan(MAX_STEPS);
      expect(r.time.avg).toBeLessThan(50);
      expect(r.time.max).toBeLessThan(300);
      if (options.rebel !== false) {
        // 造反不是每次都选，也不是从来不选（补充 1.8 #8）。
        const rate = r.counts.rebel / (r.counts.rebel + r.counts.noRebel);
        expect(rate).toBeGreaterThan(0.05);
        expect(rate).toBeLessThan(0.6);
      }
    }, 300_000);
  }
});

describe("人机强度（简短版；完整数字见 scripts/sim-baohuang.ts match）", () => {
  it("1 个人机对 4 个随机策略：每盘平均分明显 > 0，整场第一的比例远高于 20%", () => {
    const stats = match("bot", "random", 60, 31_000, { hands: 10 });
    expect(stats.problems).toEqual([]);
    expect(stats.mean).toBeGreaterThan(1.5);
    expect(stats.gameWin).toBeGreaterThan(0.8);
  }, 300_000);

  it("1 个人机对 4 个最小压牌基线（B1）：每盘平均分 > 0（95% 区间不含 0）", () => {
    const stats = match("bot", "b1", 60, 32_000, { hands: 10 });
    expect(stats.problems).toEqual([]);
    expect(stats.mean - stats.ci).toBeGreaterThan(0);
  }, 300_000);
});
