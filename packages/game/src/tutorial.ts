/**
 * 新手教程的剧本（站内统一做法，见 ~/projects/pipeline/handbook/tutorial-notes.md）。
 *
 * 剧本局：每人一手很短的牌（预览局面工厂 createScene 摆好），所有牌都是确定的：
 * 你（座位 0）拿皇牌和三张红桃 7 → 登基叫红桃 7 → 4 人表态（阿福一个人造反，失败）→ 你出一对 8，阿福用两张小王压 →
 * 你试「大王 小王」压不住、不要 → 过牌后又能上（K 压 Q）→ 挂王一手出完拿头科 → 接风给阿福 →
 * 小翠打出第 4 张红桃 7 被揭成侍卫 → 小翠三科、这一盘结束：侍卫 +2、皇帝 +4、革命党各 −2 → 独保、本站设定 → 练习局。
 * 练习局：普通的一场（3 盘、随机发牌），其他 4 个座位交给人机。
 */
import { HUANG_ID, isJoker, rankOf, type CardId } from "./cards.js";
import { createBaohuang, legalCommands, pendingSeats, setRules } from "./baohuang.js";
import { canAscend } from "./cards.js";
import { pickCards, createScene } from "./scenes.js";
import type { BaohuangCommand, BaohuangState } from "./types.js";

export type TutorialFace = "base" | "happy" | "surprised" | "think";

interface StepBase {
  readonly id: string;
  /** 侧栏进度里的课名（只有几步带）。 */
  readonly lesson?: string;
  /** 主句（24px），一句话。 */
  readonly say: string;
  /** 补充（12px），最多两句。 */
  readonly note?: string;
  /** 触屏上换的说法。 */
  readonly noteTouch?: string;
  /** 高亮哪个元素（data-tutorial）。 */
  readonly anchor?: string;
  readonly face?: TutorialFace;
}

export type TutorialStep =
  | (StepBase & { readonly kind: "info"; readonly finale?: boolean })
  | (StepBase & {
      readonly kind: "do";
      readonly expect: BaohuangCommand;
      /** 选牌以后高亮挪到哪：当前选中的牌（按点数，写法同 pickCards，比如 "8 8"、"大 小"）和它一样时用这个锚点。 */
      readonly then?: readonly { readonly cards: string; readonly anchor: string }[];
    })
  | (StepBase & { readonly kind: "watch"; readonly moves: readonly BaohuangCommand[] });

/** 自己的座位 id（座位 0）。 */
export const TUTORIAL_SELF = "p0";
export const TUTORIAL_NAMES = ["你", "阿福", "小翠", "咕噜一号", "咕噜二号"] as const;

/** 剧本局的牌（座位 0–4）：没写花色的点数随便哪一副。 */
const TUTORIAL_DEAL = [
  "皇 小 H7 H7 H7 S8 C8 SK",
  "小 小 S9 SQ D6",
  "D10 H7 S2",
  "S6 C9 CA C2 D10",
  "SJ D9 HK H6 DA",
] as const;

export function createTutorialGame(selfName = "你"): BaohuangState {
  return createScene({
    names: [selfName, ...TUTORIAL_NAMES.slice(1)],
    bots: [1, 2, 3, 4],
    deal: [...TUTORIAL_DEAL],
    dealStart: 0,
    options: { hands: 3 },
    seed: 20261010,
  });
}

/** 练习局：普通的一场 3 盘，你和 4 个人机（座位随机）。 */
export function createPracticeGame(selfName = "你", seed = 1): BaohuangState {
  const players = [
    { id: TUTORIAL_SELF, name: selfName, bot: false },
    { id: "p1", name: "咕噜一号", bot: true },
    { id: "p2", name: "咕噜二号", bot: true },
    { id: "p3", name: "咕噜三号", bot: true },
    { id: "p4", name: "咕噜四号", bot: true },
  ];
  return createBaohuang(players, seed, { hands: 3 });
}

