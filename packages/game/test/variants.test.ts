/**
 * 补充文件第 4 节「开房变体细则」：让位贴牌 V1–V6、特画 V7–V12。测试名带编号。
 */
import { describe, expect, it } from "vitest";
import {
  beats,
  buildDeal,
  canAscend,
  chooseTieCard,
  effRank,
  HUANG_ID,
  kindOf,
  parseCards,
  parseSet,
  playOptions,
  type BaohuangState,
  type CardId,
  type ParsedSet,
  timeoutCommand,
} from "../src/index.js";
import { act, counts, legal, scene, SEATS, steps, view } from "./helpers.js";

describe("让位贴牌 V1–V6", () => {
  /**
   * 一条链：发牌起点 2，皇牌在 2（34 张）。座位 1 的 2 只有黑桃 2 ×3、红桃 2 ×1；座位 0 没有 2，A 只有方块 A ×2、梅花 A ×1，
   * 还有一张大王；座位 4 有红桃 2 ×2、没有恰好 3 张。
   */
  const chain = () =>
    scene({
      options: { tieCard: true },
      dealStart: 2,
      deal: buildDeal({
        dealStart: 2,
        must: ["DA DA CA 大", "S2 S2 S2 H2", "皇", "", "H2 H2"],
        avoidRanks: [[14, 15], [15], undefined, undefined, undefined],
        noThree: [4],
        seed: 12,
      }),
    });

  it("贴牌#V1 第一次让位不贴：2 让位，1 收到皇牌，2 = 33、1 = 34，贴牌区空", () => {
    let state = chain();
    expect(counts(state)[2]).toBe(34);
    expect(counts(state)[1]).toBe(33);
    state = act(state, 2, { type: "ABDICATE" });
    expect(counts(state)[2]).toBe(33);
    expect(counts(state)[1]).toBe(34);
    expect(state.tiePile).toEqual([]);
    expect(state.events.find((event) => event.type === "Abdicated")).toMatchObject({ count: 1, tie: null, carried: [] });
  });

  it("贴牌#V2 第二次让位贴 2，不拆能叫的牌：1 贴红桃 2（黑桃 2 是 3 张），所有人看得到", () => {
    let state = steps(chain(), ["2 abdicate"]);
    const before = counts(state);
    const h2 = state.players[1]!.hand.find((card) => kindOf(card) === "H2")!;
    state = act(state, 1, { type: "ABDICATE" });
    expect(state.tiePile).toEqual([h2]);
    expect(counts(state)[0]).toBe(before[0]! + 2);
    expect(counts(state)[1]).toBe(before[1]! - 2);
    expect(state.players[0]!.hand).toContain(h2);
    expect(state.players[0]!.hand).toContain(HUANG_ID);
    for (const seat of [2, 3, 4, -1]) {
      expect(view(state, seat).tiePile).toEqual([h2]);
      expect(view(state, seat).events.find((event) => event.type === "Abdicated")).toMatchObject({ from: 1, to: 0, count: 2, tie: h2, carried: [h2] });
    }
  });

  it("贴牌#V3 没有 2 贴最大的非王牌，并累积传递：0 贴方块 A（张数多的优先），4 收到皇牌 + 红桃 2 + 方块 A；大王不能贴", () => {
    let state = steps(chain(), ["2 abdicate", "1 abdicate"]);
    // 0 手里的红桃 2 是收到的贴牌，不算自己的。
    expect(state.players[0]!.hand.filter((card) => kindOf(card)?.endsWith("2"))).toHaveLength(1);
    const before = counts(state);
    state = act(state, 0, { type: "ABDICATE" });
    expect(state.tiePile.map(kindOf)).toEqual(["H2", "DA"]);
    expect(counts(state)[4]).toBe(before[4]! + 3);
    expect(counts(state)[0]).toBe(before[0]! - 3);
    expect(state.players[4]!.hand).toContain(HUANG_ID);
    expect(state.players[0]!.hand.some((card) => card.endsWith("JB"))).toBe(true);
  });

  it("贴牌#V4 贴牌让接牌人能登基：4 有红桃 2 ×2，收到红桃 2 后有 3 张，可以登基并叫红桃 2", () => {
    let state = steps(chain(), ["2 abdicate", "1 abdicate"]);
    expect(canAscend(state.players[4]!.hand)).toBe(false);
    state = steps(state, ["0 abdicate"]);
    expect(state.turn).toBe(4);
    expect(legal(state, 4)).toEqual([{ type: "ASCEND" }, { type: "ABDICATE" }]);
    state = steps(state, ["4 ascend"]);
    expect(state.tiePile).toEqual([]);
    expect(legal(state, 4)).toContainEqual({ type: "CALL", suit: "H", rank: 15, mode: "pair" });
    state = steps(state, ["4 call H2 pair"]);
    expect(state.guardCard).toEqual({ suit: "H", rank: 15 });
    expect(state.guard).not.toBeNull();
    expect(state.guard).not.toBe(4);
  });

  /** V5 的局面：发牌起点 2；3 有梅花 J ×3 和 2，4 有方块 7 ×3，0、1、2 不能登基，2 收到的贴牌凑不出恰好 3 张。 */
  const v5Deal = () => buildDeal({ dealStart: 2, must: ["S2", "H2", "皇", "CJ CJ CJ", "D7 D7 D7"], noCall: [0, 1, 2], avoidRanks: [[15], [15], [15], undefined, undefined], seed: 2 });

  it("贴牌#V5 全程张数守恒 + 逼位带走贴牌（推演表）；关掉贴牌和原 T3 一样", () => {
    let state = scene({ options: { tieCard: true }, dealStart: 2, deal: v5Deal() });
    const table: [number, number[]][] = [
      [2, [33, 34, 33, 34, 34]],
      [1, [35, 32, 33, 34, 34]],
      [0, [32, 32, 33, 34, 37]],
      [4, [32, 32, 33, 38, 33]],
    ];
    expect(counts(state)).toEqual([33, 33, 34, 34, 34]);
    for (const [seat, expected] of table) {
      state = act(state, seat, { type: "ABDICATE" });
      expect(counts(state)).toEqual(expected);
      expect(counts(state).reduce((a, b) => a + b)).toBe(168);
    }
    // 第 5 次让位：3 → 2（皇牌 + 3 累积 + 1 自贴 = 5 张），回到 H₀ = 2，逼位 → 3（皇牌 + 4 累积，不新贴）。
    expect(chooseTieCard(state.players[3]!.hand.filter((card) => card !== HUANG_ID), state.tiePile)).not.toMatch(/CJ$/);
    state = act(state, 3, { type: "ABDICATE" });
    const abdicated = state.events.find((event) => event.type === "Abdicated")!;
    expect(abdicated).toMatchObject({ from: 3, to: 2, count: 5 });
    expect(abdicated.type === "Abdicated" && abdicated.carried).toHaveLength(4);
    const forced = state.events.find((event) => event.type === "Forced")!;
    expect(forced).toMatchObject({ from: 2, seat: 3 });
    expect(forced.type === "Forced" && forced.carried).toHaveLength(4);
    expect(state.emperor).toBe(3);
    expect(counts(state)).toEqual([32, 32, 33, 38, 33]);
    expect(state.tiePile).toEqual([]);

    let plain = scene({ dealStart: 2, deal: v5Deal() });
    plain = steps(plain, ["2 abdicate", "1 abdicate", "0 abdicate", "4 abdicate", "3 abdicate"]);
    expect(plain.emperor).toBe(3);
    expect(counts(plain)).toEqual([33, 33, 33, 35, 34]);
  });

  it("贴牌#V5 补充：逼位时 H₀ 自己有资格（收到的贴牌凑成恰好 3 张），贴牌直接留在他手里", () => {
    let state = scene({
      options: { tieCard: true },
      dealStart: 2,
      deal: ["H2 S6", "H2 S7", "皇 S8", "CJ CJ CJ H2 S9", "D7 D7 D7 SA S10"],
    });
    state = steps(state, ["2 abdicate", "1 abdicate", "0 abdicate", "4 abdicate", "3 abdicate"]);
    expect(state.events.find((event) => event.type === "Abdicated")).toMatchObject({ from: 3, to: 2, count: 5 });
    expect(state.emperor).toBe(2);
    expect(state.forced).toBe(true);
    expect(state.events.find((event) => event.type === "Forced")).toMatchObject({ from: 2, seat: 2 });
    expect(state.players[2]!.hand.filter((card) => kindOf(card) === "H2")).toHaveLength(3);
    expect(counts(state)).toEqual([1, 1, 6, 4, 4]);
  });

  it("贴牌#V6 抢独不贴：贴牌和抢独都打开，座位 0 抢独成功，只有皇牌从持有者转到 0", () => {
    let state = scene({ options: { tieCard: true, grabSolo: true }, deal: buildDeal({ dealStart: 0, must: ["", "", "皇", "", ""], seed: 4 }) });
    const before = counts(state);
    state = steps(state, ["0 grab", "1 nograb", "2 nograb", "3 nograb", "4 nograb"]);
    expect(state.grabber).toBe(0);
    expect(state.tiePile).toEqual([]);
    expect(counts(state)).toEqual([before[0]! + 1, before[1], before[2]! - 1, before[3], before[4]]);
  });

  it("贴牌：自动让位、超时让位也照样贴；重发时贴牌作废", () => {
    let state = steps(chain(), ["2 abdicate"]);
    state = steps(state, ["timeout"]);
    expect(state.tiePile).toHaveLength(1);
    const redeal = scene({
      options: { tieCard: true },
      dealStart: 2,
      deal: buildDeal({ dealStart: 2, must: ["", "", "皇", "", ""], noCall: [0, 1, 2, 3, 4], seed: 2 }),
      steps: ["2 abdicate", "1 abdicate", "0 abdicate", "4 abdicate", "3 abdicate"],
    });
    expect(redeal.redeals).toBe(1);
    expect(redeal.tiePile).toEqual([]);
    expect(counts(redeal).reduce((a, b) => a + b)).toBe(168);
  });
});

