/**
 * 保皇的动作音效：看对局里新来的事件（game.history 比上一次多出来的那几条）放对应的声音。
 * 声音都来自全站共用的 gm-sound.tsx（sfx.* 和 synth），这里只决定「什么动作配什么声音、什么时候响」。
 *
 * - 自己的动作 mine=true 响亮，别人的减半；观战时都算别人的。
 * - 第一次拿到对局（进房间、重连、观战刚进来、教程换一局）不出声；剧本跳到新局面不出声，一下来了一大串（断线很久又回来）只放最后一步。
 * - 同一步里的几个声音按顺序错开几十到几百毫秒，听起来像一个动作的结果。
 * - 抢独、表态是同时选、对别人保密的：别人选了什么不出声（不然一听就知道），只有自己按下时响一声表态音（room.queued 出现）。
 */
import { useEffect, useRef } from "react";
import { isWild, type BaohuangEvent, type BaohuangState, type GameCommand } from "@baohuang/game";
import { sfx, synth, type SfxName } from "./gm-sound.js";

/** 开发时把放过的声音名字记进 window.__sfxLog（自测脚本靠它确认响的是哪个）。 */
function log(name: string) {
  if (!import.meta.env.DEV) return;
  const w = window as unknown as { __sfxLog?: string[] };
  (w.__sfxLog ??= []).push(name);
}

type SfxArgs<N extends SfxName> = Parameters<(typeof sfx)[N]>;

/** delay 毫秒后放一个 sfx.* 声音。 */
function play<N extends SfxName>(delay: number, name: N, ...args: SfxArgs<N>) {
  const run = () => {
    log(name);
    (sfx[name] as (...a: SfxArgs<N>) => void)(...args);
  };
  if (delay <= 0) run();
  else window.setTimeout(run, delay);
}

/** delay 毫秒后放一个这款游戏自己的声音。 */
function cue(delay: number, name: string, run: () => void) {
  const go = () => {
    log(name);
    run();
  };
  if (delay <= 0) go();
  else window.setTimeout(go, delay);
}

const { tone, noise, level } = synth;

/** 表态（抢独、登基 / 让位、明保 / 暗保、造反）：要的往上两三个音，不要的轻轻往下一声。 */
function claim(yes: boolean, mine: boolean, strong = false) {
  const v = level(mine);
  if (!yes) {
    tone(587, { duration: 0.12, volume: 0.09 * v, type: "triangle", glideTo: 440 });
    return;
  }
  const notes = strong ? [659, 880, 1175] : [659, 880];
  notes.forEach((f, i) => tone(f, { at: i * 0.07, duration: 0.14, volume: 0.13 * v, type: "triangle" }));
  if (strong) noise({ at: 0.14, duration: 0.08, volume: 0.1 * v, filter: "highpass", freq: 3000 });
}

/** 登基：一小段号角（方波泛音的上行琶音，最后一个音拖长）。被逼登基的低一个调。 */
function coronation(mine: boolean, forced: boolean) {
  const v = level(mine);
  const k = forced ? 0.89 : 1;
  const notes = [392, 523, 659, 784];
  notes.forEach((f, i) => {
    const last = i === notes.length - 1;
    tone(f * k, { at: i * 0.11, duration: last ? 0.6 : 0.14, volume: 0.09 * v, type: "square" });
    tone(f * 2 * k, { at: i * 0.11, duration: last ? 0.5 : 0.12, volume: 0.05 * v, type: "triangle" });
  });
  noise({ at: 0.33, duration: 0.3, volume: 0.06 * v, filter: "highpass", freq: 5000 });
}

/** 抢独：一声重击接往上的号角，一打四。 */
function grabSolo(mine: boolean) {
  sfx.hit(mine);
  const v = level(mine);
  [523, 784, 1047].forEach((f, i) => tone(f, { at: 0.15 + i * 0.08, duration: 0.2, volume: 0.1 * v, type: "square" }));
}

/** 剩 1–2 张时提醒（两声短促的嘀）。 */
function alarm(mine: boolean, left: number) {
  const v = level(mine);
  const f = left === 1 ? 1320 : 1100;
  tone(f, { duration: 0.07, volume: 0.11 * v, type: "square" });
  tone(f, { at: 0.12, duration: 0.07, volume: 0.11 * v, type: "square" });
}

/** 别人点了「下一盘」：一声很轻的嗒。 */
function tick() {
  tone(1400, { duration: 0.04, volume: 0.05, type: "triangle" });
}

