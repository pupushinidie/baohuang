#!/usr/bin/env node
/**
 * 抓包脚本：两个「真人」连上一台真实的保皇服务器（本地 dev 服务或服务器上的 localhost:3020），
 * 建房、加入、开局，按占位人机打完一整场，把服务器发给每个人的每一条 room:updated 和回执都记下来，
 * 检查里面有没有不该看到的东西：
 *   - 种子、随机数状态、操作记录、超时名单（seed / rng / log / timedOut）；
 *   - 别人的手牌、别人的抢独选择、公布前别人的表态；
 *   - 没揭开的侍卫是谁、没揭开的暗独；
 *   - 另一个人这个版本手里的牌 id 出现在我收到的数据里（亮出的保牌、贴牌、特画本来就公开，不算）；
 *   - 暗独没揭开时打出了没亮的那张保牌。
 * 先 npm run build:game（脚本读规则包的 dist）。
 *
 * 用法：
 *   node scripts/spy.mjs [--hands=3] [--grab] [--bie6] [--norebel] [--tie] [--tehua]
 * 环境变量：BOT_URL（默认 http://localhost:3020）、BOT_PATH（默认 /socket.io）。
 * 服务器的保密延迟是真的（让位 2–6 秒、表态 1–3 秒），打一场要几分钟；本地可以用
 *   BOT_DELAY_SCALE=0.1 TURN_MS=3000 PORT=3120 npx tsx apps/server/src/index.ts
 * 另起一个快的服务，再 BOT_URL=http://localhost:3120 node scripts/spy.mjs。
 * 退出码：0 干净，1 有泄露，2 没打完。
 */
import { io } from "socket.io-client";
import { botCommand, kindKey, kindOf, legalCommands } from "@baohuang/game";

const URL = process.env.BOT_URL ?? "http://localhost:3020";
const PATH = process.env.BOT_PATH ?? "/socket.io";
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const hands = Number(args.find((arg) => arg.startsWith("--hands="))?.split("=")[1] ?? 3);
const options = { hands, grabSolo: flag("grab"), bie6: flag("bie6"), rebel: !flag("norebel"), tieCard: flag("tie"), tehua: flag("tehua") };

