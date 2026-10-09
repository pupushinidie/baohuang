import { expect, it } from "vitest";
import { runSims } from "./sim.js";

it("随机对局 300 局（每局 3 盘）：憋 6 开", () => {
  const stats = runSims({ bie6: true }, 300, 150);
  console.log("[憋 6 开]", JSON.stringify({ ...stats, violations: stats.violations.length }));
  expect(stats.violations).toEqual([]);
  expect(stats.games).toBe(300);
  expect(stats.hands).toBe(900);
}, 300_000);
