/**
 * 预览页（开发时打开 /preview.html）：用规则包的预览局面工厂造局面，渲染真正的牌桌 / 等候房间，不用真打一局去等。
 *
 * 参数：
 *   ?s=场景名（规则包的 SCENE_NAMES，加上下面 ROOM_SCENES 里的等候房间）
 *   &v=从哪个座位看（0–4，-1 = 观战；默认按场景）
 *   &t=倒计时毫秒（空 = 不显示）
 *   &err=文字（操作条上的出错提示，比如非法操作）
 *   &from=场景名（先显示这个场景，0.8 秒后换成 s，用来看登基、叫保亮牌、揭开侍卫这些动画）
 *   &chat=1（聊天里放几条示例消息）
 *   &pick=牌 id,牌 id（预先选中的手牌，只在轮到自己出牌时有用）
 *   &auto=1（自己在托管中，看托管横幅和「取消托管」）
 *   &tut=again（等候房间的新手教程入口：学过以后的小按钮；默认是第一次来的邀请卡）
 *   &nav=0（不显示底下的场景导航，截图用）
 *
 * 界面阶段维护；教程和验收要加场景就往 ROOM_SCENES 或规则包的 scenes.ts 里加，不要删别人的。生产构建只打包 index.html。
 */
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { DEFAULT_ROOM_ACCESS, scene, SCENE_NAMES, sceneSnapshot, type LobbyRoomSnapshot } from "@baohuang/game";
import { Brand, ConnectionStatus, RoomView } from "./App.js";
import { useConfirm } from "./confirm.js";
import GameBoard from "./GameBoard.js";
import RoomChat from "./RoomChat.js";
import { socket } from "./socket.js";
import { applyTheme, readTheme, ThemeToggle, useTheme } from "./theme.js";
import { TutorialInvite } from "./tutorial/Invite.js";
import { useVoice } from "./voice.js";
import "./styles.css";
import "./app-pixel.css";
import "./home.css";
import "./baohuang.css";
import "./theme-day.css";

applyTheme(readTheme());

/** 等候房间的局面。 */
const ROOM_SCENES: Record<string, { title: string; members: { name: string; connected?: boolean }[]; viewer?: number }> = {
  "room-1": { title: "等候房间：只有房主一个人（开局时 4 个人机补位）", members: [{ name: "阿宝" }] },
  "room-3": { title: "等候房间：3 个真人（2 个人机补位），我是客人", members: [{ name: "阿宝" }, { name: "小翠" }, { name: "老张", connected: false }], viewer: 1 },
  "room-full": { title: "等候房间：5 个真人坐满", members: [{ name: "阿宝" }, { name: "小翠" }, { name: "老张" }, { name: "Momo" }, { name: "七七" }] },
};

const params = new URLSearchParams(window.location.search);
const ALL = [...SCENE_NAMES, ...Object.keys(ROOM_SCENES)];
const requested = params.get("s") ?? "playing";
const name = ALL.includes(requested) ? requested : "playing";
const timer = params.get("t");
const showNav = params.get("nav") !== "0";

const SAMPLE_CHAT = [
  { id: "c1", senderId: "sock-1", name: "阿福", message: "谁拿着第 4 张红桃 9？", createdAt: new Date().toISOString() },
  { id: "c2", senderId: "sock-0", name: "我", message: "反正不是我", createdAt: new Date().toISOString() },
  { id: "c3", senderId: "sock-spectator", name: "看客", message: "皇帝牌好硬", createdAt: new Date().toISOString(), spectator: true },
];

function sceneTitle(key: string): string {
  if (key in ROOM_SCENES) return ROOM_SCENES[key]!.title;
  try {
    return scene(key).note;
  } catch {
    return key;
  }
}

function gameRoom(key: string): LobbyRoomSnapshot {
  const viewerParam = params.get("v");
  const room: LobbyRoomSnapshot & { members: LobbyRoomSnapshot["members"] } = sceneSnapshot(key, {
    ...(viewerParam !== null ? { viewer: Number(viewerParam) } : {}),
    ...(timer !== null && timer !== "" ? { remainingMs: Number(timer) } : {}),
  });
  const viewer = viewerParam !== null ? Number(viewerParam) : scene(key).viewer;
  // 从人机的座位看（比如 max-hand 的皇帝）：预览里把这个座位当成真人，免得变成观战。
  if (viewer >= 0 && !room.members.some((member) => member.id === `sock-${viewer}`)) {
    const player = room.game!.players[viewer]!;
    room.members.push({ id: `sock-${viewer}`, playerId: player.id, name: player.name, isHost: false, connected: true });
    room.game!.players[viewer] = { ...player, bot: false };
  }
  Object.defineProperty(socket, "id", { value: viewer >= 0 ? `sock-${viewer}` : "sock-spectator", configurable: true });
  if (params.get("auto") === "1" && viewer >= 0) room.game!.players[viewer] = { ...room.game!.players[viewer]!, auto: true };
  const withTimer: LobbyRoomSnapshot = timer === "" ? (({ turnRemainingMs: _drop, ...rest }) => rest)(room) : room;
  return params.get("chat") === "1" ? { ...withTimer, chat: SAMPLE_CHAT } : withTimer;
}

