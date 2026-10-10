/**
 * 抓包：两个真人连上真实的服务器打完一整场（3 盘，贴牌、特画、抢独都打开），把服务器发给每个人的
 * 每一条 room:updated 和回执都记下来，检查里面没有别人的手牌、种子、没揭开的侍卫和暗独、别人的抢独 / 表态。
 * 同样的检查也有命令行版：scripts/spy.mjs（连本地或服务器上的真实服务）。
 */
process.env.BOT_DELAY_SCALE = "0";
process.env.TURN_MS = "400";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { botCommand, kindKey, kindOf, legalCommands, type LobbyRoomSnapshot } from "@baohuang/game";
import { command, create, join, myId, start, startServer, updateWhere, type Harness, type TestSocket } from "./util.js";

let harness: Harness;
beforeAll(async () => {
  harness = await startServer();
});
afterAll(async () => {
  await harness.close();
});

/** 自己按占位人机打（只看自己能看到的状态）；回执也记进 received。 */
function autoplay(client: TestSocket): () => void {
  let acting = false;
  let stopped = false;
  const tick = async () => {
    if (acting || stopped) return;
    const room = harness.latest.get(client);
    const game = room?.game;
    if (!room || !game || game.phase !== "playing") return;
    const me = myId(harness, client);
    if (legalCommands(game, me).length === 0) return;
    acting = true;
    const response = await command(client, botCommand(game, game.players.findIndex((player) => player.id === me)));
    if (response.ok) harness.received.get(client)!.push(response.data);
    acting = false;
    void tick();
  };
  client.on("room:updated", () => void tick());
  void tick();
  return () => {
    stopped = true;
  };
}

/** 检查一个人收到的全部数据；other 是另一个真人的快照（拿他每个版本的手牌做对照）。 */
function inspect(mine: readonly LobbyRoomSnapshot[], meId: string, theirs: readonly LobbyRoomSnapshot[], theirId: string): string[] {
  const problems: string[] = [];
  const theirHands = new Map<number, string[]>();
  for (const snapshot of theirs) {
    const game = snapshot.game;
    if (!game) continue;
    const seat = game.players.findIndex((player) => player.id === theirId);
    theirHands.set(game.version, game.players[seat]!.hand);
  }
  for (const snapshot of mine) {
    const game = snapshot.game;
    if (!game) continue;
    // 牌 id 每盘都会重用：只看这一盘的历史（上一盘的结算里本来就公开了所有牌）。
    const handStart = game.history.map((event) => event.type).lastIndexOf("HandStarted");
    const history = handStart >= 0 ? game.history.slice(handStart) : game.history;
    const json = JSON.stringify({ ...snapshot, game: { ...game, history } });
    const me = game.players.findIndex((player) => player.id === meId);
    const open = game.stage === "handEnd" || game.phase === "finished";
    for (const key of ["seed", "rng", "log", "timedOut"]) if (key in game) problems.push(`v${game.version} 带了 ${key}`);
    game.players.forEach((player, seat) => {
      if (seat === me) return;
      if (!open && player.hand.length > 0) problems.push(`v${game.version} 看到了座位 ${seat} 的手牌`);
      if (player.grab !== null) problems.push(`v${game.version} 看到了座位 ${seat} 的抢独选择`);
      if (!open && player.declare !== null) problems.push(`v${game.version} 看到了座位 ${seat} 的表态`);
    });
    if (!open && !game.guardRevealed) {
      if (game.guard !== null && game.guard !== me) problems.push(`v${game.version} 看到了侍卫是谁`);
      if (game.mode === "darkSolo" && game.emperor !== me) problems.push(`v${game.version} 看到了暗独`);
    }
    // 另一个人这个版本手里的牌 id，不能出现在我收到的任何地方（亮出的保牌、贴牌、特画本来就公开，不算）。
    const hand = theirHands.get(game.version);
    if (hand && !open) {
      // 贴牌是正面公开传的（补充 4.1 第 4 条），进了皇帝手里以后，事件里照样看得到。
      const tied = history.flatMap((event) => (event.type === "Abdicated" || event.type === "Forced" ? event.carried : []));
      const publicCards = new Set([...game.shownCards, ...game.tiePile, ...tied, ...(game.tehua ? [game.tehua] : [])]);
      for (const card of hand) if (!publicCards.has(card) && json.includes(`"${card}"`)) problems.push(`v${game.version} 里出现了别人手里的 ${card}`);
    }
    // 暗独没揭开：打出的牌里没有没亮的那张保牌。
    if (game.guardCard && !game.guardRevealed && !open) {
      const kind = kindKey(game.guardCard.suit, game.guardCard.rank);
      if (game.played.some((card) => kindOf(card) === kind && !game.shownCards.includes(card) && card !== game.tehua)) problems.push(`v${game.version} 打出的牌里有没亮的保牌`);
    }
  }
  return problems;
}

describe("抓包：发给别人的数据里没有不该看到的", () => {
  it("两个真人 + 3 个人机打完一整场（贴牌、特画、抢独打开）：双方收到的每条数据都干净", async () => {
    const a = await harness.connect();
    const room = await create(a, "甲方", { hands: 3, tieCard: true, tehua: true, grabSolo: true });
    const b = await harness.connect();
    expect((await join(b, { name: "乙方", code: room.code })).ok).toBe(true);
    await start(a);
    await updateWhere(harness, b, (snapshot) => snapshot.game !== undefined);
    const stops = [autoplay(a), autoplay(b)];
    await updateWhere(harness, a, (snapshot) => snapshot.game?.phase === "finished", 90_000);
    await updateWhere(harness, b, (snapshot) => snapshot.game?.phase === "finished", 10_000);
    stops.forEach((stop) => stop());
    const aId = myId(harness, a);
    const bId = myId(harness, b);
    const fromA = harness.received.get(a)!;
    const fromB = harness.received.get(b)!;
    expect(fromA.length).toBeGreaterThan(100);
    expect(fromB.length).toBeGreaterThan(100);
    expect(inspect(fromB, bId, fromA, aId)).toEqual([]);
    expect(inspect(fromA, aId, fromB, bId)).toEqual([]);
  }, 120_000);
});
