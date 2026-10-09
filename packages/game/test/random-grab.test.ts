import { expect, it } from "vitest";
import { runSims } from "./sim.js";

it("随机对局 300 局（每局 3 盘）：抢独开", () => {
  const stats = runSims({ grabSolo: true }, 300, 155);
  console.log("[抢独开]", JSON.stringify({ ...stats, violations: stats.violations.length }));
  expect(stats.violations).toEqual([]);
  expect(stats.games).toBe(300);
  expect(stats.hands).toBe(900);
}, 300_000);
