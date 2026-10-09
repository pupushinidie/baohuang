/**
 * 规则书第 10 节测试用例 T1–T17，和补充文件勘误 K1–K7。测试名带编号。
 */
import { describe, expect, it } from "vitest";
import {
  beats,
  buildDeal,
  canAscend,
  canCallTypes,
  checkPlay,
  DECK_SIZE,
  HUANG_ID,
  isHuang,
  kindOf,
  mustAscend,
  NO_RULES,
  parseCards,
  parseSet,
  rankOf,
  stackDeal,
  timeoutCommand,
  timeoutTurn,
  type BaohuangState,
  type ParsedSet,
} from "../src/index.js";
import { act, counts, deltas, gameWithDealStart, legal, scene, SEATS, steps, view } from "./helpers.js";

const ranksOf = (text: string) => (parseSet(parseCards(text)) as ParsedSet).ranks;
const canBeat = (next: string, prev: string) => beats(ranksOf(next), ranksOf(prev));

describe("规则书 T1–T17", () => {
  it("规则书#T1 牌数和发牌：168 张没有 3、4、5，发牌起点 2 时座位 2、3、4 各 34 张，0、1 各 33 张", () => {
    const state = gameWithDealStart(2);
    const all = state.players.flatMap((player) => player.hand);
    expect(all).toHaveLength(DECK_SIZE);
    expect(new Set(all).size).toBe(168);
    const byRank = new Map<number, number>();
    for (const card of all) byRank.set(rankOf(card), (byRank.get(rankOf(card)) ?? 0) + 1);
    for (const rank of [3, 4, 5]) expect(byRank.get(rank)).toBeUndefined();
    for (const rank of [6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) expect(byRank.get(rank)).toBe(16);
    expect(byRank.get(16)).toBe(4);
    expect(byRank.get(17)).toBe(4);
    expect(all.filter(isHuang)).toEqual([HUANG_ID]);
    expect(counts(state)).toEqual([33, 33, 34, 34, 34]);
    // 拿皇牌的人先表态。
    expect(state.stage).toBe("abdicate");
    expect(state.turn).toBe(state.huangHolder0);
    expect(state.players[state.huangHolder0!]!.hand).toContain(HUANG_ID);
  });

  it("规则书#T2 能不能登基（含勘误 K7：同时有 3 张和 4 张的逼位时也要登基）", () => {
    const rows: [string, string[], boolean, boolean][] = [
      ["H9 H9 H9 S6 C7", ["H9:3"], true, true],
      ["SK SK SK SK S6", ["S13:4"], true, false],
      ["H9 H9 H9 SK SK SK SK", ["H9:3", "S13:4"], true, true],
      ["小 小 小 S6", [], false, false],
      ["H9 S9 C9 D9", [], false, false],
      ["H2 H2 H2", ["H15:3"], true, true],
    ];
    for (const [hand, types, can, must] of rows) {
      const cards = parseCards(hand);
      expect(canCallTypes(cards).map((type) => `${type.suit}${type.rank}:${type.count}`)).toEqual(types);
      expect(canAscend(cards)).toBe(can);
      expect(mustAscend(cards)).toBe(must);
    }
  });

  /** T3 的局面：发牌起点 2，皇牌在 2；3 有梅花 J ×3，4 有方块 7 ×3；0、1、2 没有能叫的牌；第 4 张梅花 J 在座位 0（T4 用）。 */
  const t3Deal = () => buildDeal({ dealStart: 2, must: ["CJ", "", "皇", "CJ CJ CJ", "D7 D7 D7"], noCall: [0, 1, 2], seed: 3 });

  it("规则书#T3 让位和逼位：转一圈后按 2、3、4、0、1 找第一个有恰好 3 张的人，座位 3 必须登基", () => {
    let state = scene({ deal: t3Deal(), dealStart: 2 });
    expect(counts(state)).toEqual([33, 33, 34, 34, 34]);
    expect(state.huangHolder0).toBe(2);
    const route: [number, number][] = [[2, 1], [1, 0], [0, 4], [4, 3], [3, 2]];
    for (const [from, to] of route) {
      expect(state.turn).toBe(from);
      state = act(state, from, { type: "ABDICATE" });
      if (from !== 3) expect(state.huangHolder).toBe(to);
    }
    expect(state.emperor).toBe(3);
    expect(state.forced).toBe(true);
    expect(state.stage).toBe("call");
    expect(state.players[3]!.hand).toContain(HUANG_ID);
    expect(state.events.some((event) => event.type === "Forced" && event.seat === 3 && event.from === 2)).toBe(true);
    expect(counts(state)).toEqual([33, 33, 33, 35, 34]);
    expect(counts(state).reduce((a, b) => a + b)).toBe(168);
  });

  it("规则书#T4 叫保定侍卫：皇帝 3 叫梅花 J，第 4 张在座位 0 → 侍卫是 0，只有 0 知道，皇帝也不知道；保牌公开", () => {
    let state = scene({ deal: t3Deal(), dealStart: 2, steps: ["2 abdicate", "1 abdicate", "0 abdicate", "4 abdicate", "3 abdicate"] });
    state = steps(state, ["3 call CJ pair"]);
    expect(state.guard).toBe(0);
    expect(state.stage).toBe("declare");
    expect(view(state, 0).guard).toBe(0);
    expect(view(state, 3).guard).toBeNull();
    for (const seat of [1, 2, 4, -1]) expect(view(state, seat).guard).toBeNull();
    for (const seat of [0, 1, 2, 3, 4, -1]) {
      expect(view(state, seat).guardCard).toEqual({ suit: "C", rank: 11 });
      expect(view(state, seat).shownCards).toHaveLength(3);
      expect(view(state, seat).mode).toBe("pair");
    }
    // 侍卫的表态选项是明保 / 暗保，别人是造反 / 不造反。
    expect(legal(view(state, 0), 0)).toEqual([{ type: "DECLARE", choice: "openGuard" }, { type: "DECLARE", choice: "darkGuard" }]);
    expect(legal(view(state, 1), 1)).toEqual([{ type: "DECLARE", choice: "rebel" }, { type: "DECLARE", choice: "noRebel" }]);
  });

  describe("规则书#T5 表态", () => {
    /** 皇帝 0，侍卫 2（PAIR 局面）。 */
    const base = () => scene({ deal: ["皇 H9 H9 H9 S6 S7", "SA SK", "H9 SQ", "DQ DJ", "CA C10"], steps: ["0 ascend", "0 call H9 pair"] });
    const declare = (guard: "openGuard" | "darkGuard", rebels: number[]) =>
      steps(base(), [`2 declare ${guard}`, ...[1, 3, 4].map((seat) => `${seat} declare ${rebels.includes(seat) ? "rebel" : "noRebel"}`)]);

    it("明保：侍卫公开，×2（造反的选择照样公布但没有效果）", () => {
      const state = declare("openGuard", [1]);
      expect(state.guardRevealed).toBe(true);
      expect(state.doubled).toBe(true);
      expect(state.doubleReason).toBe("openGuard");
      expect(view(state, 3).guard).toBe(2);
      expect(view(state, 3).players.map((player) => player.declarePublic)).toEqual([null, "rebel", "openGuard", "noRebel", "noRebel"]);
      expect(state.rebelFailed).toBeNull();
    });

    it("暗保、0 人造反：不加倍，侍卫不公开，对外侍卫显示「不造反」", () => {
      const state = declare("darkGuard", []);
      expect(state.doubled).toBe(false);
      expect(state.guardRevealed).toBe(false);
      for (const seat of [0, 1, 3, 4, -1]) {
        const seen = view(state, seat);
        expect(seen.guard).toBeNull();
        expect(seen.players.map((player) => player.declarePublic)).toEqual([null, "noRebel", "noRebel", "noRebel", "noRebel"]);
        expect(seen.players[2]!.declare).toBeNull();
      }
      // 侍卫自己看得到自己选了暗保。
      expect(view(state, 2).players[2]!.declare).toBe("darkGuard");
    });

    it("暗保、1 人造反：不加倍，侍卫不公开，那个造反的人公开", () => {
      const state = declare("darkGuard", [3]);
      expect(state.doubled).toBe(false);
      expect(state.guardRevealed).toBe(false);
      expect(state.rebelFailed).toBe(3);
      expect(view(state, 1).players.map((player) => player.declarePublic)).toEqual([null, "noRebel", "noRebel", "rebel", "noRebel"]);
      expect(view(state, 1).guard).toBeNull();
    });

    it("暗保、2 人造反：造反成功，侍卫公开，×2；暗保 3 人造反也只 ×2", () => {
      for (const rebels of [[1, 3], [1, 3, 4]]) {
        const state = declare("darkGuard", rebels);
        expect(state.doubled).toBe(true);
        expect(state.doubleReason).toBe("rebel");
        expect(state.guardRevealed).toBe(true);
        expect(view(state, 4).guard).toBe(2);
        expect(view(state, 4).players[2]!.declarePublic).toBe("darkGuard");
      }
    });

    it("明保 + 2 人造反：只 ×2 一次（结算倍数是 2 不是 4）", () => {
      let state = declare("openGuard", [1, 3]);
      expect(state.doubled).toBe(true);
      // 皇帝 0 打完：S6、S7、H9 H9 H9、皇……直接用简单打法打到结算。
      state = steps(state, ["until handEnd"]);
      expect(state.summary!.multiplier).toBe(2);
    });

    it("暗独：4 个人都只看到造反 / 不造反；2 人造反 → 公开独保，×2；1 人造反 → 只公开他", () => {
      const solo = () => scene({ deal: ["皇 H9 H9 H9 H9 S6", "SA SK", "S9 SQ", "DQ DJ", "CA C10"], steps: ["0 ascend", "0 call H9 dark"] });
      let state = solo();
      for (const seat of [1, 2, 3, 4]) {
        expect(legal(view(state, seat), seat)).toEqual([{ type: "DECLARE", choice: "rebel" }, { type: "DECLARE", choice: "noRebel" }]);
        expect(view(state, seat).mode).toBe("pair");
      }
      expect(view(state, 0).mode).toBe("darkSolo");
      state = steps(state, ["1 declare rebel", "2 declare noRebel", "3 declare rebel", "4 declare noRebel"]);
      expect(state.doubled).toBe(true);
      expect(state.guardRevealed).toBe(true);
      expect(view(state, 1).mode).toBe("darkSolo");
      expect(view(state, 1).guard).toBe(0);
      expect(state.events.find((event) => event.type === "DeclaresRevealed")).toMatchObject({ soloRevealed: true, guard: 0 });

      state = steps(solo(), ["1 declare rebel", "2 declare noRebel", "3 declare noRebel", "4 declare noRebel"]);
      expect(state.doubled).toBe(false);
      expect(state.rebelFailed).toBe(1);
      expect(view(state, 2).mode).toBe("pair");
    });
  });

  it("规则书#T6 比大小（逐张比较）", () => {
    const rows: [string, string, boolean][] = [
      ["S8 S8 S8 S8", "S7 S7 S7 S7", true],
      ["大 小 小 小", "SA SA SA SA", true],
      ["小 S7 S7 S7", "S6 S6 S6 S6", true],
      ["大 S7 S7 S7 S7", "小 S6 S6 S6 S6", true],
      ["S9 S9 S9 S9", "小 S8 S8 S8", false],
      ["S2 S2", "SA SA", true],
      ["小 小", "S2 S2", true],
      ["大 小", "小 小", false],
      ["大 大", "小 小", true],
      ["皇", "大", false],
      ["S2 S2 S2", "大 S8 S8", false],
      ["S10 S10 S10", "S9 S9", false],
    ];
    for (const [next, prev, expected] of rows) expect(canBeat(next, prev), `${next} vs ${prev}`).toBe(expected);
    expect(typeof parseSet(parseCards("SA SA S2"))).toBe("string");
    // 2 可以挂王（勘误「核对过」一节）：2 2 小王合法。
    expect(typeof parseSet(parseCards("S2 S2 小"))).toBe("object");
    // 没有顺子。
    expect(typeof parseSet(parseCards("S9 S10"))).toBe("string");
    // 挂了大王的一套谁也压不了。
    expect(canBeat("大 S2 S2", "大 S8 S8")).toBe(false);
  });

  it("规则书#T7 过牌可上：1 过过牌还能上；之后 2、3、4、0 都过，1 自由出下一轮", () => {
    let state = scene({
      deal: ["皇 H9 H9 H9 S7 S10 SQ", "SJ D6 D8", "H9 S9 DK", "C6 C8 CQ", "D7 DA CK"],
      steps: ["0 ascend", "0 call H9 pair", "timeout"],
    });
    expect(state.turn).toBe(0);
    state = steps(state, ["0 play S7", "1 pass", "2 play S9", "3 pass", "4 pass", "0 play S10"]);
    expect(state.turn).toBe(1);
    expect(legal(state, 1)).toContainEqual({ type: "PLAY", cardIds: ["0SJ"] });
    state = steps(state, ["1 play SJ", "2 pass", "3 pass", "4 pass", "0 pass"]);
    expect(state.lastPlay).toBeNull();
    expect(state.turn).toBe(1);
    expect(state.events.at(-1)).toEqual({ type: "TrickWon", winner: 1, leader: 1, jiefeng: false });
    // 自由出牌不能过。
    expect(() => act(state, 1, { type: "PASS" })).toThrow();
  });

  it("规则书#T8 接风：2 用最后一张 2 走科，3、4、0、1 都过，由 3 自由出下一轮", () => {
    let state = scene({
      deal: ["皇 H9 H9 H9 S6 S8", "SK D6 D7", "H2", "H9 C6 C7", "D8 D9 D10"],
      steps: ["0 ascend", "0 call H9 pair", "timeout", "0 play S6", "1 play SK"],
    });
    expect(state.turn).toBe(2);
    state = steps(state, ["2 play H2"]);
    expect(state.players[2]!.place).toBe(1);
    state = steps(state, ["3 pass", "4 pass", "0 pass", "1 pass"]);
    expect(state.events.at(-1)).toEqual({ type: "TrickWon", winner: 2, leader: 3, jiefeng: true });
    expect(state.turn).toBe(3);
    expect(state.lastPlay).toBeNull();
  });

  it("规则书#T9 二打三结束和计分（例 1）：皇帝 2、侍卫 4 暗保没人造反，走科 0、2、4 → 侍卫 +1、皇帝 +2、0 1 3 各 −1", () => {
    let state = scene({ deal: ["SA", "S6 S7 S8", "皇 H9 H9 H9", "C6 C7 C8", "H9"], steps: ["2 ascend", "2 call H9 pair", "timeout"] });
    expect(state.guard).toBe(4);
    state = steps(state, ["2 play H9", "3 pass", "4 pass", "0 play SA", "1 pass", "2 play 皇", "3 pass", "4 pass", "1 pass"]);
    state = steps(state, ["2 play H9 H9", "3 pass", "4 pass", "1 pass", "3 play C6"]);
    expect(state.stage).toBe("playing");
    state = steps(state, ["4 play H9"]);
    expect(state.stage).toBe("handEnd");
    expect(state.summary!.finishOrder).toEqual([0, 2, 4]);
    expect(state.summary!.rankSum).toBe(5);
    expect(deltas(state)).toEqual([-1, -1, 2, -1, 1]);
    expect(state.players.map((player) => player.score)).toEqual([-1, -1, 2, -1, 1]);
  });

  it("规则书#T10 明保计分（例 2）：皇帝 1、侍卫 3 明保，走科 1、3 → 侍卫 +6、皇帝 +12、其余各 −6", () => {
    let state = scene({
      deal: ["S6 S7", "皇 H9 H9 H9", "C6 C7", "H9 HK", "D6 D7"],
      steps: ["1 ascend", "1 call H9 pair", "3 declare openGuard", "timeout"],
    });
    state = steps(state, ["1 play 皇", "2 pass", "3 pass", "4 pass", "0 pass", "1 play H9 H9 H9", "2 pass", "3 pass", "4 pass", "0 pass"]);
    state = steps(state, ["2 play C6", "3 play HK", "4 pass", "0 pass", "2 pass", "3 play H9"]);
    expect(state.summary!.finishOrder).toEqual([1, 3]);
    expect(deltas(state)).toEqual([-6, 12, -6, 6, -6]);
  });

  it("规则书#T11 革命党包揽前三（例 3）：暗保、2 人造反成功 → 侍卫 −6、皇帝 −12、革命党各 +6", () => {
    let state = scene({
      deal: ["皇 H9 H9 H9 S6", "SQ", "CK", "DA", "H9 S7"],
      steps: ["0 ascend", "0 call H9 pair", "4 declare darkGuard", "1 declare rebel", "2 declare rebel", "3 declare noRebel"],
    });
    expect(state.doubled).toBe(true);
    state = steps(state, ["0 play S6", "1 play SQ", "2 play CK"]);
    expect(state.stage).toBe("playing");
    state = steps(state, ["3 play DA"]);
    expect(state.stage).toBe("handEnd");
    expect(state.summary!.places).toEqual([null, 1, 2, 3, null]);
    expect(state.summary!.rankSum).toBe(9);
    expect(deltas(state)).toEqual([-12, 6, 6, 6, -6]);
  });

  describe("规则书#T12 暗独", () => {
    const deal = ["皇 H9 H9 H9 H9", "SA", "S6 S7", "CA", "D6 D7"];
    const start = (rebels: boolean) =>
      scene({ deal, steps: ["0 ascend", "0 call H9 dark", ...[1, 2, 3, 4].map((seat) => `${seat} declare ${rebels && seat <= 2 ? "rebel" : "noRebel"}`)] });
    const headFirst = ["0 play H9 H9 H9 H9", "1 pass", "2 pass", "3 pass", "4 pass", "0 play 皇"];
    const second = ["0 play H9", "1 play SA", "2 pass", "3 pass", "4 pass", "0 play 皇", "2 pass", "3 pass", "4 pass", "0 play H9 H9 H9"];
    const third = ["0 play H9", "1 play SA", "2 pass", "3 pass", "4 pass", "0 pass", "2 play S6", "3 play CA"];
    for (const [rebels, unit] of [[false, 1], [true, 2]] as const) {
      it(`${rebels ? "2 人造反（×2）" : "没人造反"}：0 头科 ${12 * unit} / 二科 0 / 三科 −${12 * unit}`, () => {
        let state = steps(start(rebels), headFirst);
        expect(state.summary!.finishOrder).toEqual([0]);
        expect(deltas(state)).toEqual([12 * unit, -3 * unit, -3 * unit, -3 * unit, -3 * unit]);
        state = steps(start(rebels), second);
        expect(state.summary!.finishOrder).toEqual([1, 0]);
        expect(deltas(state)).toEqual([0, 0, 0, 0, 0]);
        state = steps(start(rebels), third);
        expect(state.summary!.finishOrder).toEqual([1, 3]);
        expect(state.summary!.places[0]).toBeNull();
        expect(deltas(state)).toEqual([-12 * unit, 3 * unit, 3 * unit, 3 * unit, 3 * unit]);
      });
    }
  });

  it("规则书#T13 明独：0 头科 +24 / 有革命党先走立即结束 −24（开工拍板待确认 4）", () => {
    const start = () => scene({ deal: ["皇 H9 H9 H9 H9", "S6", "SA", "C6 C7", "D6 D7"], steps: ["0 ascend", "0 call H9 open"] });
    let state = start();
    // 明独跳过表态，直接出牌。
    expect(state.stage).toBe("playing");
    expect(state.guardRevealed).toBe(true);
    expect(view(state, 3).mode).toBe("openSolo");
    expect(state.shownCards).toHaveLength(4);
    state = steps(state, ["0 play H9 H9 H9 H9", "1 pass", "2 pass", "3 pass", "4 pass", "0 play 皇"]);
    expect(deltas(state)).toEqual([24, -6, -6, -6, -6]);
    state = steps(start(), ["0 play H9", "1 pass", "2 play SA"]);
    expect(state.stage).toBe("handEnd");
    expect(deltas(state)).toEqual([-24, 6, 6, 6, 6]);
  });

  describe("规则书#T14 抢独", () => {
    const deal = () => buildDeal({ dealStart: 0, must: ["", "", "皇", "", ""], seed: 21 });
    it("皇牌在 2，2 没按，0 和 4 按了 → 从 2 往上家数 1、0，座位 0 抢成；皇牌 2 → 0，跳过登基叫保表态", () => {
      let state = scene({ options: { grabSolo: true }, deal: deal() });
      expect(state.stage).toBe("grab");
      const before = counts(state);
      state = steps(state, ["0 grab", "4 grab", "1 nograb", "2 nograb"]);
      // 还没全选完：别人看不到任何变化。
      expect(state.stage).toBe("grab");
      state = steps(state, ["3 nograb"]);
      expect(state.grabber).toBe(0);
      expect(state.emperor).toBe(0);
      expect(state.mode).toBe("openSolo");
      expect(state.stage).toBe("playing");
      expect(state.turn).toBe(0);
      expect(state.players[0]!.hand).toContain(HUANG_ID);
      expect(counts(state)).toEqual([before[0]! + 1, before[1], before[2]! - 1, before[3], before[4]]);
      // 只公开抢成的人：4 也按了，但别人看不到。
      const chose = [true, false, false, false, true];
      for (const seat of [0, 1, 2, 3, 4, -1]) {
        expect(view(state, seat).players.map((player, other) => (other === seat ? chose[other] : player.grab))).toEqual(SEATS.map((other) => (other === seat ? chose[other] : null)));
      }
      expect(view(state, 4).players[4]!.grab).toBe(true);
      expect(state.events.find((event) => event.type === "GrabResolved")).toEqual({ type: "GrabResolved", seat: 0, from: 2 });
    });
    it("变化：座位 2 自己也按了 → 2 抢成（持有者优先）", () => {
      const state = steps(scene({ options: { grabSolo: true }, deal: deal() }), ["0 grab", "4 grab", "2 grab", "1 nograb", "3 nograb"]);
      expect(state.grabber).toBe(2);
      expect(state.mode).toBe("openSolo");
    });
    it("没人按 → 进入登基；抢独超时算不抢，不计入超时次数", () => {
      const state = steps(scene({ options: { grabSolo: true }, deal: deal() }), ["timeout"]);
      expect(state.stage).toBe("abdicate");
      expect(state.turn).toBe(2);
      expect(state.players.every((player) => player.timeouts === 0)).toBe(true);
    });
  });

  describe("规则书#T15 身份自动公开", () => {
    it("侍卫 0 暗保没被揭开，打出 J J J（含那张梅花 J）→ 0 被标记成侍卫，所有人可见，倍数不变", () => {
      let state = scene({
        deal: ["CJ SJ HJ D9", "S6 S7", "C6 C7", "皇 CJ CJ CJ S6", "D6 D7"],
        steps: ["3 ascend", "3 call CJ pair", "timeout", "3 play S6", "4 pass", "0 play D9", "1 pass", "2 pass", "3 pass", "4 pass"],
      });
      expect(state.guardRevealed).toBe(false);
      expect(view(state, 1).guard).toBeNull();
      state = steps(state, ["0 play J J J"]);
      expect(state.guardRevealed).toBe(true);
      expect(state.revealReason).toBe("played");
      expect(state.doubled).toBe(false);
      for (const seat of [1, 2, 3, 4, -1]) expect(view(state, seat).guard).toBe(0);
      expect(state.events).toContainEqual({ type: "GuardRevealed", seat: 0, solo: false, reason: "played" });
    });
    it("暗独时皇帝打出全部 4 张梅花 J → 公开独保；只打出 3 张时不公开，打出的也只会是亮过的那 3 张", () => {
      const start = () => scene({ deal: ["皇 CJ CJ CJ CJ S6", "S7 S8", "C6 C7", "D9 D10", "D6 D7"], steps: ["0 ascend", "0 call CJ dark", "timeout"] });
      let state = steps(start(), ["0 play CJ CJ CJ CJ"]);
      expect(state.guardRevealed).toBe(true);
      expect(view(state, 2).mode).toBe("darkSolo");
      expect(state.doubled).toBe(false);
      expect(state.events).toContainEqual({ type: "GuardRevealed", seat: 0, solo: true, reason: "played" });
      // 只出 3 张：就算点的是没亮的那张，打出去的也换成亮过的 3 张，别人从牌 id 看不出是暗独。
      state = start();
      const hidden = state.players[0]!.hand.find((card) => kindOf(card) === "CJ" && !state.shownCards.includes(card))!;
      const shown = state.shownCards;
      state = act(state, 0, { type: "PLAY", cardIds: [hidden, shown[0]!, shown[1]!] });
      expect(state.guardRevealed).toBe(false);
      expect([...state.lastPlay!.cards].sort()).toEqual([...shown].sort());
      expect(view(state, 2).mode).toBe("pair");
    });
  });

  it("规则书#T16（按勘误 K5 改过）憋 6：6 6 9 9 小王", () => {
    const rules = { tehua: null, bie6: true };
    const hand = parseCards("S6 S6 S9 S9 小");
    const ok = (text: string, h = hand) => typeof checkPlay(h, pick(h, text), null, rules) !== "string";
    const pick = (h: string[], text: string) => {
      const left = [...h];
      return text.split(" ").map((token) => {
        const index = left.findIndex((card) => (token === "小" ? rankOf(card) === 16 : rankOf(card) === Number(token)));
        return left.splice(index, 1)[0]!;
      });
    };
    for (const bad of ["6", "6 6", "6 小", "6 6 小"]) expect(ok(bad), bad).toBe(false);
    for (const good of ["9", "9 9", "小", "9 小", "9 9 小"]) expect(ok(good), good).toBe(true);
    const sixSmall = parseCards("S6 S6 小");
    expect(ok("小", sixSmall)).toBe(true);
    expect(ok("6", sixSmall)).toBe(false);
    expect(ok("6 6", sixSmall)).toBe(false);
    const sixes = parseCards("S6 S6");
    expect(ok("6 6", sixes)).toBe(true);
    expect(ok("6", sixes)).toBe(false);
    // 憋 6 关着时都能出。
    expect(typeof checkPlay(hand, pick(hand, "6 小"), null, NO_RULES)).toBe("object");
    // 剩下只有 6 时可以跟（张数相同、压得住才行——6 最小，实际压不住）。
    expect(typeof checkPlay(sixes, sixes, [6, 6], rules)).toBe("string");
  });

  describe("规则书#T17 超时（含勘误 K4）", () => {
    it("登基阶段轮到座位 1，超时 → 让位", () => {
      let state = scene({ deal: buildDeal({ dealStart: 0, must: ["", "皇", "", "", ""], seed: 2 }) });
      expect(state.turn).toBe(1);
      state = timeoutTurn(state);
      expect(state.abdications).toEqual([1]);
      expect(state.huangHolder).toBe(0);
      expect(state.players[1]!.timeouts).toBe(1);
    });
    it("逼位到座位 3 → 自动登基；叫保超时叫第一种「恰好 3 张」（没有就叫 4 张、暗独）", () => {
      let state = scene({
        deal: buildDeal({ dealStart: 2, must: ["", "", "皇", "CJ CJ CJ D8 D8 D8 D8", "D7 D7 D7"], noCall: [0, 1, 2], seed: 3 }),
        dealStart: 2,
        steps: ["2 abdicate", "1 abdicate", "0 abdicate", "4 abdicate", "3 abdicate"],
      });
      expect(state.emperor).toBe(3);
      const firstThree = (canCallTypes(state.players[3]!.hand).find((type) => type.count === 3))!;
      expect(timeoutCommand(state, 3)).toEqual({ type: "CALL", suit: firstThree.suit, rank: firstThree.rank, mode: "pair" });
      state = timeoutTurn(state);
      expect(state.guardCard).toEqual({ suit: firstThree.suit, rank: firstThree.rank });
      expect(state.mode).toBe("pair");
      const onlyFour = scene({ deal: ["皇 H9 H9 H9 H9", "S6", "S7", "S8", "S9"], steps: ["0 ascend"] });
      expect(timeoutCommand(onlyFour, 0)).toEqual({ type: "CALL", suit: "H", rank: 9, mode: "darkSolo" });
    });
    it("表态超时 → 侍卫暗保、其他人不造反", () => {
      const state = scene({ deal: ["皇 H9 H9 H9 S6", "S7", "H9 S8", "S9", "S10"], steps: ["0 ascend", "0 call H9 pair", "timeout"] });
      expect(state.players.map((player) => player.declare)).toEqual([null, "noRebel", "darkGuard", "noRebel", "noRebel"]);
      expect(state.doubled).toBe(false);
      expect(state.stage).toBe("playing");
    });
    it("出牌：自由出牌超时出最小的一张普通牌，跟牌超时过", () => {
      let state = scene({ deal: ["皇 H9 H9 H9 S6 SK 小", "S7 S8", "H9 S9", "S10 SJ", "SQ SA"], steps: ["0 ascend", "0 call H9 pair", "timeout"] });
      state = timeoutTurn(state);
      expect(state.lastPlay!.cards).toEqual(["0S6"]);
      state = timeoutTurn(state);
      expect(state.table[1]).toEqual({ kind: "pass" });
    });
    it("勘误 K4：只剩王出一张小王，没有小王出大王；憋 6 时跳过 6、只剩 6 一次出完", () => {
      // 让座位 1 接风自由出牌，看他超时出什么。
      const only = (hand: string, options = {}) => {
        let state = scene({ options, deal: ["皇 H9 H9 H9", hand, "H9 S8", "S9 S10", "SJ SQ"], steps: ["0 ascend", "0 call H9 pair", "timeout", "0 play 皇", "1 pass", "2 pass", "3 pass", "4 pass", "0 play H9 H9 H9"] });
        // 0 走科、没人压 → 接风给 1。
        state = steps(state, ["1 pass", "2 pass", "3 pass", "4 pass"]);
        expect(state.turn).toBe(1);
        return timeoutCommand(state, 1);
      };
      expect(only("小 大")).toEqual({ type: "PLAY", cardIds: ["0JS"] });
      expect(only("大 大")).toEqual({ type: "PLAY", cardIds: ["1JB"] });
      expect(only("S6 S6 S9 小", { bie6: true })).toEqual({ type: "PLAY", cardIds: ["0S9"] });
      expect(only("S6 S6 小", { bie6: true })).toEqual({ type: "PLAY", cardIds: ["0JS"] });
      expect(only("S6 S6", { bie6: true })).toEqual({ type: "PLAY", cardIds: ["0S6", "1S6"] });
    });
    it("连续 2 次超时进入托管（抢独、结算不算）", () => {
      let state = scene({ deal: ["皇 H9 H9 H9 S6 SK", "S7 S8 SQ", "H9 S9", "S10 SJ", "SQ SA"], bots: [], steps: ["0 ascend", "0 call H9 pair", "1 declare noRebel", "2 declare darkGuard", "3 declare noRebel", "4 declare noRebel"] });
      state = timeoutTurn(state); // 0 自由出牌超时
      expect(state.players[0]!.timeouts).toBe(1);
      expect(state.players[0]!.auto).toBe(false);
      state = steps(state, ["1 play S7", "2 pass", "3 pass", "4 pass"]);
      state = timeoutTurn(state); // 0 跟牌超时
      expect(state.players[0]!.auto).toBe(true);
      expect(state.events).toContainEqual({ type: "AutoChanged", seat: 0, on: true });
    });
  });
});

describe("勘误 K1–K7", () => {
  it("勘误#K1 挂小王的牌：新的一手至少要同样多张大王，其余逐张比，可以用更大的点数也可以用王", () => {
    expect(canBeat("大 小 小 小", "小 S8 S8 S8")).toBe(true);
    expect(canBeat("大 小 S9 S9", "小 S8 S8 S8")).toBe(true);
    expect(canBeat("小 小 S9 S9", "小 S8 S8 S8")).toBe(false);
    expect(canBeat("大 S9 S9 S9", "小 S8 S8 S8")).toBe(true);
  });

  it("勘误#K2 独保时一盘的结束：暗独 1 个革命党走科不结束、2 个结束；明独任何 1 个结束", () => {
    let state = scene({ deal: ["皇 H9 H9 H9 H9 S6", "SA", "SK S6", "CA", "D6 D7"], steps: ["0 ascend", "0 call H9 dark", "timeout", "0 play S6", "1 play SA"] });
    expect(state.stage).toBe("playing");
    state = steps(state, ["2 pass", "3 pass", "4 pass", "0 pass", "2 play S6", "3 play CA"]);
    expect(state.stage).toBe("handEnd");
    const open = scene({ deal: ["皇 H9 H9 H9 H9 S6", "SA", "SK S6", "CA", "D6 D7"], steps: ["0 ascend", "0 call H9 open", "0 play S6", "1 play SA"] });
    expect(open.stage).toBe("handEnd");
    expect(open.summary!.deltas).toEqual([-24, 6, 6, 6, 6]);
  });

  it("勘误#K3 没走科的人名次是 null（界面显示「未走科」）；暗独皇帝没走按三科或更差算", () => {
    const state = scene({ deal: ["皇 H9 H9 H9 H9 S6", "SA", "SK S6", "CA", "D6 D7"], steps: ["0 ascend", "0 call H9 dark", "timeout", "0 play S6", "1 play SA", "2 pass", "3 pass", "4 pass", "0 pass", "2 play S6", "3 play CA"] });
    expect(state.summary!.places).toEqual([null, 1, null, 2, null]);
    expect(state.summary!.deltas).toEqual([-12, 3, 3, 3, 3]);
    // 结算时剩下的牌公开。
    expect(view(state, 3).players[0]!.hand.length).toBeGreaterThan(0);
    expect(state.summary!.leftovers[0]!.length).toBe(state.players[0]!.hand.length);
  });

  it("勘误#K4 见 T17（只剩王、憋 6 的超时出牌）", () => {
    // 在 T17 里测；这里再确认特画打开时超时不会先出特画。
    const state = scene({ options: { tehua: true }, deal: ["皇 H9 H9 H9", "S7", "H9 小", "S9", "S10"], steps: ["0 ascend", "0 call H9 pair", "timeout", "0 play 皇", "1 pass", "2 pass", "3 pass", "4 pass", "0 play H9 H9 H9", "1 pass", "2 pass", "3 pass", "4 pass", "1 play S7"] });
    expect(state.turn).toBe(2);
    expect(timeoutCommand(state, 2)).toEqual({ type: "PASS" });
    const lead = steps(state, ["2 pass", "3 pass", "4 pass"]);
    // 1 走科后没人压，接风给 2：2 手里有特画和小王，超时出小王。
    expect(lead.turn).toBe(2);
    expect(timeoutCommand(lead, 2)).toEqual({ type: "PLAY", cardIds: ["0JS"] });
  });

  it("勘误#K5 见 T16", () => {
    expect(true).toBe(true);
  });

  it("勘误#K6 同时表态：选完之前别人看不到谁选了（状态、事件、version 都不变）", () => {
    const start = scene({ deal: ["皇 H9 H9 H9 S6", "S7", "H9 S8", "S9", "S10"], steps: ["0 ascend", "0 call H9 pair"] });
    const after = steps(start, ["2 declare openGuard", "1 declare rebel"]);
    for (const seat of [0, 3, 4, -1]) expect(view(after, seat)).toEqual(view(start, seat));
    expect(after.version).toBe(start.version);
    expect(after.step).toBe(start.step);
    // 自己能看到自己选了什么。
    expect(view(after, 2).players[2]!.declare).toBe("openGuard");
  });

  it("勘误#K7 逼位：同时有恰好 3 张和 4 张同花同点的人也必须登基", () => {
    const state = scene({
      deal: buildDeal({ dealStart: 2, must: ["", "", "皇", "CJ CJ CJ D8 D8 D8 D8", ""], noCall: [0, 1, 2, 4], seed: 9 }),
      dealStart: 2,
      steps: ["2 abdicate", "1 abdicate", "0 abdicate", "4 abdicate", "3 abdicate"],
    });
    expect(state.emperor).toBe(3);
    expect(state.forced).toBe(true);
    // 只有 4 张、没有恰好 3 张的人不强迫：都没有 → 重发。
    const redeal = scene({
      deal: buildDeal({ dealStart: 2, must: ["", "", "皇", "D8 D8 D8 D8", ""], noCall: [0, 1, 2, 4], noThree: [3], seed: 9 }),
      dealStart: 2,
      steps: ["2 abdicate", "1 abdicate", "0 abdicate", "4 abdicate", "3 abdicate"],
    });
    expect(redeal.redeals).toBe(1);
    expect(redeal.handNo).toBe(1);
    expect(redeal.dealStart).toBe(2);
    expect(redeal.events.some((event) => event.type === "Redeal")).toBe(true);
    expect(counts(redeal).reduce((a, b) => a + b)).toBe(168);
    expect(redeal.abdications).toEqual([]);
  });
});

describe("其他规则点", () => {
  it("3.4 让位：交给上家，不贴牌；不能登基的人不能登基", () => {
    let state = scene({ deal: buildDeal({ dealStart: 0, must: ["皇", "", "", "", ""], noCall: [0], seed: 5 }) });
    expect(legal(state, 0)).toEqual([{ type: "ABDICATE" }]);
    expect(() => act(state, 0, { type: "ASCEND" })).toThrow();
    const before = counts(state);
    state = act(state, 0, { type: "ABDICATE" });
    expect(state.huangHolder).toBe(4);
    expect(counts(state)).toEqual([before[0]! - 1, before[1], before[2], before[3], before[4]! + 1]);
    // 事件里不说他是不是「不能登基才让的」。
    expect(state.events.find((event) => event.type === "Abdicated")).toEqual({ type: "Abdicated", from: 0, to: 4, count: 1, tie: null, carried: [] });
  });

  it("3.5 叫保：3 张只能二打三，4 张只能暗独 / 明独；叫的牌要在手里", () => {
    const state = scene({ deal: ["皇 H9 H9 H9 H9 C7 C7 C7", "S7", "C7 S8", "S9", "S10"], steps: ["0 ascend"] });
    expect(() => act(state, 0, { type: "CALL", suit: "C", rank: 7, mode: "darkSolo" })).toThrow();
    expect(() => act(state, 0, { type: "CALL", suit: "H", rank: 9, mode: "pair" })).toThrow();
    expect(() => act(state, 0, { type: "CALL", suit: "S", rank: 9, mode: "pair" })).toThrow();
    expect(legal(state, 0)).toEqual([
      { type: "CALL", suit: "C", rank: 7, mode: "pair" },
      { type: "CALL", suit: "H", rank: 9, mode: "darkSolo" },
      { type: "CALL", suit: "H", rank: 9, mode: "openSolo" },
    ]);
  });

  it("5.8 皇牌出牌时就是大王，没有额外效果；7.1 并列都算赢、按发牌起点轮换", () => {
    expect(canBeat("大", "皇")).toBe(false);
    const finished = scene({
      handNo: 5,
      scores: [0, 9, -3, -3, -3],
      deal: ["皇 H9 H9 H9 S6", "S7 S8 S9", "H9 SK", "DQ DJ D10", "CA C10 C8"],
      steps: ["0 ascend", "0 call H9 pair", "timeout", "0 play S6", "1 play S8", "2 play SK", "3 pass", "4 play CA", "0 play 皇", "1 pass", "2 pass", "3 pass", "4 pass", "0 play H9 H9 H9", "1 pass", "2 pass", "3 pass", "4 pass", "1 play S7", "2 play H9"],
    });
    expect(finished.phase).toBe("finished");
    expect(finished.players.map((player) => player.score)).toEqual([6, 6, 0, -6, -6]);
    expect(finished.finalResult).toEqual({ winners: ["p0", "p1"], ranks: [1, 1, 3, 4, 4] });
  });

  it("3.2 第 2 盘起发牌起点是上一盘的皇帝；重发不算一盘", () => {
    let state = scene({ config: { }, deal: ["皇 S6", "S7", "S8", "H9 H9 H9 S9", "S10"], steps: ["0 abdicate", "4 abdicate", "3 ascend"] });
    expect(state.emperor).toBe(3);
    // 3 叫红桃 9：第 4 张不在任何人手里（短牌局面）→ 不能叫二打三。
    expect(() => steps(state, ["3 call H9 pair"])).toThrow();
    state = scene({ deal: ["皇 S6", "H9 S7", "S8", "H9 H9 H9 S9", "S10"], steps: ["0 abdicate", "4 abdicate", "3 ascend", "3 call H9 pair", "timeout", "until handEnd"] });
    expect(state.stage).toBe("handEnd");
    state = steps(state, ["0 ready", "1 ready", "2 ready", "3 ready", "4 ready"]);
    expect(state.handNo).toBe(2);
    expect(state.dealStart).toBe(3);
    expect(counts(state)).toEqual([33, 33, 33, 34, 34].map((_, seat) => ((seat - 3 + 5) % 5 < 3 ? 34 : 33)));
  });
});

/** 拿某个状态里所有人的牌数合计。 */
export function total(state: BaohuangState): number {
  return state.players.reduce((sum, player) => sum + player.hand.length, 0) + state.played.length;
}

describe("配件守恒（抽查）", () => {
  it("每个座位的牌在整盘里只会减少到 0，打出的牌 + 手牌始终是发下去的那些", () => {
    let state = scene({ deal: buildDeal({ seed: 1, must: ["皇 H9 H9 H9", "", "H9", "", ""] }), steps: ["0 ascend", "0 call H9 pair", "timeout"] });
    for (let k = 0; k < 400 && state.stage === "playing"; k += 1) {
      state = steps(state, ["simple 1"]);
      expect(total(state)).toBe(168);
    }
    expect(state.stage).toBe("handEnd");
    expect(SEATS.reduce((sum, seat) => sum + state.summary!.deltas[seat]!, 0)).toBe(0);
  });
  it("stackDeal 不接受重复的牌", () => {
    const state = scene({});
    expect(() => stackDeal(state, [["0H9"], ["0H9"], [HUANG_ID], [], []])).toThrow();
  });
});