/**
 * 上一次之后新来的事件：在新的 history 里找到上一次 history 的最后两条，后面的就是新的。
 * 引擎一步可能连走好几下（教程里烧牌窗口、服务器连着处理），所以不只看 game.events。对不上（剧本跳到新局面）返回 null。
 */
function freshEvents<E>(before: readonly E[], after: readonly E[]): E[] | null {
  if (before.length === 0) return [...after];
  const lastKey = JSON.stringify(before[before.length - 1]);
  const prevKey = before.length > 1 ? JSON.stringify(before[before.length - 2]) : null;
  for (let i = after.length - 1; i >= 0; i -= 1) {
    if (JSON.stringify(after[i]) !== lastKey) continue;
    if (prevKey === null || i === 0 || JSON.stringify(after[i - 1]) === prevKey) return after.slice(i + 1);
  }
  return null;
}

/** 一步里的事件 → 声音，按顺序错开。返回这些声音一共排到了多少毫秒以后（「轮到你」排在它们后面）。 */
function playEvents(events: readonly BaohuangEvent[], game: BaohuangState, mySeat: number | null): number {
  let t = 0;
  const mine = (seat: number | null) => seat !== null && seat === mySeat;
  for (const event of events) {
    switch (event.type) {
      case "HandStarted":
        if (event.handNo > 1) {
          play(t, "shuffle");
          t += 380;
        }
        break;
      case "Redeal":
        play(t, "shuffle");
        t += 380;
        break;
      case "Dealt":
        play(t, "deal", 12);
        t += 600;
        break;
      case "GrabResolved":
        if (event.seat !== null) {
          const m = mine(event.seat);
          cue(t, "grabSolo", () => grabSolo(m));
          t += 600;
        }
        break;
      case "Ascended": {
        const m = mine(event.seat);
        cue(t, "coronation", () => coronation(m, event.forced));
        t += 800;
        break;
      }
      case "Abdicated":
      case "Forced": {
        // 皇牌（和贴牌）交到下一个人手里
        const from = event.from;
        const to = event.type === "Abdicated" ? event.to : event.seat;
        if (event.type === "Abdicated") cue(t, "claim:abdicate", () => claim(false, mine(from)));
        play(t + 120, "card", mine(from), 1 + event.carried.length);
        play(t + 320, "draw", mine(to), 1 + event.carried.length);
        t += 500;
        break;
      }
      case "GuardCalled": {
        // 叫保：皇帝亮出 3 张（明独 4 张）
        const m = mine(event.emperor);
        for (let i = 0; i < event.shown.length; i += 1) play(t + i * 110, "flip", m);
        play(t + event.shown.length * 110 + 100, "reveal", m);
        if (event.open) play(t + event.shown.length * 110 + 350, "hit", m);
        t += event.shown.length * 110 + 500;
        break;
      }
      case "DeclaresRevealed":
        play(t, "reveal", false);
        t += 300;
        if (event.reason === "openGuard") {
          play(t, "coin", mine(event.guard));
          t += 300;
        } else if (event.reason === "rebel") {
          play(t, "hit", false);
          play(t + 150, "coin", false);
          t += 400;
        } else if (event.rebelFailed !== null) {
          play(t, "bust", mine(event.rebelFailed));
          t += 400;
        }
        break;
      case "Played": {
        const m = mine(event.seat);
        const rules = { tehua: game.tehua };
        const allWild = event.cardIds.every((card) => isWild(card, rules));
        play(t, "card", m, event.cardIds.length);
        if ((allWild && event.cardIds.length >= 2) || event.cardIds.length >= 6) {
          // 一手全是王、或者 6 张以上的大套：炸一下
          play(t + 160, "boom", m);
          t += 600;
        } else t += 150 + Math.min(event.cardIds.length, 6) * 45;
        if (event.left === 1 || event.left === 2) {
          cue(t + 100, "alarm", () => alarm(m, event.left));
          t += 300;
        }
        break;
      }
      case "Passed":
        play(t, "pass", mine(event.seat));
        t += 200;
        break;
      case "GuardRevealed":
        play(t + 100, "reveal", mine(event.seat));
        play(t + 300, "sparkle", mine(event.seat));
        t += 600;
        break;
      case "Finished":
        // 走科：头科亮晶晶，其余一声得分
        if (event.place === 1) play(t + 150, "sparkle", mine(event.seat));
        else play(t + 150, "score", mine(event.seat));
        t += 500;
        break;
      case "TrickWon":
        // 接风：轻轻一声，把出牌权交出去
        if (event.jiefeng) {
          play(t + 100, "turnPassed");
          t += 250;
        }
        break;
      case "TimedOut":
        if (mine(event.seat)) {
          play(t, "timeout");
          t += 350;
        }
        break;
      case "HandEnded": {
        t += 500;
        const delta = mySeat === null ? null : event.summary.deltas[mySeat] ?? 0;
        if (delta === null) play(t, "score", false);
        else if (delta > 0) play(t, "score", true, true);
        else if (delta < 0) play(t, "bust", true);
        else play(t, "reveal", true);
        t += 500;
        break;
      }
      case "GameEnded": {
        const won = mySeat !== null && event.winners.includes(game.players[mySeat]!.id);
        play(t + 600, "gameOver", won);
        t += 1200;
        break;
      }
      case "AutoChanged":
        break;
    }
  }
  return t;
}

