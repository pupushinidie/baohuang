/**
 * 预览局面工厂（对外接口）：每个常用局面都能造出来、是它说的那个样子；包成快照后隐藏信息照样藏好。
 */
import { describe, expect, it } from "vitest";
import { applyCommand, buildDeal, createScene, dealSizes, legalCommands, scene, SCENE_NAMES, sceneSnapshot, toSnapshot } from "../src/index.js";

describe("预览局面工厂", () => {
  it("SCENE_NAMES 里每个局面都能造出来，带说明；从它的视角包成快照不带种子", () => {
    expect(SCENE_NAMES.length).toBeGreaterThanOrEqual(35);
    for (const name of SCENE_NAMES) {
      const result = scene(name);
      expect(result.note.length, name).toBeGreaterThan(4);
      const snapshot = sceneSnapshot(name);
      for (const key of ["seed", "rng", "log", "timedOut"]) expect(key in snapshot.game!, `${name} ${key}`).toBe(false);
      if (!result.god && snapshot.game!.stage !== "handEnd" && snapshot.game!.phase !== "finished") {
        snapshot.game!.players.forEach((player, seat) => {
          if (seat !== result.viewer) expect(player.hand, `${name} 座位 ${seat}`).toEqual([]);
        });
      }
    }
  });

  it("各阶段的局面就是说明里的样子", () => {
    const at = (name: string) => scene(name).state;
    expect(at("start").stage).toBe("abdicate");
    expect(legalCommands(at("start"), "p0")).toEqual([{ type: "ASCEND" }, { type: "ABDICATE" }]);
    expect(legalCommands(at("start-cannot"), "p0")).toEqual([{ type: "ABDICATE" }]);
    expect(at("abdicating").abdications).toEqual([2, 1]);
    expect(at("tie-abdicating").tiePile).toHaveLength(1);
    expect(at("forced")).toMatchObject({ stage: "call", emperor: 3, forced: true });
    expect(at("forced-me")).toMatchObject({ stage: "call", emperor: 0, forced: true });
    expect(legalCommands(at("call"), "p0").map((command) => command.type === "CALL" && command.mode)).toEqual(expect.arrayContaining(["pair", "darkSolo", "openSolo"]));
    expect(sceneSnapshot("declare-guard").game!.guard).toBe(2);
    expect(sceneSnapshot("declare-rebel").game!.guard).toBeNull();
    expect(sceneSnapshot("declare-waiting").game!.players[1]!.declare).toBe("rebel");
    expect(sceneSnapshot("declare-queued").queued).toEqual({ type: "DECLARE", choice: "rebel" });
    expect(at("reveal-open")).toMatchObject({ doubled: true, doubleReason: "openGuard", guardRevealed: true });
    expect(at("reveal-rebel")).toMatchObject({ doubled: true, doubleReason: "rebel", guardRevealed: true });
    expect(at("reveal-fail")).toMatchObject({ doubled: false, rebelFailed: 1, guardRevealed: false });
    expect(at("reveal-none")).toMatchObject({ doubled: false, rebelFailed: null, guardRevealed: false });
    expect(at("reveal-darksolo")).toMatchObject({ mode: "darkSolo", guardRevealed: true, doubled: true });
    expect(sceneSnapshot("dark-solo").game!.mode).toBe("darkSolo");
    expect(sceneSnapshot("dark-solo-other").game!.mode).toBe("pair");
    expect(at("open-solo")).toMatchObject({ mode: "openSolo", stage: "playing" });
    expect(at("grab").stage).toBe("grab");
    expect(at("grab-won")).toMatchObject({ grabber: 4, mode: "openSolo" });
    expect(at("follow").lastPlay!.cards).toHaveLength(2);
    expect(at("jiefeng").history.at(-1)).toMatchObject({ type: "TrickWon", jiefeng: true, leader: 1 });
    expect(at("guard-revealed")).toMatchObject({ guardRevealed: true, revealReason: "played" });
    expect(sceneSnapshot("tehua").game!.players[2]!.hand).toContain(at("tehua").tehua);
    expect(at("tehua-played")).toMatchObject({ guardRevealed: true, revealReason: "tehua" });
    expect(legalCommands(at("bie6"), "p1").every((command) => command.type !== "PLAY" || command.cardIds.every((card) => !card.endsWith("S6")))).toBe(true);
    expect(at("few-cards").players.filter((player) => player.handCount <= 5).length).toBeGreaterThanOrEqual(3);
    expect(at("max-hand").players[3]!.hand).toHaveLength(38);
    expect(at("hand-end").summary!.deltas).toEqual([12, -6, 6, -6, -6]);
    expect(at("hand-end-solo").summary!.deltas).toEqual([12, -3, -3, -3, -3]);
    expect(at("game-end").finalResult!.winners).toEqual(["p0", "p1"]);
    expect(sceneSnapshot("game-end").rematch).toBeDefined();
    expect(sceneSnapshot("offline").members.find((member) => member.playerId === "p1")!.connected).toBe(false);
    expect(at("timeout").players[1]!.auto).toBe(true);
    expect(sceneSnapshot("timeout").turnRemainingMs).toBe(1200);
    expect(sceneSnapshot("spectate").game!.guard).toBeNull();
    const god = sceneSnapshot("spectate-god");
    expect(god.access.spectatorsSeeAll).toBe(true);
    expect(god.game!.guard).toBe(2);
    expect(god.game!.players.every((player) => player.hand.length > 0)).toBe(true);
  });

  it("buildDeal 按约束造完整 168 张：张数、必有的牌、不能叫的座位", () => {
    const hands = buildDeal({ dealStart: 3, must: ["H9 H9 H9", "", "皇", "", ""], noCall: [1, 4], seed: 1 });
    expect(hands.map((hand) => hand.length)).toEqual(dealSizes(3));
    expect(new Set(hands.flat()).size).toBe(168);
    expect(hands[0]!.filter((card) => card.endsWith("H9"))).toHaveLength(3);
    expect(hands[2]).toContain("0JB");
  });

  it("createScene 能按参数造任意局面：短手牌、指定盘数和累计分、步骤；toSnapshot 指定视角", () => {
    const state = createScene({
      names: ["甲", "乙", "丙", "丁", "戊"],
      bots: [4],
      handNo: 2,
      scores: [3, -3, 0, 0, 0],
      options: { tehua: true },
      deal: ["皇 H9 H9 H9 S6", "S7", "H9 S8", "S9", "S10"],
      steps: ["0 ascend", "0 call H9 pair", "1 declare 造反", "2 declare 暗保", "3 declare 不造反", "4 declare 不造反"],
    });
    expect(state.handNo).toBe(2);
    expect(state.players.map((player) => player.name)).toEqual(["甲", "乙", "丙", "丁", "戊"]);
    expect(state.players.map((player) => player.bot)).toEqual([false, false, false, false, true]);
    expect(state.stage).toBe("playing");
    expect(state.rebelFailed).toBe(1);
    expect(state.tehua).not.toBeNull();
    const snapshot = toSnapshot(state, { viewer: 2, offline: [3], remainingMs: 5000 });
    expect(snapshot.members.map((member) => member.playerId)).toEqual(["p0", "p1", "p2", "p3"]);
    expect(snapshot.members[3]!.connected).toBe(false);
    expect(snapshot.game!.guard).toBe(2);
    expect(snapshot.turnRemainingMs).toBe(5000);
    // 局面一定是规则能走到的：接着还能照常打。
    const next = applyCommand(state, "p0", { type: "PLAY", cardIds: ["0S6"] });
    expect(next.turn).toBe(1);
  });
});
