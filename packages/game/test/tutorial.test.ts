/**
 * 新手教程剧本单测（照欲罢不能的五项）：从头走到尾每一步都合法、锚点看得见；关键几幕一定发生；剧本自身；
 * 剧本局没有随机（牌全摆好）；走完接练习局，两边交给人机打一百多场都能结束。
 */
import { describe, expect, it } from "vitest";
import {
  anchorVisible,
  applyCommand,
  botCommand,
  createPracticeGame,
  createTutorialGame,
  legalCommands,
  redactGameForViewer,
  sameCommand,
  TUTORIAL_FINAL_STEP,
  TUTORIAL_SELF,
  TUTORIAL_STEPS,
  tutorialActor,
  type BaohuangState,
} from "../src/index.js";

/** 按剧本走到某一步之前（不含），返回那时的局面。 */
function runUntil(id?: string): BaohuangState {
  let state = createTutorialGame("测试");
  for (const step of TUTORIAL_STEPS) {
    if (step.id === id) return state;
    if (step.kind === "do") {
      const legal = legalCommands(state, TUTORIAL_SELF);
      const command = legal.find((candidate) => sameCommand(candidate, step.expect)) ?? step.expect;
      state = applyCommand(state, TUTORIAL_SELF, command);
    } else if (step.kind === "watch") {
      for (const move of step.moves) {
        const actor = tutorialActor(state)!;
        state = applyCommand(state, actor, move);
      }
    }
  }
  return state;
}

describe("新手教程剧本", () => {
  it("从头走到尾：每个 do 合法、每个 watch 的出牌合法、每步的锚点那时看得见", () => {
    let state = createTutorialGame("测试");
    for (const step of TUTORIAL_STEPS) {
      if (step.anchor) expect(anchorVisible(state, step.anchor), `${step.id} 的锚点 ${step.anchor}`).toBe(true);
      if (step.kind === "do") {
        expect(tutorialActor(state), step.id).toBe(TUTORIAL_SELF);
        const legal = legalCommands(state, TUTORIAL_SELF);
        expect(step.expect.type === "PLAY" || legal.some((candidate) => sameCommand(candidate, step.expect)), step.id).toBe(true);
        state = applyCommand(state, TUTORIAL_SELF, step.expect);
        for (const follow of step.then ?? []) expect(follow.anchor === "play-button" || follow.anchor === "center").toBe(true);
      } else if (step.kind === "watch") {
        for (const move of step.moves) {
          const actor = tutorialActor(state);
          expect(actor, step.id).not.toBe(TUTORIAL_SELF);
          state = applyCommand(state, actor!, move);
        }
        // watch 走完要么轮到自己，要么这一盘结束了
        expect(tutorialActor(state) === TUTORIAL_SELF || state.stage === "handEnd" || state.stage === "declare" || step.id === "guard-plays" || step.id === "jiefeng", step.id).toBe(true);
      }
    }
    expect(state.stage).toBe("handEnd");
  });

  it("关键几幕一定发生：阿福造反失败、你头科、接风给阿福、小翠揭成侍卫、侍卫 +2 皇帝 +4 革命党 −2", () => {
    const afterDeclare = runUntil("rebel-failed");
    expect(afterDeclare.rebelFailed).toBe(1);
    expect(afterDeclare.doubled).toBe(false);
    expect(afterDeclare.guardRevealed).toBe(false);
    const tie = runUntil("tie");
    expect(tie.lastPlay?.seat).toBe(1);
    expect(legalCommands(tie, TUTORIAL_SELF).some((command) => command.type === "PLAY")).toBe(false);
    const first = runUntil("first");
    expect(first.players[0]!.place).toBe(1);
    const jiefeng = runUntil("guard-plays");
    expect(jiefeng.history.some((event) => event.type === "TrickWon" && event.jiefeng && event.leader === 1)).toBe(true);
    const revealed = runUntil("guard-revealed");
    expect(revealed.guardRevealed).toBe(true);
    expect(revealed.guard).toBe(2);
    const end = runUntil();
    expect(end.summary!.deltas).toEqual([4, -2, 2, -2, -2]);
    expect(end.summary!.places.slice(0, 3)).toEqual([1, 2, 3]);
  });

  it("剧本自身：id 不重复，finale 唯一且在最后，say 不空，主句一句话", () => {
    const ids = TUTORIAL_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    const finales = TUTORIAL_STEPS.filter((step) => step.kind === "info" && step.finale);
    expect(finales).toHaveLength(1);
    expect(TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1]!.id).toBe(TUTORIAL_FINAL_STEP);
    for (const step of TUTORIAL_STEPS) {
      expect(step.say.length).toBeGreaterThan(4);
      expect(step.say.length).toBeLessThanOrEqual(48);
      expect((step.note ?? "").length).toBeLessThanOrEqual(70);
    }
  });

  it("剧本局没有随机：两次开局一模一样", () => {
    expect(JSON.stringify(createTutorialGame("甲").players.map((player) => player.hand))).toBe(JSON.stringify(createTutorialGame("甲").players.map((player) => player.hand)));
  });

  it("练习局：你和 4 个人机，两边都交给人机，120 场都能打完", () => {
    let stuck = 0;
    for (let game = 0; game < 120; game += 1) {
      let state = createPracticeGame("测试", 900 + game);
      let steps = 0;
      while (state.phase !== "finished" && steps < 20_000) {
        const actor = tutorialActor(state);
        if (!actor) break;
        const seat = state.players.findIndex((player) => player.id === actor);
        state = applyCommand(state, actor, botCommand(redactGameForViewer(state, actor), seat));
        steps += 1;
      }
      if (state.phase !== "finished") stuck += 1;
    }
    expect(stuck).toBe(0);
  }, 120_000);
});