const connect = () =>
  new Promise((resolve, reject) => {
    const socket = io(URL, { path: PATH, transports: ["websocket"], reconnection: false });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
const call = (socket, event, ...rest) => new Promise((resolve) => socket.emit(event, ...rest, resolve));

function player(socket, name) {
  const state = { socket, name, received: [], latest: null, acting: false, id: "" };
  socket.on("room:updated", (room) => {
    state.received.push(room);
    state.latest = room;
    state.id = room.members.find((member) => member.id === socket.id)?.playerId ?? state.id;
    void act(state);
  });
  return state;
}

async function act(state) {
  const room = state.latest;
  const game = room?.game;
  if (state.acting || !game || game.phase !== "playing" || room.queued) return;
  if (legalCommands(game, state.id).length === 0) return;
  state.acting = true;
  const seat = game.players.findIndex((p) => p.id === state.id);
  const response = await call(state.socket, "game:command", botCommand(game, seat));
  if (response.ok) {
    state.received.push(response.data);
    state.latest = response.data;
  }
  state.acting = false;
  void act(state);
}

function inspect(mine, meId, theirs, theirId) {
  const problems = [];
  const theirHands = new Map();
  for (const snapshot of theirs) {
    const game = snapshot.game;
    if (!game) continue;
    const seat = game.players.findIndex((p) => p.id === theirId);
    theirHands.set(game.version, game.players[seat].hand);
  }
  for (const snapshot of mine) {
    const game = snapshot.game;
    if (!game) continue;
    const handStart = game.history.map((event) => event.type).lastIndexOf("HandStarted");
    const history = handStart >= 0 ? game.history.slice(handStart) : game.history;
    const json = JSON.stringify({ ...snapshot, game: { ...game, history } });
    const me = game.players.findIndex((p) => p.id === meId);
    const open = game.stage === "handEnd" || game.phase === "finished";
    for (const key of ["seed", "rng", "log", "timedOut"]) if (key in game) problems.push(`v${game.version} 带了 ${key}`);
    game.players.forEach((p, seat) => {
      if (seat === me) return;
      if (!open && p.hand.length > 0) problems.push(`v${game.version} 看到了座位 ${seat} 的手牌`);
      if (p.grab !== null) problems.push(`v${game.version} 看到了座位 ${seat} 的抢独选择`);
      if (!open && p.declare !== null) problems.push(`v${game.version} 看到了座位 ${seat} 的表态`);
    });
    if (!open && !game.guardRevealed) {
      if (game.guard !== null && game.guard !== me) problems.push(`v${game.version} 看到了侍卫是谁`);
      if (game.mode === "darkSolo" && game.emperor !== me) problems.push(`v${game.version} 看到了暗独`);
    }
    const hand = theirHands.get(game.version);
    if (hand && !open) {
      const tied = history.flatMap((event) => (event.type === "Abdicated" || event.type === "Forced" ? event.carried : []));
      const publicCards = new Set([...game.shownCards, ...game.tiePile, ...tied, ...(game.tehua ? [game.tehua] : [])]);
      for (const card of hand) if (!publicCards.has(card) && json.includes(`"${card}"`)) problems.push(`v${game.version} 里出现了别人手里的 ${card}`);
    }
    if (game.guardCard && !game.guardRevealed && !open) {
      const kind = kindKey(game.guardCard.suit, game.guardCard.rank);
      if (game.played.some((card) => kindOf(card) === kind && !game.shownCards.includes(card) && card !== game.tehua)) problems.push(`v${game.version} 打出的牌里有没亮的保牌`);
    }
  }
  return problems;
}

const a = player(await connect(), "抓包甲");
const b = player(await connect(), "抓包乙");
const created = await call(a.socket, "room:create", { name: a.name, options });
if (!created.ok) {
  console.error("建房失败：", created.error);
  process.exit(2);
}
a.received.push(created.data);
a.latest = created.data;
a.id = "p1";
const code = created.data.code;
const joined = await call(b.socket, "room:join", { name: b.name, code });
if (!joined.ok) {
  console.error("加入失败：", joined.error);
  process.exit(2);
}
b.received.push(joined.data);
b.latest = joined.data;
b.id = joined.data.members.find((member) => member.id === b.socket.id).playerId;
console.log(`房间 ${code}，选项`, JSON.stringify(options));
const started = await call(a.socket, "room:start");
if (!started.ok) {
  console.error("开局失败：", started.error);
  process.exit(2);
}
void act(a);
void act(b);

const deadline = Date.now() + Number(process.env.SPY_TIMEOUT_MS ?? 30 * 60_000);
while (Date.now() < deadline && !(a.latest?.game?.phase === "finished" && b.latest?.game?.phase === "finished")) {
  await new Promise((resolve) => setTimeout(resolve, 500));
}
const finished = a.latest?.game?.phase === "finished";
const problems = [...inspect(b.received, b.id, a.received, a.id).map((p) => `乙：${p}`), ...inspect(a.received, a.id, b.received, b.id).map((p) => `甲：${p}`)];
console.log(`甲收到 ${a.received.length} 条，乙收到 ${b.received.length} 条；${finished ? `打完 ${a.latest.game.handNo} 盘` : "没打完"}`);
if (problems.length > 0) {
  console.log(`发现 ${problems.length} 处泄露，前 20 条：`);
  for (const problem of problems.slice(0, 20)) console.log("  " + problem);
}
else console.log("干净：没有发现不该看到的东西。");
call(a.socket, "room:dissolve").then(() => {
  a.socket.disconnect();
  b.socket.disconnect();
  process.exit(problems.length > 0 ? 1 : finished ? 0 : 2);
});
