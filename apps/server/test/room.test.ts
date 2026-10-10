/**
 * 房间流程：一个真人开局空座补人机、打完整场、再来一局；超时自动处理和托管；离线人机代打、原昵称回座。
 * 保密相关（同时表态只推本人、保密延迟、观战视角）在 secrecy.test.ts。
 */
process.env.BOT_DELAY_SCALE = "0";
process.env.TURN_MS = "250";
process.env.OFFLINE_TURN_MS = "100";
process.env.REMATCH_TIMEOUT_MS = "60000";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { botCommand, createScene, legalCommands } from "@baohuang/game";
import { command, create, delay, join, myId, rotate, seatOf, start, startServer, updateWhere, type Harness, type TestSocket } from "./util.js";

let harness: Harness;
let nameSeq = 0;
const nick = (prefix: string) => `${prefix}${(nameSeq += 1)}`;

beforeAll(async () => {
  harness = await startServer();
});
afterAll(async () => {
  await harness.close();
});

/** 让这个连接像陪玩脚本一样自己打（用占位人机的决定，只看自己能看到的状态）。返回停止函数。 */
function autoplay(client: TestSocket): () => void {
  let acting = false;
  let stopped = false;
  const tick = async () => {
    if (acting || stopped) return;
    const room = harness.latest.get(client);
    const game = room?.game;
    if (!room || !game || game.phase !== "playing" || room.queued) return;
    const me = myId(harness, client);
    if (legalCommands(game, me).length === 0) return;
    acting = true;
    const seat = game.players.findIndex((player) => player.id === me);
    await command(client, botCommand(game, seat));
    acting = false;
    void tick();
  };
  client.on("room:updated", () => void tick());
  void tick();
  return () => {
    stopped = true;
  };
}

describe("房间流程", () => {
  it("一个真人就能开：空座开局自动补 4 个人机（咕噜一号–四号，带人机标记），打完 3 盘，再来一局", async () => {
    const host = await harness.connect();
    const room = await create(host, nick("房主"), { hands: 3 });
    expect(room.options).toEqual({ hands: 3, grabSolo: false, bie6: false, rebel: true, tieCard: false, tehua: false });
    const started = await start(host);
    const game = started.game!;
    expect(game.players).toHaveLength(5);
    expect(game.players.filter((player) => player.bot).map((player) => player.name).sort()).toEqual(["咕噜一号", "咕噜三号", "咕噜二号", "咕噜四号"].sort());
    expect(started.members).toHaveLength(1);
    const stop = autoplay(host);
    const finished = await updateWhere(harness, host, (snapshot) => snapshot.game?.phase === "finished", 60_000);
    stop();
    expect(finished.game!.handNo).toBe(3);
    expect(finished.game!.finalResult!.winners.length).toBeGreaterThan(0);
    expect(finished.game!.players.reduce((sum, player) => sum + player.score, 0)).toBe(0);
    expect(finished.rematch).toBeDefined();
    // 再来一局。
    const restarted = updateWhere(harness, host, (snapshot) => snapshot.game?.phase === "playing" && snapshot.game.handNo === 1);
    await new Promise<void>((resolve) => host.emit("room:rematch", true, () => resolve()));
    expect((await restarted).game!.players).toHaveLength(5);
  }, 90_000);

  it("超时：真人不动，每一步都自动处理（让位、表态、出牌……），连续 2 次超时进托管，可以取消托管", async () => {
    const host = await harness.connect();
    await create(host, nick("挂机"), { hands: 3 });
    await start(host);
    const auto = await updateWhere(harness, host, (snapshot) => snapshot.game!.players.find((player) => player.id === myId(harness, host))!.auto, 30_000);
    expect(auto.game!.history.some((event) => event.type === "AutoChanged" && event.on)).toBe(true);
    const response = await command(host, { type: "AUTO", on: false });
    expect(response.ok).toBe(true);
    const seat = seatOf(harness, host);
    expect(response.ok && response.data.game!.players[seat]!.auto).toBe(false);
  }, 40_000);

  it("离线的人 3 秒后（测试里 0.1 秒）由人机代打，用原昵称和房间码回来能回到原座位", async () => {
    const host = await harness.connect();
    const guestName = nick("客人");
    const room = await create(host, nick("房主"));
    const guest = await harness.connect();
    expect((await join(guest, { name: guestName, code: room.code })).ok).toBe(true);
    await start(host);
    await updateWhere(harness, guest, (snapshot) => snapshot.game !== undefined);
    const seat = seatOf(harness, guest);
    const guestId = myId(harness, guest);
    // 换成「轮到客人出牌」的局面：客人是皇帝，第一手由他出。
    const scene = createScene({
      deal: rotate(["皇 H9 H9 H9 S6 S7 S8", "S9 S10", "H9 SJ", "SQ SK", "SA D6"], seat),
      steps: [`${seat} ascend`, `${seat} call H9 pair`, "timeout"],
    });
    harness.server.testHooks.loadScene(room.code, scene);
    const before = await updateWhere(harness, host, (snapshot) => snapshot.game!.stage === "playing" && snapshot.game!.turn === seat);
    guest.disconnect();
    const moved = await updateWhere(harness, host, (snapshot) => snapshot.game!.version > before.game!.version && snapshot.game!.table[seat] !== null, 5_000);
    expect(moved.members.find((member) => member.playerId === guestId)!.connected).toBe(false);
    expect(moved.game!.players[seat]!.handCount).toBeLessThan(7);
    // 回来：同一个座位、手牌还在。
    const back = await harness.connect();
    const rejoined = await join(back, { name: guestName, code: room.code });
    expect(rejoined.ok).toBe(true);
    if (!rejoined.ok) return;
    expect(rejoined.data.members.find((member) => member.id === back.id)!.playerId).toBe(guestId);
    expect(rejoined.data.game!.players[seat]!.hand.length).toBe(rejoined.data.game!.players[seat]!.handCount);
    expect(rejoined.data.game!.players[seat]!.hand.length).toBeGreaterThan(0);
  }, 20_000);

});