// 剧本里的出牌用开局那一手里的具体牌（每张只出一次，所以从开局手牌里挑就行）
const START = createTutorialGame();
const play = (seat: number, text: string): BaohuangCommand => ({ type: "PLAY", cardIds: pickCards(START, seat, text) });
const PASS: BaohuangCommand = { type: "PASS" };

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: "goal",
    kind: "info",
    lesson: "谁和谁一伙",
    say: "保皇是 5 个人打的：皇帝和侍卫一伙，另外 3 个人是革命党。",
    note: "大家轮流出牌，比谁先出完，按出完的名次给每个人算分；打满几盘，个人累计分最高的人赢。",
    face: "happy",
  },
  {
    id: "huang",
    kind: "info",
    lesson: "登基",
    say: "你手里这张带皇冠的大王是皇牌：拿到它可以登基当皇帝。",
    note: "当皇帝要有 3 张同花色同点数的牌。不想当就让位交给上家，转一圈都没人当就逼一个有资格的人当。",
    anchor: "col-B",
  },
  { id: "ascend", kind: "do", say: "你有三张红桃 7，点「登基」当皇帝。", anchor: "ascend-button", expect: { type: "ASCEND" } },
  {
    id: "call",
    kind: "do",
    lesson: "叫保定侍卫",
    say: "点「叫 红桃 7」，把这三张亮给大家看。",
    note: "四副牌里红桃 7 正好 4 张：第 4 张在谁手里，谁就是你的侍卫。",
    anchor: "call-buttons",
    expect: { type: "CALL", suit: "H", rank: 7, mode: "pair" },
  },
  {
    id: "secret",
    kind: "info",
    say: "侍卫是谁只有他自己知道，连你这个皇帝也不知道。",
    note: "这里显示的是保牌。你得从大家怎么出牌去猜：谁在帮你，谁在拦你。",
    anchor: "guard-card",
    face: "think",
  },
  {
    id: "declare",
    kind: "watch",
    lesson: "表态",
    say: "其他 4 个人同时表态：侍卫选明保或暗保，其他人选造反或不造反。",
    note: "看不到谁选了什么，大家选完一起公布。",
    anchor: "status",
    moves: [
      { type: "DECLARE", choice: "rebel" },
      { type: "DECLARE", choice: "darkGuard" },
      { type: "DECLARE", choice: "noRebel" },
      { type: "DECLARE", choice: "noRebel" },
    ],
  },
  {
    id: "rebel-failed",
    kind: "info",
    say: "只有阿福一个人造反：失败了，他自己暴露是革命党。",
    note: "2 个人以上同时造反才成功：本盘 ×2，还会揭出侍卫。侍卫明保也是 ×2，最多 ×2。",
    anchor: "seat-1",
    face: "surprised",
  },
  {
    id: "lead",
    kind: "do",
    lesson: "出牌和压牌",
    say: "皇帝先出。点两下「8」这一列选两张 8，再点「出牌」。",
    note: "一套牌是同点数的几张，可以挂王；没有顺子，2 也不能和别的点数一起出。",
    anchor: "col-8",
    expect: play(0, "8 8"),
    then: [{ cards: "8 8", anchor: "play-button" }],
  },
  { id: "afu-beats", kind: "watch", say: "看下家阿福怎么压。", anchor: "seat-1", moves: [play(1, "小 小"), PASS, PASS, PASS] },
  {
    id: "same-count",
    kind: "info",
    say: "阿福出两张小王：张数和你一样，每张都比你的大，就压住了。",
    note: "要压别人：张数必须相同，两边各自从大到小一张张比，每一张都要更大。",
    anchor: "play-1",
  },
  {
    id: "tie",
    kind: "do",
    say: "试试点一张大王、一张小王，看能不能压两张小王。",
    note: "大王比小王大，可第二张小王对小王打平——压不住。看清红字后点「要不起」。",
    anchor: "hand",
    expect: PASS,
    then: [{ cards: "大 小", anchor: "center" }],
    face: "think",
  },
  {
    id: "afu-leads",
    kind: "watch",
    say: "大家都不要，最后出牌的阿福重新随便出。",
    anchor: "seat-1",
    moves: [play(1, "9"), play(2, "10"), PASS, play(4, "J")],
  },
  {
    id: "pass-first",
    kind: "do",
    lesson: "过牌还能再上",
    say: "先点「不要」，看看别人怎么出。",
    note: "不要了这一轮还没完：后面有人出牌，再轮到你时还能接着压。",
    anchor: "pass-button",
    expect: PASS,
  },
  { id: "afu-q", kind: "watch", say: "阿福出 Q 压住了 J。", anchor: "seat-1", moves: [play(1, "Q"), PASS, PASS, PASS] },
  {
    id: "re-enter",
    kind: "do",
    say: "又轮到你了：点「K」再点「出牌」，压住阿福的 Q。",
    note: "这就是「过牌可上」。",
    anchor: "col-13",
    expect: play(0, "K"),
    then: [{ cards: "K", anchor: "play-button" }],
  },
  { id: "k-wins", kind: "watch", say: "没人压得住，你又拿到出牌权。", anchor: "play-0", moves: [PASS, PASS, PASS, PASS] },
  {
    id: "last-hand",
    kind: "do",
    lesson: "走科和接风",
    say: "你只剩三张 7 和两张王：一次全出，挂了大王谁也压不了。",
    note: "双击一列能整列选上：双击「7」，再点大王、小王，最后点「出牌」。",
    noteTouch: "长按一列能整列选上：长按「7」，再点大王、小王，最后点「出牌」。",
    anchor: "hand",
    expect: play(0, "7 7 7 皇 小"),
    then: [{ cards: "7 7 7 大 小", anchor: "play-button" }],
  },
  {
    id: "first",
    kind: "info",
    say: "你第一个出完：头科！",
    note: "出完叫走科，名次依次是头科、二科、三科、二落、大落。每个人剩几张一直公开，5 张以内会高亮。",
    anchor: "my-plate",
    face: "happy",
  },
  {
    id: "jiefeng",
    kind: "watch",
    say: "你出完了、这一轮没人压：由你后面第一个有牌的阿福接着出，叫接风。",
    anchor: "seat-1",
    moves: [PASS, PASS, PASS, PASS, play(1, "6")],
  },
  { id: "guard-plays", kind: "watch", say: "看小翠出什么。", anchor: "seat-2", moves: [play(2, "H7")] },
  {
    id: "guard-revealed",
    kind: "info",
    lesson: "揭开侍卫",
    say: "小翠打出了第 4 张红桃 7：他就是你的侍卫！",
    note: "谁打出那张保牌，身份就自动公开，所有人都看得到（倍数不变）。",
    anchor: "seat-2",
    face: "surprised",
  },
  { id: "guard-out", kind: "watch", say: "侍卫小翠接着把牌出完。", anchor: "seat-2", moves: [PASS, PASS, play(2, "2")] },
  {
    id: "score",
    kind: "info",
    lesson: "算分",
    say: "你头科、侍卫三科：侍卫 6 −（1 + 3）= +2，你是 2 倍 +4，革命党各 −2。",
    note: "皇帝和侍卫都出完、或者 3 个革命党都出完，这一盘就结束；所以队友的名次也很要紧。",
    anchor: "sum-formula",
  },
  {
    id: "solo",
    kind: "info",
    lesson: "独保",
    say: "皇帝有 4 张同花同点时，可以一个人打四个：独保。",
    note: "暗独只亮 3 张：头科 +12、二科 0、更差 −12；明独亮 4 张 ±24，任何一个革命党先出完就输。",
    face: "think",
  },
  {
    id: "site",
    kind: "info",
    lesson: "本站设定",
    say: "空座由人机补位；连续超时 2 次进托管，就是人机替你打。",
    note: "掉线 3 秒后人机接手，用原昵称和房间码回来能接着打。不能登基的人也会等几秒才让位，别从快慢猜身份。",
  },
  {
    id: "finale",
    kind: "info",
    finale: true,
    say: "学会了！和人机打一局练练吧。",
    note: "拿不准就点「提示」，我告诉你我会怎么出。",
    face: "happy",
  },
];

