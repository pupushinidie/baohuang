import { expect, it } from "vitest";
import { runSims } from "./sim.js";

it("随机对局 300 局（每局 3 盘）：全开（抢独、憋 6、造反、贴牌、特画）", () => {
  const stats = runSims({ grabSolo: true, bie6: true, rebel: true, tieCard: true, tehua: true }, 300, 136);
  console.log("[全开（抢独、憋 6、造反、贴牌、特画）]", JSON.stringify({ ...stats, violations: stats.violations.length }));
  expect(stats.violations).toEqual([]);
  expect(stats.games).toBe(300);
  expect(stats.hands).toBe(900);
}, 300_000);