function waitingRoom(key: string): LobbyRoomSnapshot {
  const spec = ROOM_SCENES[key]!;
  const me = spec.viewer ?? 0;
  Object.defineProperty(socket, "id", { value: `sock-${me}`, configurable: true });
  return {
    code: "K7Q2TX",
    options: { hands: 5, grabSolo: false, bie6: false, rebel: true, tieCard: true, tehua: false },
    status: "waiting",
    members: spec.members.map((member, index) => ({ id: `sock-${index}`, playerId: `p${index}`, name: member.name, isHost: index === 0, connected: member.connected ?? true })),
    spectators: [],
    access: DEFAULT_ROOM_ACCESS,
    chat: params.get("chat") === "1" ? SAMPLE_CHAT : [],
    voice: [],
  };
}

function Nav() {
  if (!showNav) return null;
  return (
    <nav style={{ position: "fixed", zIndex: 2000, left: 0, right: 0, bottom: 0, display: "flex", flexWrap: "wrap", gap: 8, padding: "4px 8px", fontSize: 12, background: "rgba(5,10,11,.85)" }}>
      {ALL.map((key) => (
        <a key={key} href={`?s=${key}`} title={sceneTitle(key)} style={{ color: key === name ? "#f0c050" : "#a7b6a0" }}>{key}</a>
      ))}
      <span style={{ color: "#f1ece0" }}>· {sceneTitle(name)}</span>
    </nav>
  );
}

function PreviewGame() {
  const [theme, toggleTheme] = useTheme();
  const [, confirmDialog] = useConfirm();
  const from = params.get("from");
  const [room, setRoom] = useState(() => gameRoom(from && ALL.includes(from) ? from : name));
  useEffect(() => {
    if (!from) return;
    const timerId = window.setTimeout(() => {
      // 动画看的是 version 变没变：目标局面的 version 比来源大
      const next = gameRoom(name);
      setRoom({ ...next, game: { ...next.game!, version: Math.max(next.game!.version, room.game!.version + 1) } });
    }, 800);
    return () => window.clearTimeout(timerId);
  }, []);
  const voice = useVoice(null);
  return (
    <main className="app-shell bh-game">
      <GameBoard
        room={room}
        busy={false}
        error={params.get("err") ?? ""}
        notice=""
        brand={<Brand />}
        connection={<ConnectionStatus connected />}
        themeToggle={<ThemeToggle theme={theme} onToggle={toggleTheme} />}
        theme={theme}
        chat={<RoomChat room={room} voice={voice} />}
        onCommand={(command) => console.log("command", command)}
        onRematch={() => {}}
        onDissolve={() => {}}
        watchId={room.game!.players[0]!.id}
        onWatch={() => {}}
        onLeave={() => {}}
      />
      {confirmDialog}
      <Nav />
    </main>
  );
}

function PreviewRoom() {
  const [theme, toggleTheme] = useTheme();
  const room = waitingRoom(name);
  const voice = useVoice(null);
  return (
    <main className="app-shell bh-room">
      <header className="topbar">
        <Brand />
        <div className="topbar-right">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <ConnectionStatus connected />
        </div>
      </header>
      <RoomView room={room} busy={false} error="" notice="" onCopyCode={() => {}} onLeave={() => {}} onStart={() => {}} onKick={() => {}} onDissolve={() => {}} chat={<RoomChat room={room} voice={voice} />} tutorial={<TutorialInvite record={params.get("tut") === "again" ? "done" : null} title="等人的时候，先学一下？" text="咕噜嘎带你在真牌桌上走一盘，3 分钟。不会离开房间，房主一开局就自动回来。" again="新手教程（不离开房间）" onOpen={() => {}} />} />
      <Nav />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{name in ROOM_SCENES ? <PreviewRoom /> : <PreviewGame />}</React.StrictMode>,
);