export const TUTORIAL_FINAL_STEP = "finale";

/** 一张牌的「点数」（大王和皇牌一样，特画按牌面）。 */
const sortKey = (cards: readonly CardId[]) => cards.map((card) => (card === HUANG_ID ? 17 : rankOf(card))).sort((a, b) => a - b).join(",");

/** 选中的牌和剧本写法（"8 8"、"大 小"）是不是同一套（按点数比，不管花色副数）。 */
export function selectionMatches(cards: readonly CardId[], text: string): boolean {
  const ranks = text.trim().split(/\s+/).map((token) => (token === "大" || token === "皇" ? 17 : token === "小" ? 16 : ({ J: 11, Q: 12, K: 13, A: 14, "2": 15 } as Record<string, number>)[token] ?? Number(token)));
  return sortKey(cards) === ranks.sort((a, b) => a - b).join(",");
}

/** 两条命令是不是同一步（出牌按点数比，不管哪一副、哪个花色）。 */
export function sameCommand(a: BaohuangCommand, b: BaohuangCommand): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "PLAY" && b.type === "PLAY") return sortKey(a.cardIds) === sortKey(b.cardIds);
  if (a.type === "CALL" && b.type === "CALL") return a.suit === b.suit && a.rank === b.rank && a.mode === b.mode;
  if (a.type === "DECLARE" && b.type === "DECLARE") return a.choice === b.choice;
  if (a.type === "GRAB" && b.type === "GRAB") return a.grab === b.grab;
  if (a.type === "AUTO" && b.type === "AUTO") return a.on === b.on;
  return true;
}

