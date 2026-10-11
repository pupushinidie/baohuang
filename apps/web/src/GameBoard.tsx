/**
 * 保皇牌桌。布局（见交接报告 handoff/ui.md）：
 * - 上面一行 4 个对手，从左到右是 上家、对家左、对家右、下家（出牌逆时针，自己在下方、下家在右手）；名牌下面是他这一轮出的牌；
 * - 中间条：本盘信息（盘数、保牌、倍数、皇牌在谁手里）｜自己的出牌或操作按钮｜轮到谁 + 倒计时；
 * - 下面是自己的手牌：按点数分列叠放，点一列多选一张。
 * 右边侧栏（窄屏收成抽屉）：状态、累计分、记录 / 聊天。
 * 动画只看 game.version 变没变；临时特效的计时器放在持久的表里，只在卸载时清掉。
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  botDecide,
  canAscend,
  canCallTypes,
  cardName,
  checkPlay,
  describeSet,
  isJoker,
  kindKey,
  kindName,
  kindOf,
  legalCommands,
  playOptions,
  rankLabel,
  rankOf,
  setRules,
  sortCards,
  type BaohuangEvent,
  type BaohuangPlayer,
  type BaohuangState,
  type CardId,
  type GameCommand,
  type LobbyRoomSnapshot,
} from "@baohuang/game";
import { art, coverSize, PLACE_NAMES, preloadArt, seatColor, type FxArt, type RoleArt } from "./art.js";
import { CARD_BACK, CARD_H, CARD_W, CardView } from "./cards.js";
import { denySound, selectSound, useGameSfx } from "./game-sfx.js";
import GameRules from "./GameRules.js";
import { useSfxCountdown } from "./gm-sound.js";
import { GameRoomMenu, SpectateBar } from "./RoomExtras.js";
import { socket } from "./socket.js";
import { pickLayout, useBox, useCountdown, type Layout } from "./table.js";
import type { Theme } from "./theme.js";
import { Coach, TipToast } from "./tutorial/Coach.js";
import { useFirstTimeTips } from "./tutorial/tips.js";
import { detectTips, GAME_ID, hintFor, TIPS, type Hint } from "./tutorialGame.js";

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
  /** 教程用：额外放在牌桌上的东西（教练框）。 */
  readonly overlay?: ReactNode;
  /** 自己在 room.members 里的 id（教程里是固定值），默认 socket.id。 */
  readonly selfMemberId?: string;
  /** online 真实对局；tutorial 剧本进行中（不出提示和小贴士）；practice 练习局（随时能看提示）。 */
  readonly mode?: "online" | "tutorial" | "practice";
  /** 整场结束框里替代「再来一局」的按钮（练习局放「结束教程」「再练一局」）。 */
  readonly finalActions?: ReactNode;
  /** 侧栏最上面额外放的东西（教程进度）。 */
  readonly sidePanel?: ReactNode;
  /** 选中的手牌变了（教程用来把高亮挪到「出牌」）。 */
  readonly onSelection?: (cards: readonly CardId[]) => void;
}

const DECLARE_TEXT = { openGuard: "明保", darkGuard: "暗保", rebel: "造反", noRebel: "不造反" } as const;
const MODE_TEXT = { pair: "二打三", darkSolo: "暗独", openSolo: "明独" } as const;

// ---------------------------------------------------------------------------
// 文案

export function describeEvent(event: BaohuangEvent, game: BaohuangState, name: (seat: number) => string): string | null {
  const rules = setRules(game);
  switch (event.type) {
    case "HandStarted":
      return `第 ${event.handNo} 盘开始，从 ${name(event.dealStart)} 发牌`;
    case "Dealt":
      return `${event.redeal > 0 ? `重新发牌（第 ${event.redeal} 次）` : "发牌"}：皇牌在 ${name(event.huangHolder)} 手里`;
    case "GrabResolved":
      return event.seat === null ? "没人抢独" : `${name(event.seat)} 抢独成功，一个人打四个（明独）`;
    case "Ascended":
      return `${name(event.seat)} ${event.forced ? "被逼登基" : "登基"}，当皇帝`;
    case "Abdicated":
      return `${name(event.from)} 让位，皇牌交给 ${name(event.to)}${event.tie ? `（贴出 ${cardName(event.tie)}）` : ""}`;
    case "Forced":
      return `转了一圈没人登基：逼位，${name(event.seat)} 必须当皇帝`;
    case "Redeal":
      return "没人有恰好 3 张同花同点，重新发牌";
    case "GuardCalled":
      return `${name(event.emperor)} 叫 ${kindName(event.suit, event.rank)}${event.open ? "，亮出 4 张：明独" : "，第 4 张在谁手里谁是侍卫"}`;
    case "DeclaresRevealed": {
      const parts: string[] = [];
      if (event.reason === "openGuard") parts.push(`${event.guard !== null ? name(event.guard) : "侍卫"} 明保，本盘 ×2`);
      else if (event.reason === "rebel") parts.push(event.soloRevealed ? `造反成功：皇帝是独保，本盘 ×2` : `造反成功：侍卫是 ${event.guard !== null ? name(event.guard) : "?"}，本盘 ×2`);
      else if (event.rebelFailed !== null) parts.push(`只有 ${name(event.rebelFailed)} 造反，造反失败，他是革命党`);
      else parts.push("表态公布：没人造反");
      return parts.join("；");
    }
    case "Played":
      return `${name(event.seat)} 出 ${describeSet(event.cardIds, rules)}${event.left > 0 && event.left <= 5 ? `（剩 ${event.left} 张）` : ""}`;
    case "Passed":
      return `${name(event.seat)} 不要`;
    case "GuardRevealed":
      return event.solo ? `${name(event.seat)} 打出全部 4 张保牌：是独保！` : `${name(event.seat)} 打出了${event.reason === "tehua" ? "特画" : "保牌"}：他是侍卫！`;
    case "Finished":
      return `${name(event.seat)} 出完了：${PLACE_NAMES[event.place]}`;
    case "TrickWon":
      return event.jiefeng ? `${name(event.leader)} 接风，自由出牌` : null;
    case "HandEnded":
      return `第 ${event.handNo} 盘结束：${event.summary.deltas.map((delta, seat) => `${name(seat)} ${delta > 0 ? "+" : ""}${delta}`).join("，")}`;
    case "TimedOut":
      return `${name(event.seat)} 超时，自动处理`;
    case "AutoChanged":
      return `${name(event.seat)} ${event.on ? "托管了（人机代打）" : "取消托管"}`;
    case "GameEnded":
      return `整场结束（共 ${game.config.hands} 盘）`;
  }
}

// ---------------------------------------------------------------------------
// 手牌分列

interface Column {
  readonly key: string;
  /** 列顶写的字：点数、小王、大王、特画。 */
  readonly label: string;
  /** 选牌顺序（也是从上往下的显示顺序）：保牌、特画放最后。 */
  readonly cards: CardId[];
}

