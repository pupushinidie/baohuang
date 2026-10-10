/**
 * 保皇人机强度模拟：npx tsx scripts/sim-baohuang.ts [模式] [场数]
 *
 * - strength：2 万手随机发牌（34 张）算牌力分 S 的分位数（填进 bot.ts 的 STRENGTH_QUANTILES）；
 * - self：全是人机自对弈，几种开房选项各 N 场，查合法、不死循环、决策耗时、各种模式出现的比例；
 * - match：1 个人机 + 4 个基线（random / b1 / b2），人机轮换座位，每场 10 盘，报每盘平均分（零和，公平值 0）、
 *   分身份平均分、整场第一的比例（公平值约 20%）。
 * 不给模式就全跑。
 */
import { buildDeal, createRng, evalHand, NO_RULES } from "../packages/game/src/index.ts";
import { match, playGame, makePolicy, timing, type PolicyName } from "../packages/game/test/bot-harness.ts";

const mode = process.argv[2] ?? "all";
const games = Number(process.argv[3] ?? 300);
const f = (x: number, d = 2) => (x >= 0 ? "+" : "") + x.toFixed(d);

if (mode === "strength" || mode === "all") {
  const rng = createRng(20261010);
  const values: number[] = [];
  for (let i = 0; i < 4000; i += 1) {
    const deal = buildDeal({ seed: rng.int(1e9) });
    for (const hand of deal) if (hand.length === 34) values.push(evalHand(hand, NO_RULES).S);
  }
  values.sort((a, b) => a - b);
  const ps = [...Array.from({ length: 20 }, (_, i) => i / 20), 0.97, 0.98, 0.99, 1];
  const at = (p: number) => values[Math.min(values.length - 1, Math.floor(p * (values.length - 1)))]!;
  console.log(`## 牌力分 S 分位数（${values.length} 手），[百分位, S]`);
  console.log(ps.map((p) => `[${p}, ${at(p).toFixed(1)}]`).join(", "));
}

if (mode === "self" || mode === "all") {
  console.log(`## 自对弈（5 个人机，每种选项 ${games} 场 × 3 盘）`);
  const variants: [string, object][] = [
    ["默认", { hands: 3 }],
    ["抢独", { hands: 3, grabSolo: true }],
    ["憋6", { hands: 3, bie6: true }],
    ["不造反", { hands: 3, rebel: false }],
    ["贴牌", { hands: 3, tieCard: true }],
    ["特画", { hands: 3, tehua: true }],
    ["全开", { hands: 3, grabSolo: true, bie6: true, tieCard: true, tehua: true }],
  ];
  for (const [name, options] of variants) {
    const ms: number[] = [];
    let problems = 0;
    let maxSteps = 0;
    const modes: Record<string, number> = {};
    let doubled = 0;
    let forced = 0;
    let hands = 0;
    for (let g = 0; g < games; g += 1) {
      const policies = [0, 1, 2, 3, 4].map(() => makePolicy("bot", 0));
      const result = playGame(policies, 5000 + g, options, new Set([0, 1, 2, 3, 4]));
      ms.push(...result.botMs);
      if (result.problems.length) {
        problems += result.problems.length;
        console.log("  问题：", result.problems[0]);
      }
      maxSteps = Math.max(maxSteps, result.steps);
      for (const s of result.hands) {
        hands += 1;
        modes[s.mode] = (modes[s.mode] ?? 0) + 1;
        if (s.multiplier === 2) doubled += 1;
        if (s.forced) forced += 1;
      }
    }
    const t = timing(ms);
    console.log(
      `${name}：问题 ${problems}，最多 ${maxSteps} 步，${hands} 盘（${Object.entries(modes).map(([k, v]) => `${k} ${((100 * v) / hands).toFixed(1)}%`).join("、")}，加倍 ${((100 * doubled) / hands).toFixed(1)}%，逼位 ${((100 * forced) / hands).toFixed(1)}%），决策 ${ms.length} 次 平均 ${t.avg.toFixed(2)}ms p99 ${t.p99.toFixed(2)}ms 最慢 ${t.max.toFixed(1)}ms`,
    );
  }
}

if (mode === "match" || mode === "all") {
  console.log(`## 1 个人机 vs 4 个基线（${games} 场 × 10 盘）`);
  const villains: PolicyName[] = (process.argv[4]?.split(",") as PolicyName[]) ?? ["random", "b1", "b2"];
  for (const villain of villains) {
    const stats = match("bot", villain, games, 900_000, { hands: 10 });
    const roles = Object.entries(stats.byRole)
      .map(([role, r]) => `${role} ${r.n} 盘 ${f(r.mean)}`)
      .join("，");
    console.log(`对 ${villain}：${stats.hands} 盘，每盘平均 ${f(stats.mean)} ± ${stats.ci.toFixed(2)}；整场第一 ${(100 * stats.gameWin).toFixed(1)}%；${roles}${stats.problems.length ? `；问题 ${stats.problems.length}：${stats.problems[0]}` : ""}`);
  }
}