/** 现在轮到谁（同时选的阶段：还没选的人里按座位顺序第一个）；整场结束返回 null。 */
export function tutorialActor(state: BaohuangState): string | null {
  if (state.phase === "finished") return null;
  const seat = pendingSeats(state)[0];
  return seat === undefined ? null : state.players[seat]!.id;
}

/**
 * 锚点在这个局面下应该看得见（剧本单测用；和网页上 data-tutorial 的出现条件一致）。
 * viewer 是自己的座位。
 */
export function anchorVisible(state: BaohuangState, anchor: string, viewer = 0): boolean {
  const me = state.players[viewer]!;
  const myTurn = legalCommands(state, me.id).length > 0;
  const rel = (seat: number) => (seat - viewer + 5) % 5;
  if (/^seat-[1-4]$/.test(anchor) || anchor === "my-plate" || anchor === "status" || anchor === "hand" || anchor === "center" || anchor === "scores") return true;
  if (anchor === "ascend-button") return state.stage === "abdicate" && myTurn && canAscend(me.hand);
  if (anchor === "abdicate-button") return state.stage === "abdicate" && myTurn;
  if (anchor === "call-buttons") return state.stage === "call" && myTurn;
  if (anchor === "declare-buttons") return state.stage === "declare" && myTurn;
  if (anchor === "guard-card") return state.guardCard !== null;
  if (anchor === "play-button" || anchor === "hint-button") return state.stage === "playing" && myTurn;
  if (anchor === "pass-button") return state.stage === "playing" && myTurn && state.lastPlay !== null;
  if (anchor === "summary" || anchor === "sum-formula") return state.stage === "handEnd" && state.summary !== null;
  const play = /^play-([0-4])$/.exec(anchor);
  if (play) {
    const seat = state.players.findIndex((_, s) => rel(s) === Number(play[1]));
    return (state.stage === "playing" || state.stage === "handEnd") && state.table[seat] !== null;
  }
  const col = /^col-(\w+)$/.exec(anchor);
  if (col) {
    const rules = setRules(state);
    const key = col[1]!;
    return me.hand.some((card) =>
      key === "S" ? isJoker(card) && rankOf(card) === 16 : key === "B" ? isJoker(card) && rankOf(card) === 17 : key === "T" ? card === rules.tehua : !isJoker(card) && card !== rules.tehua && String(rankOf(card)) === key,
    );
  }
  return false;
}
