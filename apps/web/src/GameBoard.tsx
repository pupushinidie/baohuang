/**
 * 调试牌桌（引擎阶段写的，给联调用）：把当前状态原样列出来，每个合法操作一个按钮。
 * 正式牌桌由界面阶段（guluga-game-ui）重写，props 保持不变，App.tsx 不用改。
 */
import { useMemo, useState, type ReactNode } from "react";
import {
  cardName,
  checkPlay,
  kindName,
  legalCommands,
  rankLabel,
  setRules,
  type BaohuangEvent,
  type BaohuangState,
  type CardId,
  type GameCommand,
  type LobbyRoomSnapshot,
} from "@baohuang/game";
import { CardView } from "./cards.js";
import GameRules from "./GameRules.js";
import { GameRoomMenu, SpectateBar } from "./RoomExtras.js";
import { socket } from "./socket.js";
import { useCountdown } from "./table.js";
import type { Theme } from "./theme.js";

interface GameBoardProps {
  readonly room: LobbyRoomSnapshot;
  readonly busy: boolean;
  readonly error: string;
  readonly notice: string;
  readonly brand: ReactNode;
  readonly connection: ReactNode;
  readonly theme: Theme;
  readonly themeToggle: ReactNode;
  readonly chat: ReactNode;
  readonly onCommand: (command: GameCommand) => void;
  readonly onRematch: (accept: boolean) => void;
  readonly onDissolve: () => void;
  readonly watchId: string;
  readonly onWatch: (playerId: string) => void;
  readonly onLeave: () => void;
}

const STAGE_TEXT: Record<BaohuangState["stage"], string> = {
  grab: "抢独",
  abdicate: "登基 / 让位",
  call: "叫保",
  declare: "表态",
  playing: "出牌",
  handEnd: "一盘结算",
};
const MODE_TEXT = { pair: "二打三", darkSolo: "暗独", openSolo: "明独" } as const;
const DECLARE_TEXT = { openGuard: "明保", darkGuard: "暗保", rebel: "造反", noRebel: "不造反" } as const;

const cardsText = (cards: readonly CardId[]) => cards.map(cardName).join(" ");

export function commandLabel(command: GameCommand): string {
  switch (command.type) {
    case "GRAB":
      return command.grab ? "抢独" : "不抢";
    case "ASCEND":
      return "登基";
    case "ABDICATE":
      return "让位";
    case "CALL":
      return `叫 ${kindName(command.suit, command.rank)}${command.mode === "pair" ? "" : command.mode === "darkSolo" ? "（暗独）" : "（明独）"}`;
    case "DECLARE":
      return DECLARE_TEXT[command.choice];
    case "PLAY":
      return `出 ${cardsText(command.cardIds)}`;
    case "PASS":
      return "不要";
    case "READY":
      return "下一盘";
    case "AUTO":
      return command.on ? "托管" : "取消托管";
  }
}

export function describeEvent(event: BaohuangEvent, name: (seat: number) => string): string | null {
  switch (event.type) {
    case "HandStarted":
      return `第 ${event.handNo} 盘开始，从 ${name(event.dealStart)} 发牌`;
    case "Dealt":
      return `${event.redeal > 0 ? `重发（第 ${event.redeal} 次）` : "发牌"}：皇牌在 ${name(event.huangHolder)}`;
    case "GrabResolved":
      return event.seat === null ? "没人抢独" : `${name(event.seat)} 抢独成功（明独）`;
    case "Ascended":
      return `${name(event.seat)} ${event.forced ? "被逼位登基" : "登基"}`;
    case "Abdicated":
      return `${name(event.from)} 让位给 ${name(event.to)}${event.tie ? `，贴出 ${cardName(event.tie)}` : ""}`;
    case "Forced":
      return `逼位：皇牌交给 ${name(event.seat)}`;
    case "Redeal":
      return "没人有恰好 3 张，重新发牌";
    case "GuardCalled":
      return `${name(event.emperor)} 叫 ${kindName(event.suit, event.rank)}${event.open ? "，明独" : ""}`;
    case "DeclaresRevealed":
      return `表态公布：${event.doubled ? `×2（${event.reason === "openGuard" ? "明保" : "造反成功"}）` : event.rebelFailed !== null ? `${name(event.rebelFailed)} 造反失败` : "没人造反"}${event.guard !== null ? `，侍卫是 ${name(event.guard)}` : ""}${event.soloRevealed ? "（独保）" : ""}`;
    case "Played":
      return `${name(event.seat)} 出 ${cardsText(event.cardIds)}（剩 ${event.left}）`;
    case "Passed":
      return `${name(event.seat)} 不要`;
    case "GuardRevealed":
      return event.solo ? `${name(event.seat)} 是独保（打出了保牌）` : `${name(event.seat)} 是侍卫（打出了${event.reason === "tehua" ? "特画" : "保牌"}）`;
    case "Finished":
      return `${name(event.seat)} 走科，第 ${event.place} 名`;
    case "TrickWon":
      return event.jiefeng ? `${name(event.leader)} 接风` : `${name(event.leader)} 自由出牌`;
    case "HandEnded":
      return `第 ${event.handNo} 盘结束：${event.summary.deltas.map((delta, seat) => `${name(seat)} ${delta > 0 ? "+" : ""}${delta}`).join("，")}`;
    case "TimedOut":
      return `${name(event.seat)} 超时`;
    case "AutoChanged":
      return `${name(event.seat)} ${event.on ? "进入托管" : "取消托管"}`;
    case "GameEnded":
      return "整场结束";
  }
}

