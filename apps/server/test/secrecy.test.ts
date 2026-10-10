/**
 * 保密设定（勘误 K6、开工拍板的联机设定）：
 * - 表态：一个人选了只推给他自己（别人连「有人选了」都看不到），倒计时对所有人一样，选完一起公布；
 *   真人的提交随机延迟 1–3 秒才生效（这里按 BOT_DELAY_SCALE=0.05 缩成 50–150 毫秒），期间 queued 只发给自己；
 * - 登基：不能登基的真人由服务器随机等 2–6 秒（缩成 100–300 毫秒）替他让位，不算超时；人机也等同样的时间；
 * - 观战：默认看不到侍卫和手牌，房主打开「看手牌」后是上帝视角。
 */
process.env.BOT_DELAY_SCALE = "0.05";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDeal, createScene, type LobbyRoomSnapshot } from "@baohuang/game";
import { command, create, delay, join, seatOf, start, startServer, updateWhere, type Harness, type TestSocket } from "./util.js";

let harness: Harness;
let nameSeq = 0;
const nick = (prefix: string) => `${prefix}${(nameSeq += 1)}`;

beforeAll(async () => {
  harness = await startServer();
});
afterAll(async () => {
  await harness.close();
});

/** 5 个真人坐满开局，返回房间码和按座位排好的连接。 */
async function fullRoom(): Promise<{ code: string; bySeat: Map<number, TestSocket>; players: TestSocket[] }> {
  const host = await harness.connect();
  const room = await create(host, nick("房主"));
  const players = [host];
  for (let k = 0; k < 4; k += 1) {
    const client = await harness.connect();
    expect((await join(client, { name: nick("玩家"), code: room.code })).ok).toBe(true);
    players.push(client);
  }
  await start(host);
  for (const client of players) await updateWhere(harness, client, (snapshot) => snapshot.game !== undefined);
  return { code: room.code, players, bySeat: new Map(players.map((client) => [seatOf(harness, client), client] as const)) };
}