function buildColumns(hand: readonly CardId[], game: BaohuangState, guardKind: string | null): Column[] {
  const rules = setRules(game);
  const columns: Column[] = [];
  const sorted = sortCards(hand).reverse();
  for (let rank = 6; rank <= 15; rank += 1) {
    const cards = sorted.filter((card) => !isJoker(card) && card !== rules.tehua && rankOf(card) === rank);
    if (cards.length === 0) continue;
    cards.sort((a, b) => Number(kindOf(a) === guardKind) - Number(kindOf(b) === guardKind));
    columns.push({ key: String(rank), label: rankLabel(rank), cards });
  }
  const small = sorted.filter((card) => isJoker(card) && rankOf(card) === 16);
  const big = sorted.filter((card) => isJoker(card) && rankOf(card) === 17).sort((a, b) => Number(a === "0JB") - Number(b === "0JB"));
  if (small.length) columns.push({ key: "S", label: "小王", cards: small });
  if (big.length) columns.push({ key: "B", label: "大王", cards: big });
  const tehua = sorted.filter((card) => card === rules.tehua);
  if (tehua.length) columns.push({ key: "T", label: "特画", cards: tehua });
  return columns;
}

// ---------------------------------------------------------------------------

interface Fx {
  readonly key: string;
  readonly seat: number;
  readonly kind: FxArt;
}

interface Banner {
  readonly text: string;
  readonly kind: "info" | "gold" | "red" | "blue";
}