function GameBoard({ room, busy, error, notice, brand, connection, themeToggle, chat, onCommand, onRematch, onDissolve, watchId, onWatch, onLeave }: GameBoardProps) {
  const game = room.game!;
  const member = room.members.find((candidate) => candidate.id === socket.id);
  const spectating = !member;
  const meId = member?.playerId ?? watchId;
  const me = game.players.findIndex((player) => player.id === meId);
  const seconds = useCountdown(room);
  const [selected, setSelected] = useState<CardId[]>([]);
  const name = (seat: number) => game.players[seat]?.name ?? `座位 ${seat}`;
  const legal = useMemo(() => (spectating ? [] : legalCommands(game, meId)), [game, meId, spectating]);
  const plays = legal.filter((command) => command.type === "PLAY");
  const others = legal.filter((command) => command.type !== "PLAY");
  const hand = me >= 0 ? game.players[me]!.hand : [];
  const selection = selected.filter((card) => hand.includes(card));
  const selectionCheck = selection.length > 0 && game.stage === "playing" && game.turn === me ? checkPlay(hand, selection, game.lastPlay?.ranks ?? null, setRules(game)) : null;
  const send = (command: GameCommand) => {
    setSelected([]);
    onCommand(command);
  };
  const connected = (seat: number) => room.members.find((candidate) => candidate.playerId === game.players[seat]!.id)?.connected ?? true;

  return (
    <div className="bh-debug">
      <header className="topbar">
        {brand}
        <div className="topbar-right">
          <GameRoomMenu room={room} />
          {themeToggle}
          <GameRules />
          {connection}
        </div>
      </header>
      {spectating && <SpectateBar room={room} watchId={watchId} onWatch={onWatch} onLeave={onLeave} />}
      <p className="bh-debug-note">调试牌桌（引擎阶段联调用，正式牌桌由界面阶段做）</p>

      <section className="bh-debug-panel">
        <div>
          第 {game.handNo}/{game.config.hands} 盘 · {STAGE_TEXT[game.stage]} · {game.turn >= 0 ? `轮到 ${name(game.turn)}` : "同时选"}
          {seconds !== null && <> · 剩 {seconds} 秒</>}
          {game.redeals > 0 && <> · 重发 {game.redeals} 次</>}
        </div>
        <div>
          发牌起点 {name(game.dealStart)} · 皇牌在 {game.huangHolder !== null ? name(game.huangHolder) : "—"}
          {game.abdications.length > 0 && <> · 让位：{game.abdications.map(name).join(" → ")}</>}
          {game.tiePile.length > 0 && <> · 贴牌：{cardsText(game.tiePile)}</>}
        </div>
        <div>
          皇帝 {game.emperor !== null ? name(game.emperor) : "—"}{game.forced ? "（逼位）" : ""}{game.grabber !== null ? "（抢独）" : ""}
          {game.guardCard && <> · 保牌 {kindName(game.guardCard.suit, game.guardCard.rank)}（亮出 {cardsText(game.shownCards)}）</>}
          {game.mode && <> · {MODE_TEXT[game.mode]}</>}
          {game.guard !== null && <> · 侍卫 {name(game.guard)}{game.guardRevealed ? "（已公开）" : "（只有你知道）"}</>}
          {game.tehua && <> · 特画是没亮的那张</>}
          {game.doubled && <> · ×2（{game.doubleReason === "openGuard" ? "明保" : "造反成功"}）</>}
          {game.rebelFailed !== null && <> · {name(game.rebelFailed)} 造反失败</>}
        </div>
        {game.lastPlay && <div>要压：{name(game.lastPlay.seat)} 的 {cardsText(game.lastPlay.cards)}（{game.lastPlay.ranks.map(rankLabel).join(" ")}）</div>}
      </section>

      <table className="bh-debug-seats">
        <thead>
          <tr><th>座位</th><th>名字</th><th>张数</th><th>累计</th><th>本盘</th><th>名次</th><th>表态（公布）</th><th>这一轮</th></tr>
        </thead>
        <tbody>
          {game.players.map((player, seat) => (
            <tr key={player.id} className={seat === me ? "me" : ""}>
              <td>{seat}{seat === game.turn ? " ▶" : ""}</td>
              <td>
                {player.name}
                {player.bot && <small> 人机</small>}
                {player.auto && <small> 托管</small>}
                {!connected(seat) && <small> 离线</small>}
                {seat === game.emperor && <small> 皇帝</small>}
                {game.guard === seat && seat !== game.emperor && <small> 侍卫</small>}
              </td>
              <td className={player.handCount > 0 && player.handCount <= 5 ? "warn" : ""}>{player.handCount}</td>
              <td>{player.score}</td>
              <td>{game.stage === "handEnd" ? player.handDelta : ""}</td>
              <td>{player.place ?? ""}</td>
              <td>{player.declarePublic ? DECLARE_TEXT[player.declarePublic] : ""}{seat === me && player.declare ? `（你选了 ${DECLARE_TEXT[player.declare]}）` : ""}</td>
              <td>{game.table[seat] ? (game.table[seat]!.kind === "pass" ? "不要" : cardsText((game.table[seat] as { cards: CardId[] }).cards)) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {room.queued && <p className="bh-debug-note">已提交「{commandLabel(room.queued)}」，等公布……</p>}

      {me >= 0 && (
        <section className="bh-debug-hand">
          <div className="bh-debug-cards">
            {hand.map((card) => (
              <CardView
                key={card}
                card={card}
                scale={1}
                className={selection.includes(card) ? "selected" : ""}
                onClick={() => setSelected(selection.includes(card) ? selection.filter((other) => other !== card) : [...selection, card])}
              />
            ))}
          </div>
          {!spectating && game.stage === "playing" && game.turn === me && (
            <div className="bh-debug-actions">
              <button type="button" className="primary-button" disabled={busy || selection.length === 0 || typeof selectionCheck === "string"} onClick={() => send({ type: "PLAY", cardIds: selection })}>
                出选中的 {selection.length} 张
              </button>
              {typeof selectionCheck === "string" && <span className="feedback feedback-error">{selectionCheck}</span>}
            </div>
          )}
        </section>
      )}

      {!spectating && (
        <section className="bh-debug-actions">
          {others.map((command, index) => (
            <button key={index} type="button" className="quiet-button" disabled={busy} onClick={() => send(command)}>{commandLabel(command)}</button>
          ))}
          {plays.slice(0, 40).map((command, index) => (
            <button key={`p${index}`} type="button" className="quiet-button" disabled={busy} onClick={() => send(command)}>{commandLabel(command)}</button>
          ))}
          {plays.length > 40 && <span>……共 {plays.length} 种出法（点手牌自己选）</span>}
          {me >= 0 && game.players[me]!.auto && <button type="button" className="quiet-button" onClick={() => send({ type: "AUTO", on: false })}>取消托管</button>}
        </section>
      )}

      {game.stage === "handEnd" && game.summary && (
        <section className="bh-debug-panel">
          <div>
            结算：{MODE_TEXT[game.summary.mode]} · 皇帝 {name(game.summary.emperor)} · 侍卫 {name(game.summary.guard)} · ×{game.summary.multiplier}
            {game.summary.rankSum !== null && <> · 名次和 {game.summary.rankSum}，侍卫基础分 {game.summary.guardBase}</>}
          </div>
          <div>走科：{game.summary.finishOrder.map(name).join(" → ") || "—"}</div>
        </section>
      )}

      {game.phase === "finished" && game.finalResult && (
        <section className="bh-debug-panel">
          <div>整场结束，赢家：{game.finalResult.winners.map((id) => game.players.find((player) => player.id === id)!.name).join("、")}</div>
          {room.rematch && member && (
            <div className="bh-debug-actions">
              <button type="button" className="primary-button" onClick={() => onRematch(true)} disabled={room.rematch.acceptedIds.includes(socket.id ?? "")}>再来一局</button>
              <button type="button" className="quiet-button" onClick={() => onRematch(false)}>不玩了</button>
            </div>
          )}
        </section>
      )}

      <section className="bh-debug-log">
        {game.history.slice(-14).map((event, index) => {
          const text = describeEvent(event, name);
          return text ? <div key={index}>{text}</div> : null;
        })}
      </section>

      {error && <p className="feedback feedback-error" role="alert">{error}</p>}
      {notice && <p className="feedback feedback-success" role="status">{notice}</p>}
      <div className="bh-debug-actions">
        {member?.isHost && <button className="quiet-button danger" type="button" onClick={onDissolve}>解散房间</button>}
      </div>
      {chat}
    </div>
  );
}

export default GameBoard;
