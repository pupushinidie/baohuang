/**
 * 服务器测试共用的小工具：连接、建房、加入、发操作、等某次房间更新。
 * 环境变量（BOT_DELAY_SCALE、TURN_MS……）要在各测试文件里、导入服务器之前设好。
 */
import { AddressInfo } from "node:net";
import { io as createClient, type Socket } from "socket.io-client";
import type { AckResponse, ClientToServerEvents, CreateRoomPayload, GameCommand, GameState, JoinRoomPayload, LobbyRoomSnapshot, ServerToClientEvents } from "@baohuang/game";

export type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type ServerModule = typeof import("../src/index.js");

export interface Harness {
  readonly server: ServerModule;
  readonly url: string;
  readonly latest: Map<TestSocket, LobbyRoomSnapshot>;
  /** 每个连接收到的所有 room:updated（按顺序）。 */
  readonly received: Map<TestSocket, LobbyRoomSnapshot[]>;
  connect(): Promise<TestSocket>;
  close(): Promise<void>;
}

export async function startServer(): Promise<Harness> {
  const server = await import("../src/index.js");
  await new Promise<void>((resolve, reject) => {
    server.httpServer.once("error", reject);
    server.httpServer.listen(0, resolve);
  });
  const url = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  const clients = new Set<TestSocket>();
  const latest = new Map<TestSocket, LobbyRoomSnapshot>();
  const received = new Map<TestSocket, LobbyRoomSnapshot[]>();
  return {
    server,
    url,
    latest,
    received,
    connect: () =>
      new Promise((resolve, reject) => {
        const client: TestSocket = createClient(url, { transports: ["websocket"], reconnection: false });
        clients.add(client);
        received.set(client, []);
        client.on("room:updated", (room) => {
          latest.set(client, room);
          received.get(client)!.push(room);
        });
        client.once("connect", () => resolve(client));
        client.once("connect_error", reject);
      }),
    close: async () => {
      for (const client of clients) client.disconnect();
      await new Promise<void>((resolve) => server.io.close(() => resolve()));
    },
  };
}

export function call<T>(send: (ack: (response: AckResponse<T>) => void) => void): Promise<AckResponse<T>> {
  return new Promise((resolve) => send(resolve));
}

export async function create(client: TestSocket, name: string, options: CreateRoomPayload["options"] = {}): Promise<LobbyRoomSnapshot> {
  const response = await call<LobbyRoomSnapshot>((ack) => client.emit("room:create", { name, options: options ?? {} }, ack));
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

export async function join(client: TestSocket, payload: JoinRoomPayload): Promise<AckResponse<LobbyRoomSnapshot>> {
  return call<LobbyRoomSnapshot>((ack) => client.emit("room:join", payload, ack));
}

export async function start(client: TestSocket): Promise<LobbyRoomSnapshot> {
  const response = await call<LobbyRoomSnapshot>((ack) => client.emit("room:start", ack));
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

export function command(client: TestSocket, value: GameCommand): Promise<AckResponse<LobbyRoomSnapshot>> {
  return call<LobbyRoomSnapshot>((ack) => client.emit("game:command", value, ack));
}

/** 等到满足条件的那次房间更新（已经满足就直接返回）。条件里读不到的字段（比如还没开局时的 game）算不满足。 */
export function updateWhere(harness: Harness, client: TestSocket, check: (room: LobbyRoomSnapshot) => boolean, timeoutMs = 20_000): Promise<LobbyRoomSnapshot> {
  const test = (room: LobbyRoomSnapshot) => {
    try {
      return check(room);
    } catch {
      return false;
    }
  };
  return new Promise((resolve, reject) => {
    const current = harness.latest.get(client);
    if (current && test(current)) {
      resolve(current);
      return;
    }
    const timer = setTimeout(() => {
      client.off("room:updated", handler);
      reject(new Error("等不到想要的房间更新"));
    }, timeoutMs);
    const handler = (room: LobbyRoomSnapshot) => {
      if (!test(room)) return;
      clearTimeout(timer);
      client.off("room:updated", handler);
      resolve(room);
    };
    client.on("room:updated", handler);
  });
}

export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 这个连接在对局里的座位号。 */
export function seatOf(harness: Harness, client: TestSocket): number {
  const room = harness.latest.get(client)!;
  const playerId = room.members.find((member) => member.id === client.id)?.playerId;
  return room.game ? room.game.players.findIndex((player) => player.id === playerId) : -1;
}

export function myId(harness: Harness, client: TestSocket): string {
  return harness.latest.get(client)!.members.find((member) => member.id === client.id)!.playerId;
}

/** 5 手牌整体转一下：原来座位 0 的牌给座位 shift。 */
export function rotate<T>(hands: readonly T[], shift: number): T[] {
  return hands.map((_, seat) => hands[(seat - shift + hands.length * 2) % hands.length]!);
}

export type { GameState };
