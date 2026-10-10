/**
 * 每种操作都能经过服务器生效：抢独、登基、让位、叫保（二打三 / 暗独 / 明独）、表态（明保 / 暗保 / 造反 / 不造反）、
 * 出牌、过牌、下一盘、托管开关。5 个座位都是真人（测试脚本），用 loadScene 摆好局面再一个个发操作。
 */
process.env.BOT_DELAY_SCALE = "0";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScene, type GameCommand, type LobbyRoomSnapshot } from "@baohuang/game";
import { command, create, join, seatOf, start, startServer, updateWhere, type Harness, type TestSocket } from "./util.js";

let harness: Harness;
let code = "";
let bySeat = new Map<number, TestSocket>();
let host: TestSocket;

beforeAll(async () => {
  harness = await startServer();
  host = await harness.connect();
  const room = await create(host, "房主甲", { grabSolo: true, hands: 3 });
  code = room.code;
  const players = [host];
  for (const name of ["玩家乙", "玩家丙", "玩家丁", "玩家戊"]) {
    const client = await harness.connect();
    expect((await join(client, { name, code })).ok).toBe(true);
    players.push(client);
  }
  await start(host);
  for (const client of players) await updateWhere(harness, client, (snapshot) => snapshot.game !== undefined);
  bySeat = new Map(players.map((client) => [seatOf(harness, client), client] as const));
});
afterAll(async () => {
  await harness.close();
});

async function send(seat: number, value: GameCommand): Promise<LobbyRoomSnapshot> {
  const response = await command(bySeat.get(seat)!, value);
  if (!response.ok) throw new Error(`座位 ${seat} ${value.type}：${response.error}`);
  return response.data;
}
const latest = () => harness.latest.get(host)!;
const until = (test: (room: LobbyRoomSnapshot) => boolean) => updateWhere(harness, host, test);

describe("每种操作都能经过服务器", () => {
  it("抢独：1 按了、其他人不抢 → 1 抢成明独", async () => {
    harness.server.testHooks.loadScene(code, createScene({ options: { grabSolo: true, hands: 3 }, deal: ["皇 S6", "S7", "S8", "S9", "S10"] }));
    await until((room) => room.game!.stage === "grab" && room.game!.huangHolder === 0);
    await send(1, { type: "GRAB", grab: true });
    for (const seat of [0, 2, 3, 4]) await send(seat, { type: "GRAB", grab: false });
    const room = await until((snapshot) => snapshot.game!.grabber !== null);
    expect(room.game).toMatchObject({ grabber: 1, emperor: 1, mode: "openSolo", stage: "playing" });
  });

  it("让位、登基、叫保暗独、表态造反 → 独保被揭开", async () => {
    harness.server.testHooks.loadScene(code, createScene({ options: { hands: 3 }, deal: ["皇 C6 C6 C6", "S7", "S8", "S9", "H9 H9 H9 H9 S10"] }));
    await until((room) => room.game!.stage === "abdicate" && room.game!.turn === 0 && room.game!.abdications.length === 0);
    await send(0, { type: "ABDICATE" });
    await until((room) => room.game!.turn === 4);
    await send(4, { type: "ASCEND" });
    await until((room) => room.game!.stage === "call");
    await send(4, { type: "CALL", suit: "H", rank: 9, mode: "darkSolo" });
    await until((room) => room.game!.stage === "declare");
    expect(latest().game!.mode).toBe("pair");
    await send(0, { type: "DECLARE", choice: "rebel" });
    await send(1, { type: "DECLARE", choice: "rebel" });
    await send(2, { type: "DECLARE", choice: "noRebel" });
    await send(3, { type: "DECLARE", choice: "noRebel" });
    const room = await until((snapshot) => snapshot.game!.declaresRevealed);
    expect(room.game).toMatchObject({ mode: "darkSolo", guardRevealed: true, doubled: true, stage: "playing", turn: 4 });
  });

  it("二打三明保、出牌、过牌、打完一盘、下一盘", async () => {
    harness.server.testHooks.loadScene(code, createScene({ options: { hands: 3 }, deal: ["皇 H9 H9 H9 S6", "S7 S8 S9", "H9 SK", "DQ DJ D10", "CA C10 C8"], steps: ["0 ascend"] }));
    await until((room) => room.game!.stage === "call" && room.game!.emperor === 0);
    await send(0, { type: "CALL", suit: "H", rank: 9, mode: "pair" });
    await until((room) => room.game!.stage === "declare");
    await send(2, { type: "DECLARE", choice: "openGuard" });
    for (const seat of [1, 3, 4]) await send(seat, { type: "DECLARE", choice: "noRebel" });
    await until((room) => room.game!.stage === "playing");
    const plays: [number, GameCommand][] = [
      [0, { type: "PLAY", cardIds: ["0S6"] }],
      [1, { type: "PLAY", cardIds: ["0S8"] }],
      [2, { type: "PLAY", cardIds: ["0SK"] }],
      [3, { type: "PASS" }],
      [4, { type: "PLAY", cardIds: ["0CA"] }],
      [0, { type: "PLAY", cardIds: ["0JB"] }],
      [1, { type: "PASS" }],
      [2, { type: "PASS" }],
      [3, { type: "PASS" }],
      [4, { type: "PASS" }],
      [0, { type: "PLAY", cardIds: ["0H9", "1H9", "2H9"] }],
      [1, { type: "PASS" }],
      [2, { type: "PASS" }],
      [3, { type: "PASS" }],
      [4, { type: "PASS" }],
      [1, { type: "PLAY", cardIds: ["0S7"] }],
      [2, { type: "PLAY", cardIds: ["3H9"] }],
    ];
    for (const [seat, value] of plays) await send(seat, value);
    const ended = await until((room) => room.game!.stage === "handEnd");
    expect(ended.game!.summary!.deltas).toEqual([12, -6, 6, -6, -6]);
    for (const seat of [0, 1, 2, 3, 4]) await send(seat, { type: "READY" });
    const next = await until((room) => room.game!.stage !== "handEnd");
    expect(next.game!.handNo).toBe(2);
    expect(next.game!.dealStart).toBe(0);
  });

  it("明独叫保；托管开关", async () => {
    harness.server.testHooks.loadScene(code, createScene({ options: { hands: 3 }, deal: ["皇 H9 H9 H9 H9", "S7", "S8", "S9", "S10"], steps: ["0 ascend"] }));
    await until((room) => room.game!.stage === "call");
    await send(0, { type: "CALL", suit: "H", rank: 9, mode: "openSolo" });
    const room = await until((snapshot) => snapshot.game!.stage === "playing");
    expect(room.game).toMatchObject({ mode: "openSolo", guardRevealed: true });
    expect((await send(3, { type: "AUTO", on: true })).game!.players[3]!.auto).toBe(true);
    expect((await send(3, { type: "AUTO", on: false })).game!.players[3]!.auto).toBe(false);
  });
});