describe("保密设定", () => {
  it("表态：一个人选了只推给他自己，提交随机延迟后才生效（queued 只给自己）；倒计时一样；选完一起公布", async () => {
    const { code, players, bySeat } = await fullRoom();
    // 皇帝在座位 0、侍卫在座位 2，到表态阶段。
    harness.server.testHooks.loadScene(code, createScene({ deal: ["皇 H9 H9 H9 S6", "S7 S8", "H9 S9", "S10 SJ", "SQ SK"], steps: ["0 ascend", "0 call H9 pair"] }));
    for (const client of players) await updateWhere(harness, client, (snapshot) => snapshot.game!.stage === "declare");
    const remaining = players.map((client) => harness.latest.get(client)!.turnRemainingMs!);
    expect(Math.max(...remaining) - Math.min(...remaining)).toBeLessThan(200);
    const counts = new Map(players.map((client) => [client, harness.received.get(client)!.length] as const));
    const guard = bySeat.get(2)!;
    const sent = Date.now();
    const ack = await command(guard, { type: "DECLARE", choice: "darkGuard" });
    expect(ack.ok).toBe(true);
    if (!ack.ok) return;
    expect(ack.data.queued).toEqual({ type: "DECLARE", choice: "darkGuard" });
    expect(ack.data.game!.players[2]!.declare).toBeNull();
    // 提交还在延迟里，再点不行。
    expect((await command(guard, { type: "DECLARE", choice: "openGuard" })).ok).toBe(false);
    const applied = await updateWhere(harness, guard, (snapshot) => snapshot.game!.players[2]!.declare === "darkGuard");
    const waited = Date.now() - sent;
    expect(waited).toBeGreaterThanOrEqual(40);
    expect(waited).toBeLessThan(600);
    expect(applied.queued).toBeUndefined();
    await delay(50);
    for (const client of players) {
      const got = harness.received.get(client)!.slice(counts.get(client)!);
      if (client === guard) expect(got.length).toBeGreaterThanOrEqual(1);
      else expect(got).toEqual([]);
    }
    for (const seat of [1, 3, 4]) expect((await command(bySeat.get(seat)!, { type: "DECLARE", choice: seat === 1 ? "rebel" : "noRebel" })).ok).toBe(true);
    for (const client of players) {
      const revealed = await updateWhere(harness, client, (snapshot: LobbyRoomSnapshot) => snapshot.game!.declaresRevealed);
      expect(revealed.game!.rebelFailed).toBe(1);
      expect(revealed.game!.players.map((player) => player.declarePublic)).toEqual([null, "rebel", "noRebel", "noRebel", "noRebel"]);
      if (client !== guard) expect(revealed.game!.guard).toBeNull();
      // 别人从来没收到过「谁已经选了」。
      for (const snapshot of harness.received.get(client)!) {
        if (client === guard || !snapshot.game || snapshot.game.declaresRevealed) continue;
        snapshot.game.players.forEach((player, seat) => {
          if (seat !== seatOf(harness, client)) expect(player.declare).toBeNull();
        });
      }
    }
  }, 20_000);

  it("不能登基的真人：服务器随机等一会儿（2–6 秒 × 0.05）替他让位，不算超时，事件里看不出是自动的", async () => {
    const { code, players } = await fullRoom();
    harness.server.testHooks.loadScene(code, createScene({ deal: buildDeal({ dealStart: 0, must: ["皇", "", "", "", ""], noCall: [0], seed: 5 }) }));
    const host = players[0]!;
    const loaded = await updateWhere(harness, host, (snapshot) => snapshot.game!.stage === "abdicate" && snapshot.game!.abdications.length === 0 && snapshot.game!.turn === 0);
    const at = Date.now();
    const moved = await updateWhere(harness, host, (snapshot) => snapshot.game!.abdications.length === 1, 3_000);
    const waited = Date.now() - at;
    expect(waited).toBeGreaterThanOrEqual(80);
    expect(waited).toBeLessThan(800);
    expect(moved.game!.players[0]!.timeouts).toBe(0);
    expect(moved.game!.events.find((event) => event.type === "Abdicated")).toEqual({ type: "Abdicated", from: 0, to: 4, count: 1, tie: null, carried: [] });
    expect(loaded.game!.version).toBeLessThan(moved.game!.version);
  }, 20_000);

  it("人机拿到皇牌也等同样的随机时间再决定（不会秒让 / 秒登基）", async () => {
    const host = await harness.connect();
    const room = await create(host, nick("房主"));
    const started = await start(host);
    const botSeat = started.game!.players.findIndex((player) => player.bot);
    const must = ["", "", "", "", ""];
    must[botSeat] = "皇";
    harness.server.testHooks.loadScene(room.code, createScene({ deal: buildDeal({ dealStart: 0, must, seed: 6 }) }));
    await updateWhere(harness, host, (snapshot) => snapshot.game?.stage === "abdicate" && snapshot.game.turn === botSeat && snapshot.game.abdications.length === 0);
    const at = Date.now();
    await updateWhere(harness, host, (snapshot) => snapshot.game!.stage !== "abdicate" || snapshot.game!.abdications.length > 0, 3_000);
    expect(Date.now() - at).toBeGreaterThanOrEqual(80);
  }, 20_000);

  it("观战：默认看不到侍卫和手牌；房主打开「看手牌」后是上帝视角（种子照样不发）", async () => {
    const host = await harness.connect();
    const room = await create(host, nick("房主"));
    const viewer = await harness.connect();
    expect((await join(viewer, { name: nick("看客"), code: room.code, spectate: true })).ok).toBe(true);
    await start(host);
    harness.server.testHooks.loadScene(room.code, createScene({ deal: ["皇 H9 H9 H9 S6", "S7 S8", "H9 S9", "S10 SJ", "SQ SK"], steps: ["0 ascend", "0 call H9 pair"] }));
    const blind = await updateWhere(harness, viewer, (snapshot) => snapshot.game?.stage === "declare");
    expect(blind.game!.guard).toBeNull();
    expect(blind.game!.players.every((player) => player.hand.length === 0)).toBe(true);
    host.emit("room:access", { spectatorsSeeAll: true }, () => undefined);
    const god = await updateWhere(harness, viewer, (snapshot) => snapshot.access.spectatorsSeeAll);
    expect(god.game!.guard).toBe(2);
    expect(god.game!.players.every((player) => player.hand.length > 0)).toBe(true);
    for (const key of ["seed", "rng", "log", "timedOut"]) expect(key in god.game!).toBe(false);
  }, 20_000);
});