function GameBoard({ room, busy, error, notice, brand, connection, theme, themeToggle, chat, onCommand, onRematch, onDissolve, watchId, onWatch, onLeave, overlay, selfMemberId, mode: boardMode = "online", finalActions, onSelection, sidePanel }: GameBoardProps) {
  const game = room.game as BaohuangState;
  const member = room.members.find((candidate) => candidate.id === (selfMemberId ?? socket.id));
  const spectating = !member;
  const myId = member?.playerId ?? watchId;
  const mySeat = Math.max(0, game.players.findIndex((player) => player.id === myId));
  const me = game.players[mySeat]!;
  const isHost = member?.isHost ?? false;
  const playing = game.phase === "playing";
  const stage = game.stage;
  const rules = setRules(game);
  const emperor = game.emperor;
  const secondsLeft = useCountdown(room);
  const relOf = (seat: number) => (seat - mySeat + 5) % 5;
  const seatAt = (rel: number) => (mySeat + rel) % 5;
  const nameOf = (seat: number) => (seat === mySeat && !spectating ? "你" : game.players[seat]?.name ?? "?");
  const online = (player: BaohuangPlayer) => player.bot || (room.members.find((candidate) => candidate.playerId === player.id)?.connected ?? false);
  const send = (command: GameCommand) => {
    if (!busy) onCommand(command);
  };
  const firstVersion = useRef(game.version);
  const fresh = game.version !== firstVersion.current;
  const shownNotice = fresh ? "" : notice;
  useEffect(() => preloadArt(), []);

  // ---------- 我是谁 ----------
  const guardKind = game.guardCard ? kindKey(game.guardCard.suit, game.guardCard.rank) : null;
  const iAmEmperor = emperor === mySeat;
  const iAmGuard = !spectating && game.guard === mySeat && !iAmEmperor;
  const legal = useMemo(() => (spectating || !playing ? [] : legalCommands(game, myId)), [game.version, myId, spectating, game.players[mySeat]?.declare, game.players[mySeat]?.grab]);
  const queued = room.queued;
  const myTurn = legal.length > 0 && !queued;
  const myPlay = myTurn && stage === "playing";
  const following = game.lastPlay !== null;
  // 动作音效（game-sfx.ts）和自己最后 5 秒的倒计时滴答
  useGameSfx(game, spectating ? null : mySeat, myTurn, queued);
  useSfxCountdown(myTurn, secondsLeft);

  // ---------- 手牌和选牌 ----------
  const hand = me.hand;
  const columns = useMemo(() => buildColumns(hand, game, iAmGuard || (iAmEmperor && game.mode === "darkSolo") ? guardKind : null), [game.version, mySeat, hand.join()]);
  const maxStack = Math.max(1, ...columns.map((column) => column.cards.length));
  const [tableRef, tableBox] = useBox();
  const [handRef, handBox] = useBox();
  const baseLayout: Layout = pickLayout(tableBox.width, tableBox.height, Math.max(columns.length, 1), maxStack);
  // 手牌区的实际高度（中间条按钮多的时候会变高）定叠牌间距；最小间距都放不下就把手牌缩小一号。
  const layout: Layout = useMemo(() => {
    const head = baseLayout.mobile ? 52 : 30;
    const room = handBox.height;
    let hs = baseLayout.hs;
    const fits = (scale: number, stack: number) => head + 8 * scale + CARD_H * scale + (maxStack - 1) * stack <= room;
    while (hs > 1 && !fits(hs, 4 * hs)) hs -= 1;
    const stack = maxStack > 1 ? Math.max(Math.min(4 * hs, 6), Math.min(20 * hs, Math.floor((room - head - 8 * hs - CARD_H * hs) / (maxStack - 1)))) : 20 * hs;
    return { ...baseLayout, hs, stack, colStep: hs === baseLayout.hs ? baseLayout.colStep : Math.round((baseLayout.colStep * hs) / baseLayout.hs) };
  }, [baseLayout.mobile, baseLayout.hs, baseLayout.ps, baseLayout.colStep, handBox.height, maxStack]);
  const { hs, ps } = layout;
  const [selected, setSelected] = useState<CardId[]>([]);
  useEffect(() => setSelected((current) => current.filter((card) => hand.includes(card))), [game.version, mySeat]);
  useEffect(() => setSelected([]), [game.handNo, stage === "playing", game.turn === mySeat]);
  const canSelect = !spectating && playing && stage === "playing" && hand.length > 0;
  useEffect(() => onSelection?.(selected), [selected.join()]);
  const selectedSet = new Set(selected);
  // 双击（手机上连点两下）= 整列选上；紧跟在双击后面的那一下点击不算（不然连点三下会把整列又清掉）
  const lastAll = useRef<{ key: string; at: number } | null>(null);
  const tapColumn = (column: Column, all = false) => {
    if (!canSelect) {
      // 还没到出牌阶段就点手牌：告诉他现在点不了
      if (!spectating && playing) denySound();
      return;
    }
    const rest = column.cards.filter((card) => !selectedSet.has(card));
    if (!all && lastAll.current && lastAll.current.key === column.key && Date.now() - lastAll.current.at < 450) return;
    if (all) lastAll.current = { key: column.key, at: Date.now() };
    selectSound(all || rest.length > 0);
    if (all) setSelected([...selected.filter((card) => !column.cards.includes(card)), ...column.cards]);
    else if (rest.length > 0) setSelected([...selected, rest[0]!]);
    else setSelected(selected.filter((card) => !column.cards.includes(card)));
  };
  const longPress = useRef<{ timer: number; done: boolean } | null>(null);
  const check = useMemo(() => {
    if (!myPlay || selected.length === 0) return null;
    return checkPlay(hand, selected, game.lastPlay?.ranks ?? null, rules);
  }, [selected.join(), game.version, myPlay]);
  const canPlay = check !== null && typeof check !== "string";
  const options = useMemo(() => (myPlay ? playOptions(hand, game.lastPlay?.ranks ?? null, rules) : []), [game.version, myPlay]);
  const noBeat = myPlay && following && options.length === 0;
  const [hintIndex, setHintIndex] = useState(0);
  const [hintReason, setHintReason] = useState("");
  useEffect(() => {
    setHintIndex(0);
    setHintReason("");
  }, [game.version]);
  // 「提示」的咕噜嘎小框：只有自己和人机时（练习局，或一个人加人机开的房间）
  const botsOnly = room.members.every((candidate) => candidate.id === member?.id);
  const canHint = !spectating && !me.auto && myTurn && (boardMode === "practice" || (boardMode === "online" && botsOnly));
  const [coachHint, setCoachHint] = useState<{ version: number; hint: Hint } | null>(null);
  const shownHint = coachHint && coachHint.version === game.version && canHint ? coachHint.hint : null;
  const askHint = () => {
    const next = hintFor(game, myId);
    if (next.command?.type === "PLAY") setSelected([...next.command.cardIds]);
    setCoachHint({ version: game.version, hint: next });
  };
  const hint = () => {
    if (!myPlay || options.length === 0) return;
    if (hintIndex === 0) {
      try {
        const decision = botDecide(game, mySeat);
        setSelected(decision.command.type === "PLAY" ? [...decision.command.cardIds] : []);
        if (canHint) setHintReason(decision.reason);
        if (canHint) setCoachHint({ version: game.version, hint: hintFor(game, myId) });
        setHintIndex(1);
        return;
      } catch {
        // 人机算不出来就按出法列表轮流给
      }
    }
    const pick = options[(hintIndex - 1 + options.length) % options.length]!;
    setSelected(pick);
    setHintReason("");
    setHintIndex(hintIndex + 1);
  };
  const play = () => {
    if (canPlay) send({ type: "PLAY", cardIds: selected });
  };
  const selectionNote = (() => {
    if (!myPlay) return "";
    if (hintReason) return `提示：${hintReason}`;
    if (selected.length === 0) {
      if (noBeat) return "没有压得住的牌，只能不要";
      return following ? `要出 ${game.lastPlay!.cards.length} 张、每张都更大的牌；点一列选一张` : "随便出一套：同点数几张，可以挂王；点一列选一张";
    }
    if (typeof check === "string") return check;
    return `出 ${describeSet(selected, rules)}`;
  })();

  // ---------- 动画：只看 version 变没变 ----------
  const timers = useRef(new Map<string, number>());
  const later = (key: string, ms: number, run: () => void) => {
    window.clearTimeout(timers.current.get(key));
    timers.current.set(key, window.setTimeout(run, ms));
  };
  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);
  const [fxList, setFxList] = useState<Fx[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [baoShow, setBaoShow] = useState<{ cards: CardId[]; open: boolean } | null>(null);
  const [settling, setSettling] = useState(false);
  useEffect(() => {
    if (!fresh) return;
    const fx: Fx[] = [];
    let next: Banner | null = null;
    game.events.forEach((event, index) => {
      const key = `${game.version}-${index}`;
      switch (event.type) {
        case "Ascended":
          fx.push({ key, seat: event.seat, kind: "crown" });
          next = { text: `${nameOf(event.seat)} ${event.forced ? "被逼登基" : "登基"}！`, kind: "gold" };
          break;
        case "Forced":
          next = { text: `逼位：${nameOf(event.seat)} 必须当皇帝`, kind: "gold" };
          break;
        case "Redeal":
          next = { text: "没人能登基，重新发牌", kind: "info" };
          break;
        case "GrabResolved":
          if (event.seat !== null) {
            fx.push({ key, seat: event.seat, kind: "solo" });
            next = { text: `${nameOf(event.seat)} 抢独！一打四`, kind: "red" };
          }
          break;
        case "GuardCalled":
          setBaoShow({ cards: event.shown, open: event.open });
          later("bao", 2200, () => setBaoShow(null));
          break;
        case "DeclaresRevealed":
          if (event.soloRevealed && emperor !== null) fx.push({ key: `${key}s`, seat: emperor, kind: "solo" });
          else if (event.guard !== null) fx.push({ key: `${key}g`, seat: event.guard, kind: "guard" });
          event.declares.forEach((choice, seat) => {
            if (choice === "rebel") fx.push({ key: `${key}r${seat}`, seat, kind: "rebel" });
          });
          next =
            event.reason === "openGuard"
              ? { text: `${event.guard !== null ? nameOf(event.guard) : "侍卫"} 明保！本盘 ×2`, kind: "blue" }
              : event.reason === "rebel"
                ? { text: event.soloRevealed ? "造反成功：皇帝是独保！×2" : `造反成功！侍卫是 ${event.guard !== null ? nameOf(event.guard) : "?"}，×2`, kind: "red" }
                : event.rebelFailed !== null
                  ? { text: `${nameOf(event.rebelFailed)} 一个人造反，失败了`, kind: "info" }
                  : { text: "没人造反，皇帝先出", kind: "info" };
          break;
        case "GuardRevealed":
          fx.push({ key, seat: event.seat, kind: event.solo ? "solo" : "guard" });
          next = { text: event.solo ? `${nameOf(event.seat)} 是独保！` : `${nameOf(event.seat)} 打出${event.reason === "tehua" ? "特画" : "保牌"}：是侍卫！`, kind: "blue" };
          break;
        case "Finished":
          next = { text: `${nameOf(event.seat)} 出完了：${PLACE_NAMES[event.place]}`, kind: "gold" };
          break;
        case "TrickWon":
          if (event.jiefeng) next = { text: `${nameOf(event.leader)} 接风`, kind: "info" };
          break;
        case "HandEnded":
          setSettling(true);
          later("settle", 1800, () => setSettling(false));
          break;
        default:
          break;
      }
    });
    if (fx.length > 0) {
      setFxList(fx);
      later("fx", 1500, () => setFxList([]));
    }
    if (next) {
      setBanner(next);
      later("banner", 2000, () => setBanner(null));
    }
  }, [game.version]);

  // ---------- 键盘 ----------
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "escape") setSelected([]);
      if (!myPlay) {
        if (key === "h" && canHint) {
          if (shownHint) setCoachHint(null);
          else askHint();
        }
        return;
      }
      if ((key === " " || key === "enter") && canPlay) {
        event.preventDefault();
        play();
      } else if (key === "p" && following) send({ type: "PASS" });
      else if (key === "h") hint();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // 在后台时标题提示轮到你
  useEffect(() => {
    const base = "保皇 · 在线对战";
    const update = () => {
      document.title = myTurn && document.hidden ? `【轮到你】${base}` : base;
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      document.title = base;
    };
  }, [myTurn, game.version]);

  // ---------- 记录、侧栏 ----------
  const log = useMemo(() => {
    const lines: { key: string; text: string }[] = [];
    game.history.forEach((event, index) => {
      const text = describeEvent(event, game, nameOf);
      if (text) lines.push({ key: `${game.version}-${index}`, text });
    });
    return lines.reverse();
  }, [game.version, mySeat]);
  const tips = useFirstTimeTips(GAME_ID, game.version, () => detectTips(game, myId), TIPS, boardMode === "online" && !spectating);
  const [sideTab, setSideTab] = useState<"log" | "chat">("log");
  const [chatSeen, setChatSeen] = useState(room.chat.length);
  useEffect(() => {
    if (sideTab === "chat") setChatSeen(room.chat.length);
  }, [sideTab, room.chat.length]);
  const unread = sideTab === "chat" ? 0 : Math.max(0, room.chat.length - chatSeen);
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const [hideSummary, setHideSummary] = useState(false);
  useEffect(() => setHideSummary(false), [game.handNo, stage]);

  // ---------- 身份（只用这个座位看得到的信息） ----------
  const soloPublic = game.mode === "openSolo" || (game.guardRevealed && game.guard === emperor) || (stage === "handEnd" && game.summary?.mode !== "pair");
  const rolesOf = (seat: number): RoleArt[] => {
    const list: RoleArt[] = [];
    const player = game.players[seat]!;
    if (seat === emperor) {
      list.push("emperor");
      if (soloPublic || (seat === mySeat && !spectating && game.mode === "darkSolo")) list.push("solo");
      return list;
    }
    if (emperor === null) return list;
    if (game.guard === seat && (game.guardRevealed || stage === "handEnd" || seat === mySeat)) list.push("guard");
    else if (player.declarePublic === "rebel" || (stage === "handEnd" && game.summary && game.summary.guard !== seat)) list.push("rebel");
    return list;
  };
  const roleWord = (seat: number): string | null => {
    if (seat === emperor) return soloPublic ? "独保" : seat === mySeat && game.mode === "darkSolo" && !spectating ? "暗独" : "皇帝";
    if (emperor === null) return null;
    if (game.guard === seat && seat !== emperor) {
      if (game.guardRevealed || stage === "handEnd") return "侍卫";
      if (seat === mySeat && !spectating) return "侍卫·只有你知道";
    }
    if (game.players[seat]!.declarePublic === "rebel") return "造反";
    return null;
  };

  // ---------- 现在该谁做什么 ----------
  const declared = me.declare !== null || queued?.type === "DECLARE";
  const grabbed = me.grab !== null || queued?.type === "GRAB";
  let headline = "";
  let detail = "";
  if (game.phase === "finished") headline = "整场结束";
  else if (stage === "grab") {
    headline = spectating ? "抢独：大家在选" : grabbed ? "已选，等其他人" : "要抢独吗？";
    detail = "抢独 = 一个人打四个（明独），拿头科 +24，否则 −24。看不到别人按没按。";
  } else if (stage === "abdicate") {
    const holder = game.huangHolder ?? 0;
    if (holder === mySeat && !spectating) {
      headline = canAscend(hand) ? "你拿到了皇牌：登基还是让位？" : "你没有能叫的牌，只能让位";
      detail = canAscend(hand) ? "登基要亮出 3 张同花色同点数的牌；让位就把皇牌交给上家（左手边）。" : "几秒后自动让位（别人看不出你是不能登基）。";
    } else {
      headline = `${nameOf(holder)} 拿着皇牌，在想登基还是让位`;
      detail = game.abdications.length > 0 ? `已经让位：${game.abdications.map(nameOf).join(" → ")}` : "拿皇牌的人可以登基当皇帝，也可以让给上家。";
    }
  } else if (stage === "call") {
    headline = iAmEmperor && !spectating ? "你是皇帝：选一种牌叫保" : `${nameOf(emperor ?? 0)} 当上皇帝，正在叫保`;
    detail = iAmEmperor && !spectating ? "亮出 3 张同花色同点数的牌，第 4 张在谁手里谁就是侍卫（连你也不知道是谁）。" : "皇帝亮出 3 张同花色同点数的牌，拿着第 4 张的人是侍卫。";
  } else if (stage === "declare") {
    if (spectating || iAmEmperor) headline = "等 4 个人表态";
    else if (declared) headline = "已选，等其他人";
    else headline = iAmGuard ? "你是侍卫！明保还是暗保？" : "造反还是不造反？";
    detail = iAmGuard && !declared ? "明保：公开身份，本盘 ×2。暗保：继续藏着，革命党不知道该打谁。" : "4 个人同时选，选完一起公布；2 人以上造反就成功（×2、揭出侍卫），只有 1 人造反算失败。";
  } else if (stage === "playing") {
    const top = game.lastPlay;
    headline = myPlay ? (following ? "轮到你：压上一手，或者不要" : "轮到你出牌") : `${nameOf(game.turn)} 出牌中`;
    detail = top ? `桌上最大：${nameOf(top.seat)} 的 ${describeSet(top.cards, rules)}` : `${nameOf(game.turn)} 自由出牌，随便出一套`;
  } else if (stage === "handEnd") {
    headline = `第 ${game.handNo} 盘结算`;
    detail = spectating ? `等玩家点「下一盘」（${game.ready.length}/5）` : game.ready.includes(myId) ? `等其他人（${game.ready.length}/5）` : "看完结算点「下一盘」";
  }
  const timerShown = secondsLeft !== null && playing && room.turnRemainingMs !== undefined;

  // ---------- 名牌 ----------
  const fxAt = (seat: number) =>
    fxList
      .filter((item) => item.seat === seat)
      .map((item) => <span key={item.key} className={`bh-fx bh-fx-${item.kind}`} style={{ backgroundImage: `url(${art.fx(item.kind)})` }} aria-hidden="true" />);
  const plate = (seat: number, mine = false) => {
    const player = game.players[seat]!;
    const rel = relOf(seat);
    const active = playing && (stage === "abdicate" || stage === "call" || stage === "playing") && game.turn === seat;
    const roles = rolesOf(seat);
    const word = roleWord(seat);
    const low = stage === "playing" && player.handCount > 0 && player.handCount <= 5;
    const huangHere = stage === "abdicate" && game.huangHolder === seat;
    const abdicated = stage === "abdicate" && game.abdications.includes(seat);
    const declaredPublic = player.declarePublic === "openGuard" ? "明保" : player.declarePublic === "rebel" ? "造反" : null;
    const done = player.place !== null;
    return (
      <div
        className={["bh-plate", mine ? "mine" : `r${rel}`, active ? "active" : "", seat === emperor ? "emperor" : "", done ? "done" : "", roles.length > 0 ? "has-role" : ""].join(" ")}
        style={{ "--seat": seatColor(seat) } as CSSProperties}
        data-tutorial={mine ? "my-plate" : `seat-${rel}`}
      >
        {seat === emperor && <img className="bh-crest" src={art.crest} alt="" />}
        <div className="bh-avatar-box">
          <img className="bh-avatar" src={art.avatar(seat)} alt="" />
          {huangHere && <span className="bh-huang-mini" title="皇牌在他手里"><CardView card="0JB" scale={1} /></span>}
        </div>
        <div className="bh-plate-info">
          <strong title={player.name}>{nameOf(seat)}</strong>
          <span className="bh-plate-line">
            <span className="bh-score" title="累计分"><b>{player.score}</b><small>分</small></span>
            {!mine && stage !== "handEnd" && (
              <span className={low ? "bh-count low" : "bh-count"} title={`还剩 ${player.handCount} 张`}>
                <b>{player.handCount}</b>
                <small>张</small>
              </span>
            )}
            {done && <img className="bh-place" src={art.rank(player.place!)} alt={PLACE_NAMES[player.place!]} title={PLACE_NAMES[player.place!]} />}
          </span>
          <span className="bh-tags">
            {word && <em className={`bh-chip role ${word.startsWith("侍卫") ? "guard" : word === "造反" ? "rebel" : "gold"}`}>{word}</em>}
            {declaredPublic && word !== "造反" && <em className="bh-chip">{declaredPublic}</em>}
            {abdicated && <em className="bh-chip">让位</em>}
            {player.bot && <em className="bh-chip">人机</em>}
            {!player.bot && player.auto && <em className="bh-chip warn">托管</em>}
            {!online(player) && <em className="bh-chip bad">离线</em>}
          </span>
        </div>
        {roles.length > 0 && (
          <span className="bh-roles">
            {roles.map((role) => <img key={role} src={art.role(role)} alt={role} title={role === "emperor" ? "皇帝" : role === "guard" ? "侍卫" : role === "solo" ? "独保" : "革命党"} />)}
          </span>
        )}
        {active && timerShown && !mine && <span className={secondsLeft! <= 5 ? "bh-clock low" : "bh-clock"}>{secondsLeft}</span>}
        {fxAt(seat)}
      </div>
    );
  };

  /** 一个座位这一轮出的牌（或「不要」）。 */
  const playSlot = (seat: number, maxWidth: number) => {
    const entry = game.table[seat];
    if (!(stage === "playing" || stage === "handEnd") || !entry) return <div className="bh-play empty" />;
    const anchorName = `play-${relOf(seat)}`;
    if (entry.kind === "pass") return <div className="bh-play" data-tutorial={anchorName}><span className="bh-pass">不要</span></div>;
    const top = game.lastPlay?.seat === seat;
    const n = entry.cards.length;
    const w = CARD_W * ps;
    const step = n > 1 ? Math.max(4, Math.min(Math.round(w * 0.45), Math.floor((maxWidth - w) / (n - 1)))) : w;
    return (
      <div className={top ? "bh-play top" : "bh-play"} data-tutorial={anchorName}>
        <span className="bh-play-cards" key={`${game.handNo}-${entry.cards.join(".")}`}>
          {entry.cards.map((card, index) => (
            <span key={card} className="bh-pcard" style={index > 0 ? { marginLeft: step - w } : undefined}>
              <CardView card={card} scale={ps} />
              {card === rules.tehua && <img className="bh-mark" src={art.markTehua} alt="特" />}
            </span>
          ))}
        </span>
        <small className="bh-play-label">{describeSet(entry.cards, rules)}</small>
      </div>
    );
  };

  // ---------- 本盘信息 ----------
  const guardTag = game.guardCard ? (
    <div className="bh-guard-tag" data-tutorial="guard-card" title={`保牌：${kindName(game.guardCard.suit, game.guardCard.rank)}`}>
      <span className="bh-tag-frame" style={{ backgroundImage: `url(${art.baoTag})` }}>
        <CardView card={game.shownCards[0] ?? CARD_BACK} scale={1} />
      </span>
      <span className="bh-info-text">
        <small>保牌</small>
        <b>{kindName(game.guardCard.suit, game.guardCard.rank)}</b>
      </span>
    </div>
  ) : null;
  const modeText = game.mode ? (soloPublic ? MODE_TEXT[game.mode] : iAmEmperor && game.mode === "darkSolo" && !spectating ? "暗独（只有你知道）" : "二打三") : null;
  const info = (
    <div className="bh-info" data-tutorial="hand-info">
      <div className="bh-info-row">
        <small>第</small>
        <b>{game.handNo}</b>
        <small>/ {game.config.hands} 盘</small>
        {game.redeals > 0 && <small className="bh-muted">重发 {game.redeals} 次</small>}
      </div>
      {guardTag}
      {modeText && (
        <div className="bh-info-row" data-tutorial="multiplier">
          <b className={game.doubled ? "bh-multi hot" : "bh-multi"}>×{game.doubled ? 2 : 1}</b>
          <small>{modeText}{game.doubled ? ` · ${game.doubleReason === "openGuard" ? "明保" : "造反成功"}` : ""}</small>
        </div>
      )}
      {stage === "abdicate" && game.huangHolder !== null && (
        <div className="bh-info-row">
          <small>皇牌在</small>
          <b className="bh-who">{nameOf(game.huangHolder)}</b>
        </div>
      )}
      {stage === "grab" && <div className="bh-info-row"><small>抢独中</small></div>}
      {game.tiePile.length > 0 && stage === "abdicate" && (
        <div className="bh-tie" title="贴牌：跟着皇牌走，正面公开">
          <small>贴牌</small>
          {game.tiePile.map((card) => <CardView key={card} card={card} scale={1} />)}
        </div>
      )}
    </div>
  );

  // ---------- 操作条 ----------
  const button = (label: ReactNode, onClick: () => void, primary: boolean, tutorial: string, extra = "", disabled = false) => (
    <button key={tutorial} className={`${primary ? "primary-button" : "quiet-button"} bh-act ${extra}`} type="button" disabled={busy || disabled} onClick={onClick} data-tutorial={tutorial}>
      {label}
    </button>
  );
  const hintButton = canHint && stage !== "playing" ? button("提示", () => (shownHint ? setCoachHint(null) : askHint()), false, "hint-button", "small") : null;
  const actionBar = (() => {
    if (spectating || !playing) return null;
    if (queued && (stage === "grab" || stage === "declare")) {
      return <div className="bh-actions"><span className="bh-wait">已选 {queued.type === "DECLARE" ? DECLARE_TEXT[queued.choice] : queued.type === "GRAB" ? (queued.grab ? "抢独" : "不抢") : ""}，等待公布</span></div>;
    }
    if (!myTurn) return null;
    switch (stage) {
      case "grab":
        return (
          <div className="bh-actions">
            {button("不抢", () => send({ type: "GRAB", grab: false }), false, "nograb-button")}
            {button("抢独 ±24", () => send({ type: "GRAB", grab: true }), true, "grab-button", "hot")}
            {hintButton}
          </div>
        );
      case "abdicate":
        return (
          <div className="bh-actions">
            {button("让位", () => send({ type: "ABDICATE" }), !canAscend(hand), "abdicate-button")}
            {canAscend(hand) && button("登基", () => send({ type: "ASCEND" }), true, "ascend-button", "hot")}
            {hintButton}
          </div>
        );
      case "call":
        return (
          <div className="bh-actions wrap" data-tutorial="call-buttons">
            {canCallTypes(hand).flatMap((type) =>
              type.count === 3
                ? [button(`叫 ${kindName(type.suit, type.rank)}`, () => send({ type: "CALL", suit: type.suit, rank: type.rank, mode: "pair" }), true, `call-${type.suit}${type.rank}`)]
                : [
                    button(`暗独 ${kindName(type.suit, type.rank)}`, () => send({ type: "CALL", suit: type.suit, rank: type.rank, mode: "darkSolo" }), false, `dark-${type.suit}${type.rank}`),
                    button(`明独 ${kindName(type.suit, type.rank)}`, () => send({ type: "CALL", suit: type.suit, rank: type.rank, mode: "openSolo" }), false, `open-${type.suit}${type.rank}`, "hot"),
                  ],
            )}
            {hintButton}
          </div>
        );
      case "declare": {
        const choices = legal.flatMap((command) => (command.type === "DECLARE" ? [command.choice] : []));
        return (
          <div className="bh-actions" data-tutorial="declare-buttons">
            {choices.includes("darkGuard") && button("暗保", () => send({ type: "DECLARE", choice: "darkGuard" }), false, "dark-guard")}
            {choices.includes("openGuard") && button("明保 ×2", () => send({ type: "DECLARE", choice: "openGuard" }), true, "open-guard", "blue")}
            {choices.includes("noRebel") && button("不造反", () => send({ type: "DECLARE", choice: "noRebel" }), !choices.includes("rebel"), "no-rebel")}
            {choices.includes("rebel") && button("造反", () => send({ type: "DECLARE", choice: "rebel" }), true, "rebel-button", "hot")}
            {hintButton}
          </div>
        );
      }
      case "playing":
        return (
          <div className="bh-actions">
            {following && button(noBeat ? "要不起" : "不要", () => send({ type: "PASS" }), noBeat, "pass-button")}
            {!noBeat && button("提示", hint, false, "hint-button")}
            {!noBeat && button("出牌", play, true, "play-button", "", !canPlay)}
          </div>
        );
      default:
        return null;
    }
  })();

  // ---------- 自己的手牌 ----------
  const handWidth = handBox.width;
  const colStep = Math.min(layout.colStep, columns.length > 1 ? Math.floor((handWidth - CARD_W * hs) / (columns.length - 1)) : layout.colStep);
  const handNode = (
    <div
      className={["bh-hand", canSelect ? "selectable" : "", myPlay ? "my-turn" : ""].join(" ")}
      ref={handRef}
      data-tutorial="hand"
      onContextMenu={(event) => {
        if (!canSelect) return;
        event.preventDefault();
        setSelected([]);
      }}
    >
      <div className="bh-columns" style={{ width: columns.length > 0 ? CARD_W * hs + (columns.length - 1) * colStep : 0, height: (layout.mobile ? 52 : 30) + CARD_H * hs + (maxStack - 1) * layout.stack + 8 * hs }}>
        {columns.map((column, index) => {
          const picked = column.cards.filter((card) => selectedSet.has(card)).length;
          return (
            <div
              key={column.key}
              className={picked > 0 ? "bh-col picked" : "bh-col"}
              style={{ left: index * colStep, width: CARD_W * hs, zIndex: index + 1 } as CSSProperties}
              data-tutorial={`col-${column.key}`}
              onClick={() => {
                if (longPress.current?.done) return;
                tapColumn(column);
              }}
              onDoubleClick={() => tapColumn(column, true)}
              onPointerDown={() => {
                if (!canSelect) return;
                const state = { timer: 0, done: false };
                state.timer = window.setTimeout(() => {
                  state.done = true;
                  tapColumn(column, true);
                }, 450);
                longPress.current = state;
              }}
              onPointerUp={() => window.clearTimeout(longPress.current?.timer)}
              onPointerLeave={() => window.clearTimeout(longPress.current?.timer)}
            >
              <span className="bh-col-head" style={{ width: Math.min(colStep, CARD_W * hs) }}>
                <b>{Math.min(colStep, CARD_W * hs) < 64 && column.label.length > 1 && !/^\d/.test(column.label) ? column.label.slice(0, 1) : column.label}</b>
                <small>{picked > 0 ? `${picked}/${column.cards.length}` : layout.mobile ? column.cards.length : `×${column.cards.length}`}</small>
              </span>
              <span className="bh-col-cards" style={{ height: CARD_H * hs + (column.cards.length - 1) * layout.stack }}>
                {column.cards.map((card, i) => {
                  const mark = card === rules.tehua ? art.markTehua : iAmGuard && kindOf(card) === guardKind ? art.markBao : null;
                  return (
                    <span key={card} className={selectedSet.has(card) ? "bh-hcard on" : "bh-hcard"} style={{ top: i * layout.stack }}>
                      <CardView card={card} scale={hs} />
                      {mark && <img className="bh-mark" src={mark} alt={mark === art.markBao ? "保" : "特"} />}
                    </span>
                  );
                })}
              </span>
            </div>
          );
        })}
      </div>
      {hand.length === 0 && playing && stage === "playing" && <span className="bh-hand-empty">{me.place ? `你已经出完了：${PLACE_NAMES[me.place]}` : spectating ? "观战：看不到这个座位的手牌" : ""}</span>}
      {hand.length === 0 && spectating && stage !== "playing" && <span className="bh-hand-empty">观战：{room.access.spectatorsSeeAll ? "这个座位没有牌" : "看不到手牌"}</span>}
    </div>
  );

  const showSummary = stage === "handEnd" && game.summary && !hideSummary && !settling && game.phase === "playing";
  const opponents = [4, 3, 2, 1].map(seatAt);
  const oppWidth = Math.floor((tableBox.width - 24) / 4) - 12;
  const sceneUrl = theme === "day" ? art.sceneDay : art.sceneNight;

  const status = (
    <div className="bh-status" data-tutorial="status">
      <strong>{headline}</strong>
      {timerShown && (myTurn || stage === "grab" || stage === "declare" || stage === "handEnd") && <b className={secondsLeft! <= 5 ? "bh-timer low" : "bh-timer"}>{secondsLeft}s</b>}
      {!layout.mobile && detail && <small>{detail}</small>}
      {(error || shownNotice) && <small className={error ? "bh-error" : ""} role={error ? "alert" : "status"}>{error || shownNotice}</small>}
    </div>
  );

  return (
    <div className={layout.mobile ? "bh-screen mobile" : "bh-screen"}>
      <header className="bh-topbar">
        {brand}
        <div className="bh-round">
          <span>第 <b>{game.handNo}</b>/{game.config.hands} 盘</span>
          {game.mode && <span>×<b>{game.doubled ? 2 : 1}</b></span>}
        </div>
        {layout.mobile && (
          <button className="quiet-button bh-menu-toggle" type="button" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            菜单{unread > 0 ? ` · ${unread}` : ""}
          </button>
        )}
        <div className={menu ? "bh-topbar-right open" : "bh-topbar-right"}>
          {themeToggle}
          <GameRules />
          <GameRoomMenu room={room} />
          {isHost && <button className="quiet-button danger" type="button" onClick={onDissolve}>解散</button>}
          <button className="quiet-button bh-drawer-toggle" type="button" aria-expanded={drawer} onClick={() => { setDrawer(!drawer); setMenu(false); }}>
            记录 / 聊天{unread > 0 ? ` · ${unread}` : ""}
          </button>
          {connection}
        </div>
      </header>

      <div className={drawer ? "bh-layout drawer-open" : "bh-layout"}>
        <div
          className={["bh-table", layout.mobile ? "mobile" : ""].join(" ")}
          ref={tableRef}
          style={{ "--scene": `url(${sceneUrl})`, "--scene-size": coverSize(tableBox.width, tableBox.height), "--ps": ps, "--hs": hs, "--stack": `${layout.stack}px` } as CSSProperties}
        >
          <div className="bh-opps">
            {opponents.map((seat) => (
              <div className={`bh-opp r${relOf(seat)}`} key={seat}>
                {plate(seat)}
                {playSlot(seat, layout.mobile ? oppWidth + 6 : oppWidth)}
              </div>
            ))}
          </div>
          <div className="bh-mid">
            {info}
            <div className="bh-center" data-tutorial="center">
              {me.auto && !spectating && playing && (
                <div className="bh-auto-banner">
                  托管中：人机替你出牌
                  <button className="primary-button" type="button" onClick={() => send({ type: "AUTO", on: false })} data-tutorial="cancel-auto">取消托管</button>
                </div>
              )}
              {actionBar ?? playSlot(mySeat, layout.mobile ? tableBox.width - 32 : 520)}
              {myPlay && <span className={typeof check === "string" ? "bh-note bad" : "bh-note"}>{selectionNote}</span>}
              {!myTurn && stage === "abdicate" && game.huangHolder === mySeat && !canAscend(hand) && !spectating && <span className="bh-note">没有能叫的牌：几秒后自动让位</span>}
            </div>
            {status}
          </div>
          <div className="bh-mine">
            {plate(mySeat, true)}
            {handNode}
          </div>
          {baoShow && (
            <div className={baoShow.open ? "bh-bao-show open" : "bh-bao-show"} aria-label="叫保亮牌">
              <span className="bh-bao-frame" style={{ backgroundImage: `url(${art.baoShow})`, "--bs": `${layout.mobile ? 1 : 2}px` } as CSSProperties}>
                {baoShow.cards.slice(0, 3).map((card, index) => (
                  <span key={card} className="bh-bao-slot" style={{ left: `calc(${[7, 53, 99][index]} * var(--bs))`, top: "calc(7 * var(--bs))" }}>
                    <CardView card={card} scale={layout.mobile ? 1 : 2} />
                  </span>
                ))}
              </span>
              {baoShow.cards.length > 3 && <span className="bh-bao-fourth"><CardView card={baoShow.cards[3]!} scale={layout.mobile ? 1 : 2} /></span>}
              <b>{baoShow.open ? "明独：一打四" : "第 4 张在谁手里，谁就是侍卫"}</b>
            </div>
          )}
          {banner && <div className={`bh-banner ${banner.kind}`} role="status">{banner.text}</div>}
          {overlay}
        </div>

        <aside className="bh-side">
          {spectating && <SpectateBar room={room} watchId={myId} onWatch={onWatch} onLeave={onLeave} />}
          {sidePanel}
          <section className="bh-panel bh-side-status">
            {detail && <p>{detail}</p>}
            {!spectating && playing && stage !== "handEnd" && (
              <button className="quiet-button" type="button" onClick={() => send({ type: "AUTO", on: !me.auto })}>{me.auto ? "取消托管" : "托管"}</button>
            )}
            {stage === "handEnd" && playing && hideSummary && <button className="primary-button" type="button" onClick={() => setHideSummary(false)}>看结算</button>}
          </section>
          <section className="bh-panel bh-scores" data-tutorial="scores">
            <h3>累计分</h3>
            {game.players.map((player, seat) => (
              <div key={player.id} className={seat === mySeat ? "mine" : ""}>
                <i style={{ background: seatColor(seat) }} />
                <span>{nameOf(seat)}</span>
                {rolesOf(seat).slice(0, 1).map((role) => <img key={role} src={art.role(role)} alt="" />)}
                <b>{player.score}</b>
              </div>
            ))}
          </section>
          <section className="bh-panel bh-tabs">
            <div className="bh-tab-bar" role="tablist">
              <button type="button" role="tab" aria-selected={sideTab === "log"} className={sideTab === "log" ? "active" : ""} onClick={() => setSideTab("log")}>记录</button>
              <button type="button" role="tab" aria-selected={sideTab === "chat"} className={sideTab === "chat" ? "active" : ""} onClick={() => setSideTab("chat")}>
                聊天{unread > 0 && <em>{unread}</em>}
              </button>
            </div>
            {sideTab === "log" ? <ul className="bh-log">{log.map((line) => <li key={line.key}>{line.text}</li>)}</ul> : <div className="bh-chat">{chat}</div>}
          </section>
        </aside>
      </div>
      {showSummary && (
        <HandSummaryDialog game={game} mySeat={mySeat} spectating={spectating} nameOf={nameOf} secondsLeft={secondsLeft} busy={busy} mobile={layout.mobile} onReady={() => send({ type: "READY" })} onHide={() => setHideSummary(true)} />
      )}
      {game.phase === "finished" && !settling && <FinalDialog game={game} room={room} mySeat={mySeat} spectating={spectating} nameOf={nameOf} mobile={layout.mobile} onRematch={onRematch} onLeave={onLeave} actions={finalActions} />}
      {shownHint && (
        <Coach
          bubble
          view={{
            key: `hint-${game.version}`,
            say: shownHint.say,
            ...(shownHint.note ? { note: shownHint.note } : {}),
            anchor: shownHint.anchor,
            focus: false,
            face: "think",
            actions: <button className="quiet-button" type="button" onClick={() => setCoachHint(null)}>知道了</button>,
          }}
        />
      )}
      {tips.tip && <TipToast tip={tips.tip} onClose={tips.dismiss} onNever={tips.never} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 一盘结算

function roleOfSummary(game: BaohuangState, seat: number): { role: RoleArt[]; word: string } {
  const summary = game.summary!;
  if (seat === summary.emperor) return summary.mode === "pair" ? { role: ["emperor"], word: "皇帝" } : { role: ["emperor", "solo"], word: summary.mode === "darkSolo" ? "皇帝·暗独" : "皇帝·明独" };
  if (seat === summary.guard) return { role: ["guard"], word: "侍卫" };
  return { role: ["rebel"], word: "革命党" };
}

function HandSummaryDialog({ game, mySeat, spectating, nameOf, secondsLeft, busy, mobile, onReady, onHide }: {
  game: BaohuangState;
  mySeat: number;
  spectating: boolean;
  nameOf: (seat: number) => string;
  secondsLeft: number | null;
  busy: boolean;
  mobile: boolean;
  onReady: () => void;
  onHide: () => void;
}) {
  const summary = game.summary!;
  const me = game.players[mySeat]!;
  const ready = game.ready.includes(me.id);
  const myDelta = summary.deltas[mySeat]!;
  const royalWon = summary.winner === "royal";
  const title = spectating ? (summary.winner === "draw" ? "平局" : royalWon ? "保皇派赢了" : "革命党赢了") : myDelta > 0 ? "你赢了！" : myDelta < 0 ? "你输了" : "这盘平手";
  const won = spectating ? summary.winner !== "rebel" : myDelta >= 0;
  const formula = (() => {
    if (summary.mode === "pair") {
      const base = summary.guardBase!;
      return `侍卫得分 = 6 −（皇帝名次 + 侍卫名次 = ${summary.rankSum}）= ${base > 0 ? "+" : ""}${base}${summary.multiplier === 2 ? `，${summary.doubleReason === "openGuard" ? "明保" : "造反成功"} ×2` : ""}；皇帝是侍卫的 2 倍，革命党各得相反数`;
    }
    const place = summary.places[summary.emperor];
    const where = place === 1 ? "头科" : place === 2 ? "二科" : "没拿到前两名";
    return summary.mode === "openSolo" ? `明独：皇帝${place === 1 ? "头科 +24" : "没拿头科 −24"}，其余各得相反的四分之一` : `暗独：皇帝${where}${summary.multiplier === 2 ? "（造反成功 ×2）" : ""}`;
  })();
  const order = game.players.map((_, seat) => seat).sort((a, b) => (summary.places[a] ?? 9) - (summary.places[b] ?? 9));
  return (
    <div className="gm-modal-backdrop" role="presentation">
      <section className={`gm-panel bh-summary ${won ? "won" : "lost"}`} role="dialog" aria-modal="true" aria-label={`第 ${game.handNo} 盘结算`} data-tutorial="summary">
        <header>
          <span className="bh-ribbon" style={{ backgroundImage: `url(${won ? art.resultWin : art.resultLose})` }}>
            <b>{title}</b>
          </span>
          <small>第 {game.handNo} 盘 · {summary.mode === "pair" ? "二打三" : summary.mode === "darkSolo" ? "暗独" : "明独"}{summary.grabbed ? "（抢独）" : ""}{summary.forced ? " · 逼位" : ""} · ×{summary.multiplier}</small>
          <button className="quiet-button" type="button" onClick={onHide}>看牌桌</button>
        </header>
        <p className="bh-formula" data-tutorial="sum-formula">{formula}</p>
        <ol className="bh-sum-players">
          {order.map((seat) => {
            const role = roleOfSummary(game, seat);
            const place = summary.places[seat];
            const delta = summary.deltas[seat]!;
            const left = summary.leftovers[seat] ?? [];
            return (
              <li key={seat} className={seat === mySeat && !spectating ? "mine" : ""}>
                <span className="bh-sum-place">{place ? <img src={art.rank(place)} alt={PLACE_NAMES[place]} /> : <em>未走科</em>}</span>
                <span className="bh-sum-who">
                  <strong>{nameOf(seat)}</strong>
                  <small>
                    {role.role.map((item) => <img key={item} src={art.role(item)} alt="" />)}
                    {role.word}
                    {game.players[seat]!.declare === "rebel" ? " · 造反" : game.players[seat]!.declare === "openGuard" ? " · 明保" : ""}
                  </small>
                </span>
                <span className="bh-sum-left">{left.length > 0 ? (mobile ? `剩 ${left.length} 张` : <span className="bh-left-cards">{left.slice(0, 24).map((card, index) => <CardView key={card} card={card} scale={1} style={index > 0 ? { marginLeft: 12 - CARD_W } : undefined} />)}{left.length > 24 && <small>…共 {left.length} 张</small>}</span>) : ""}</span>
                <b className={delta > 0 ? "up" : delta < 0 ? "down" : ""}>{delta > 0 ? "+" : ""}{delta}</b>
                <span className="bh-sum-total">{game.players[seat]!.score}</span>
              </li>
            );
          })}
        </ol>
        <footer>
          <span className="bh-muted">{game.handNo < game.config.hands ? `还剩 ${game.config.hands - game.handNo} 盘` : "最后一盘"}</span>
          {!spectating ? (
            <button className="primary-button" type="button" disabled={busy || ready} onClick={onReady} data-tutorial="next-hand">
              {ready ? `等其他人 ${game.ready.length}/5` : "下一盘"}
              {secondsLeft !== null && <small>{secondsLeft}s</small>}
            </button>
          ) : (
            <span className="bh-muted">等玩家点「下一盘」 {game.ready.length}/5</span>
          )}
        </footer>
      </section>
    </div>
  );
}

function FinalDialog({ game, room, mySeat, spectating, nameOf, mobile, onRematch, onLeave, actions }: {
  game: BaohuangState;
  room: LobbyRoomSnapshot;
  mySeat: number;
  spectating: boolean;
  nameOf: (seat: number) => string;
  mobile: boolean;
  onRematch: (accept: boolean) => void;
  onLeave: () => void;
  actions?: ReactNode;
}) {
  const result = game.finalResult!;
  const [showLast, setShowLast] = useState(false);
  const accepted = room.rematch?.acceptedIds.includes(socket.id ?? "") ?? false;
  const order = game.players.map((_, seat) => seat).sort((a, b) => result.ranks[a]! - result.ranks[b]!);
  const myId = game.players[mySeat]!.id;
  const won = result.winners.includes(myId) && !spectating;
  const title = won ? (result.winners.length > 1 ? "并列第一！" : "你赢了！") : `${result.winners.map((id) => nameOf(game.players.findIndex((player) => player.id === id))).join("、")} 获胜`;
  if (showLast && game.summary) {
    return <HandSummaryDialog game={game} mySeat={mySeat} spectating nameOf={nameOf} secondsLeft={null} busy={false} mobile={mobile} onReady={() => undefined} onHide={() => setShowLast(false)} />;
  }
  return (
    <div className="gm-modal-backdrop" role="presentation">
      <section className="gm-panel bh-final" role="dialog" aria-modal="true" aria-labelledby="bh-final-title">
        <span className="bh-ribbon" style={{ backgroundImage: `url(${won ? art.resultWin : art.resultLose})` }}>
          <b id="bh-final-title">{title}</b>
        </span>
        <p className="bh-muted">打满 {game.config.hands} 盘，个人累计分最高的人获胜（一样高就并列）。</p>
        <ol className="bh-standings">
          {order.map((seat) => (
            <li key={seat} className={result.winners.includes(game.players[seat]!.id) ? "winner" : ""}>
              <span className="bh-rank">{result.ranks[seat]}</span>
              <img className="bh-st-avatar" src={art.avatar(seat)} alt="" />
              <strong>{nameOf(seat)}</strong>
              <small>最后一盘 {game.players[seat]!.handDelta > 0 ? "+" : ""}{game.players[seat]!.handDelta}</small>
              <b>{game.players[seat]!.score}</b>
            </li>
          ))}
        </ol>
        {game.summary && <button className="quiet-button" type="button" onClick={() => setShowLast(true)}>看最后一盘结算</button>}
        {actions ? (
          <div className="bh-rematch"><div className="gm-panel-actions">{actions}</div></div>
        ) : spectating ? (
          <div className="bh-rematch">
            <span>{room.rematch ? `等玩家决定要不要再来一局（${room.rematch.acceptedIds.length}/${room.members.length}）` : "对局结束"}</span>
            <div className="gm-panel-actions"><button className="quiet-button" type="button" onClick={onLeave}>离开观战</button></div>
          </div>
        ) : (
          room.rematch && (
            <div className="bh-rematch">
              <span>再来一局？还剩 {Math.ceil(room.rematch.remainingMs / 1000)} 秒（{room.rematch.acceptedIds.length}/{room.members.length} 人同意）</span>
              <div className="gm-panel-actions">
                <button className="quiet-button" type="button" onClick={() => onRematch(false)}>离开</button>
                <button className="primary-button" type="button" disabled={accepted} onClick={() => onRematch(true)} data-tutorial="rematch">{accepted ? "等待其他人" : "再来一局"}</button>
              </div>
            </div>
          )
        )}
      </section>
    </div>
  );
}

export default GameBoard;