describe("特画 V7–V12", () => {
  /** 皇帝 3 叫梅花 J（3 张），第 4 张梅花 J 在座位 0（暗保侍卫）；座位 1 有大王。 */
  const tehuaGame = (tehua: boolean) =>
    scene({
      options: { tehua },
      deal: ["CJ S9 S10", "大 S7", "C6 C7", "皇 CJ CJ CJ S6", "D6 D7"],
      steps: ["3 ascend", "3 call CJ pair", "timeout"],
    });

  it("特画#V7 哪张是特画：没亮的那张梅花 J（在座位 0），只有 0 看得到在自己手里；皇帝亮出的 3 张是普通 J", () => {
    const state = tehuaGame(true);
    const fourth = state.players[0]!.hand.find((card) => kindOf(card) === "CJ")!;
    expect(state.tehua).toBe(fourth);
    expect(state.shownCards).not.toContain(fourth);
    for (const card of state.shownCards) expect(effRank(card, { tehua: state.tehua })).toBe(11);
    expect(effRank(fourth, { tehua: state.tehua })).toBe(18);
    for (const seat of [1, 2, 3, 4, -1]) {
      const seen = view(state, seat);
      expect(seen.players.flatMap((player) => player.hand)).not.toContain(fourth);
      expect(seen.guard).toBeNull();
    }
    expect(view(state, 0).players[0]!.hand).toContain(fourth);
  });

  it("特画#V8 单出特画压大王，并公开身份；之后谁也压不了", () => {
    let state = steps(tehuaGame(true), ["3 play S6", "4 pass", "0 pass", "1 play 大", "2 pass", "3 pass", "4 pass"]);
    expect(state.turn).toBe(0);
    state = steps(state, ["0 play 特"]);
    expect(state.guardRevealed).toBe(true);
    expect(state.revealReason).toBe("tehua");
    expect(state.doubled).toBe(false);
    expect(state.events).toContainEqual({ type: "GuardRevealed", seat: 0, solo: false, reason: "tehua" });
    for (const seat of [1, 2, 3, 4]) expect(view(state, seat).guard).toBe(0);
    for (const seat of [1, 2, 3, 4]) {
      if (state.turn === seat) expect(legal(state, seat)).toEqual([{ type: "PASS" }]);
    }
  });

  it("特画#V9 特画按王组合，逐张比较", () => {
    const tehua = parseCards("0CJ")[0]!;
    const rules = { tehua, bie6: false };
    const set = (text: string) => {
      const used = new Set<CardId>([tehua]);
      return parseSet(text.split(" ").map((token) => (token === "特" ? tehua : parseCards(token, used)[0]!)), rules);
    };
    const r = (text: string) => (set(text) as ParsedSet).ranks;
    const rows: [string, string, boolean][] = [
      ["特 S9 S9", "大 S8 S8", true],
      ["特 大", "大 小", true],
      ["特 大", "大 大", false],
      ["大 大", "特 小", false],
      ["CJ CJ 特", "SQ SQ SQ", false],
      ["特 小 S2 S2", "大 大 SA SA", false],
    ];
    for (const [next, prev, expected] of rows) expect(beats(r(next), r(prev)), `${next} vs ${prev}`).toBe(expected);
    expect(r("特")).toEqual([18]);
    // J J 特 是「2 张 J + 1 张特画」，不是 3 张 J。
    expect(set("CJ CJ 特")).toMatchObject({ base: 11, normals: 2, wilds: 1 });
    // 能挂到 2 上，也能和它原来点数相同的那套一起出。
    expect(typeof set("S2 S2 特")).toBe("object");
    // 憋 6：保牌是 6 时特画也不能挂在 6 上；特画按王算，不受憋 6 限制。
    const six = parseCards("0H6")[0]!;
    const bie = { tehua: six, bie6: true };
    expect(typeof parseSet([...parseCards("S6 S6"), six], bie)).toBe("string");
    expect(typeof parseSet([six], bie)).toBe("object");
    const hand = [...parseCards("S6 S6"), six];
    expect(playOptions(hand, null, bie)).toEqual([[six]]);
  });

  it("特画#V10 暗独时的特画：皇帝没亮的那张红桃 9 是特画，打出的那一刻公开独保，倍数不变", () => {
    let state = scene({ options: { tehua: true }, deal: ["皇 H9 H9 H9 H9 S6", "S7 S8", "C6 C7", "D9 D10", "D6 D7"], steps: ["0 ascend", "0 call H9 dark", "timeout"] });
    const hidden = state.players[0]!.hand.find((card) => kindOf(card) === "H9" && !state.shownCards.includes(card))!;
    expect(state.tehua).toBe(hidden);
    expect(view(state, 2).mode).toBe("pair");
    state = act(state, 0, { type: "PLAY", cardIds: [hidden] });
    expect(state.guardRevealed).toBe(true);
    expect(state.events).toContainEqual({ type: "GuardRevealed", seat: 0, solo: true, reason: "tehua" });
    expect(view(state, 2).mode).toBe("darkSolo");
    expect(state.doubled).toBe(false);
  });

  it("特画#V11 明独、抢独没有特画：4 张都是普通牌，9 9 9 9 照常合法", () => {
    let state = scene({ options: { tehua: true }, deal: ["皇 H9 H9 H9 H9 S6", "S7 S8", "C6 C7", "D9 D10", "D6 D7"], steps: ["0 ascend", "0 call H9 open"] });
    expect(state.tehua).toBeNull();
    state = steps(state, ["0 play H9 H9 H9 H9"]);
    expect(state.lastPlay!.ranks).toEqual([9, 9, 9, 9]);
    const grabbed = scene({ options: { tehua: true, grabSolo: true }, deal: buildDeal({ must: ["皇", "", "", "", ""], seed: 3 }), steps: ["1 grab", "timeout"] });
    expect(grabbed.grabber).toBe(1);
    expect(grabbed.tehua).toBeNull();
  });

  it("特画#V12 选项关着时：那张梅花 J 是普通 J，压不了大王", () => {
    const state = steps(tehuaGame(false), ["3 play S6", "4 pass", "0 pass", "1 play 大", "2 pass", "3 pass", "4 pass"]);
    expect(state.tehua).toBeNull();
    const fourth = state.players[0]!.hand.find((card) => kindOf(card) === "CJ")!;
    expect(() => act(state, 0, { type: "PLAY", cardIds: [fourth] })).toThrow();
    expect(legal(state, 0)).toEqual([{ type: "PASS" }]);
  });

  it("特画：超时自动出牌不出特画（有别的牌时）", () => {
    const state = steps(tehuaGame(true), ["3 play S6", "4 pass", "0 play S9", "1 pass", "2 pass", "3 pass", "4 pass"]);
    expect(state.turn).toBe(0);
    expect(state.lastPlay).toBeNull();
    expect(timeoutCommand(state, 0)).toEqual({ type: "PLAY", cardIds: ["0S10"] });
  });
});

/** 局面里所有人的牌数合计。 */
export const totalCards = (state: BaohuangState) => SEATS.reduce((sum, seat) => sum + state.players[seat]!.hand.length, 0) + state.played.length;