/** 自己按下的表态（抢独 / 表态）是要还是不要。 */
function queuedYes(command: GameCommand): { yes: boolean; strong: boolean } {
  if (command.type === "GRAB") return { yes: command.grab, strong: command.grab };
  if (command.type === "DECLARE") return { yes: command.choice !== "noRebel", strong: command.choice === "openGuard" || command.choice === "rebel" };
  return { yes: true, strong: false };
}

/**
 * 牌桌上调用：对比前后两次对局，放刚发生的动作的声音；轮到自己时响一声。
 * mySeat：自己的座位（观战传 null）；myTurn：现在要自己做决定；queued：自己已经按下、等服务器生效的表态（room.queued）。
 */
export function useGameSfx(game: BaohuangState, mySeat: number | null, myTurn: boolean, queued: GameCommand | undefined) {
  const prev = useRef<{ game: BaohuangState; myTurn: boolean; queued: GameCommand | undefined } | null>(null);
  const claimedAt = useRef(0);
  useEffect(() => {
    const before = prev.current;
    prev.current = { game, myTurn, queued };
    if (!before) return;
    const last = before.game;
    const myClaim = (command: GameCommand) => {
      const { yes, strong } = queuedYes(command);
      claimedAt.current = Date.now();
      cue(0, yes ? `claim:${command.type.toLowerCase()}` : "claim:no", () => claim(yes, true, strong));
    };
    // 换了一局（教程「再练一局」）或者版本往回走了：当成重新进来，不出声
    if (game.version < last.version || game.players.some((player, seat) => player.id !== last.players[seat]?.id)) return;
    // 新来的事件；对不上（剧本跳到新的局面）就整个不出声，一下来了一大串（断线很久又回来）只放最后一步
    const changed = game.version !== last.version;
    const fresh = changed ? freshEvents(last.history, game.history) : [];
    if (changed && fresh === null) {
      if (myTurn && !before.myTurn) play(250, "yourTurn");
      return;
    }
    // 自己按下了抢独 / 表态：联机时服务器 1–3 秒后才生效，按下就先给一声表态音
    if (queued && !before.queued) myClaim(queued);
    // 教程里没有排队，选择直接生效（只有自己看得到自己的选择）
    if (mySeat !== null && game.handNo === last.handNo && Date.now() - claimedAt.current > 5000) {
      const now = game.players[mySeat];
      const then = last.players[mySeat];
      if (now && then && now.grab !== null && then.grab === null) myClaim({ type: "GRAB", grab: now.grab });
      else if (now && then && now.declare !== null && then.declare === null) myClaim({ type: "DECLARE", choice: now.declare });
    }
    if (!changed || fresh === null) {
      if (myTurn && !before.myTurn) play(250, "yourTurn");
      return;
    }
    const events = fresh.length > 12 ? game.events : fresh;
    const t = playEvents(events, game, mySeat);
    // 没有事件的公开变化：别人点了「下一盘」
    if (events.length === 0 && game.ready.some((id) => !last.ready.includes(id) && id !== game.players[mySeat ?? -1]?.id)) cue(0, "tick", tick);

    if (myTurn && !before.myTurn) play(t + 250, "yourTurn");
  }, [game, myTurn, queued]);
}

/** 点选手牌：选上往上一声，放下往下一声。 */
export function selectSound(on: boolean) {
  play(0, "select", on);
}

/** 不能点的地方（不是出牌的时候点手牌）。 */
export function denySound() {
  play(0, "deny");
}

/** 服务器拒绝了操作、房间出错。 */
export function errorSound() {
  play(0, "error");
}
