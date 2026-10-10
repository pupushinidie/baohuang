/**
 * 引擎的其他保证：出法列举和逐一检查一致（暴力对拍）、不合法操作给中文原因、apply 不改输入、事件不带隐藏信息。
 */
import { describe, expect, it } from "vitest";
import {
  applyCommand,
  checkPlay,
  createGame,
  createRng,
  effRank,
  fullDeck,
  parseCards,
  playOptions,
  redactGameForViewer,
  type CardId,
  type SetRules,
} from "../src/index.js";
import { act, scene, steps, view } from "./helpers.js";

const shapeKey = (cards: readonly CardId[], rules: SetRules) => cards.map((card) => effRank(card, rules)).sort((a, b) => a - b).join(",");

describe("出法列举（playOptions）", () => {
  it("和暴力枚举所有子集再逐一 checkPlay 的结果一样（自由出牌 / 跟牌，憋 6、特画开关都试）", () => {
    const rng = createRng(42);
    const deck = fullDeck();
    for (let round = 0; round < 300; round += 1) {
      const hand = rng.shuffle(deck).slice(0, 9);
      const tehua = round % 3 === 0 ? hand.find((card) => card[1] !== "J") ?? null : null;
      const rules: SetRules = { tehua, bie6: round % 2 === 0 };
      const topSource = rng.shuffle(deck).slice(0, 1 + rng.int(3));
      const top = round % 4 === 0 ? null : (() => {
        const parsed = checkPlay(topSource, [topSource[0]!], null, { tehua: null, bie6: false });
        return typeof parsed === "string" ? null : parsed.ranks;
      })();
      const brute = new Set<string>();
      for (let mask = 1; mask < 1 << hand.length; mask += 1) {
        const subset = hand.filter((_, index) => mask & (1 << index));
        if (typeof checkPlay(hand, subset, top, rules) !== "string") brute.add(shapeKey(subset, rules));
      }
      const listed = playOptions(hand, top, rules);
      for (const cards of listed) expect(typeof checkPlay(hand, cards, top, rules)).toBe("object");
      const keys = listed.map((cards) => shapeKey(cards, rules));
      expect(new Set(keys).size).toBe(keys.length);
      expect([...new Set(keys)].sort()).toEqual([...brute].sort());
    }
  });
});

describe("不合法的操作", () => {
  const playing = () => scene({ deal: ["皇 H9 H9 H9 S6 S7 S7", "S8 S9", "H9 S10", "SJ SQ", "SK SA"], steps: ["0 ascend", "0 call H9 pair", "timeout"] });
  it("给出中文原因，状态不变", () => {
    const state = playing();
    const cases: [number, Parameters<typeof applyCommand>[2], RegExp][] = [
      [1, { type: "PLAY", cardIds: ["0S8"] }, /还没轮到你/],
      [0, { type: "PLAY", cardIds: ["0S8"] }, /不在你手里/],
      [0, { type: "PLAY", cardIds: [] }, /请选要出的牌/],
      [0, { type: "PLAY", cardIds: ["0S6", "0S7"] }, /同一个点数/],
      [0, { type: "PASS" }, /不能过/],
      [0, { type: "ASCEND" }, /不是登基/],
      [0, { type: "DECLARE", choice: "rebel" }, /不是表态/],
      [0, { type: "READY" }, /不是结算/],
    ];
    for (const [seat, command, message] of cases) expect(() => act(state, seat, command)).toThrow(message);
    expect(() => applyCommand(state, "nobody", { type: "PASS" })).toThrow(/不在这局/);
    const after = steps(state, ["0 play S7 S7"]);
    expect(() => act(after, 1, { type: "PLAY", cardIds: ["0S8"] })).toThrow(/要出 2 张/);
    expect(() => act(after, 1, { type: "PLAY", cardIds: ["0S8", "0S9"] })).toThrow(/同一个点数/);
  });
  it("表态：侍卫只能明保暗保，别人只能造反不造反，皇帝不用表态，选过不能改", () => {
    const state = scene({ deal: ["皇 H9 H9 H9 S6", "S7", "H9 S8", "S9", "S10"], steps: ["0 ascend", "0 call H9 pair"] });
    expect(() => act(state, 2, { type: "DECLARE", choice: "rebel" })).toThrow(/侍卫/);
    expect(() => act(state, 1, { type: "DECLARE", choice: "openGuard" })).toThrow(/造反/);
    expect(() => act(state, 0, { type: "DECLARE", choice: "noRebel" })).toThrow(/皇帝不用表态/);
    const chose = act(state, 1, { type: "DECLARE", choice: "rebel" });
    expect(() => act(chose, 1, { type: "DECLARE", choice: "noRebel" })).toThrow(/已经选过/);
  });
  it("造反选项关着时只有不造反", () => {
    const state = scene({ options: { rebel: false }, deal: ["皇 H9 H9 H9 S6", "S7", "H9 S8", "S9", "S10"], steps: ["0 ascend", "0 call H9 pair"] });
    expect(() => act(state, 1, { type: "DECLARE", choice: "rebel" })).toThrow();
    expect(steps(state, ["1 declare noRebel", "2 declare openGuard", "3 declare noRebel", "4 declare noRebel"]).doubled).toBe(true);
  });
});

describe("纯函数和事件", () => {
  it("apply 不改输入；同一种子同一串操作得到同一局", () => {
    const players = [0, 1, 2, 3, 4].map((seat) => ({ id: `p${seat}`, name: `n${seat}` }));
    const a = createGame(players, 99);
    const b = createGame(players, 99);
    expect(a).toEqual(b);
    const before = JSON.stringify(a);
    const holder = a.players[a.turn]!.id;
    const next = applyCommand(a, holder, { type: "ABDICATE" });
    expect(JSON.stringify(a)).toBe(before);
    expect(next.version).toBe(a.version + 1);
  });

  it("事件都是公开的：不记谁按了抢独、谁表态选了什么、谁是不能登基才让位的", () => {
    let state = scene({ options: { grabSolo: true }, deal: ["皇 H9 H9 H9 S6", "S7", "H9 S8", "S9", "S10"] });
    state = steps(state, ["1 grab", "0 nograb", "2 nograb", "3 nograb"]);
    expect(JSON.stringify(redactGameForViewer(state, "p3").history)).not.toContain('"grab":true');
    state = steps(state, ["4 grab"]);
    // 1 和 4 都按了：0 往上家数 4 先到，只公开 4。
    expect(state.grabber).toBe(4);
    expect(state.history.filter((event) => event.type === "GrabResolved")).toEqual([{ type: "GrabResolved", seat: 4, from: 0 }]);
    const declare = scene({ deal: ["皇 H9 H9 H9 S6", "S7", "H9 S8", "S9", "S10"], steps: ["0 ascend", "0 call H9 pair", "2 declare darkGuard", "1 declare noRebel", "3 declare noRebel"] });
    expect(declare.history.some((event) => JSON.stringify(event).includes("darkGuard"))).toBe(false);
    expect(view(declare, 4).players.map((player) => player.declare)).toEqual([null, null, null, null, null]);
  });

  it("parseCards 写法：花色点数、王、皇牌、完整 id；同一种牌依次取不同副", () => {
    expect(parseCards("H9 H9 小 大 皇 2D10")).toEqual(["0H9", "1H9", "0JS", "1JB", "0JB", "2D10"]);
    expect(() => parseCards("H9 H9 H9 H9 H9")).toThrow();
    expect(() => parseCards("S5")).toThrow();
  });
});
