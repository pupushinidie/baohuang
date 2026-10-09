import { expect, it } from "vitest";
import { runSims } from "./sim.js";

it("随机对局 300 局（每局 3 盘）：让位贴牌开", () => {
  const stats = runSims({ tieCard: true }, 300, 155);
  console.log("[让位贴牌开]", JSON.stringify({ ...stats, violations: stats.violations.length }));
  expect(stats.violations).toEqual([]);
  expect(stats.games).toBe(300);
  expect(stats.hands).toBe(900);
}, 300_000);
