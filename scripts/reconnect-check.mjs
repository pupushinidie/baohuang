// 断线重连检查（本地联调用）：建房开局 → 断开 → 确认对局继续（离线 3 秒后人机代打）→ 用原昵称和房间码回来，座位和手牌还在。
// 用法：node scripts/reconnect-check.mjs（BOT_URL 默认 http://localhost:3020）
import { io } from "socket.io-client";
const URL = process.env.BOT_URL ?? "http://localhost:3020";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const connect = () => new Promise((resolve) => { const s = io(URL, { transports: ["websocket"], reconnection: false }); s.once("connect", () => resolve(s)); });
const call = (s, event, ...args) => new Promise((resolve) => s.emit(event, ...args, resolve));
const first = await connect();
const created = await call(first, "room:create", { name: "重连测试", options: { hands: 3 } });
const code = created.data.code;
let latest = null;
first.on("room:updated", (room) => { latest = room; });
await call(first, "room:start");
await sleep(1500);
const before = latest.game;
const me = latest.members[0].playerId;
console.log("开局", code, "version", before.version, "阶段", before.stage);
first.disconnect();
await sleep(8000);
const second = await connect();
const joined = await call(second, "room:join", { name: "重连测试", code });
const after = joined.data.game;
const seat = after.players.findIndex((p) => p.id === me);
console.log("重连", joined.ok, "同一座位", joined.data.members[0].playerId === me, "version", before.version, "→", after.version, "阶段", after.stage, "手牌", after.players[seat].hand.length, "张数", after.players[seat].handCount, "别人的手牌可见", after.players.filter((p, i) => i !== seat && p.hand.length > 0).length);
await call(second, "room:dissolve");
second.disconnect();
process.exit(0);
