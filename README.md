# 保皇

山东民间五人扑克的网页联机版。4 副牌去掉 3、4、5 共 168 张；拿到皇牌的人当皇帝，亮出三张同花色同点数的牌，第 4 张在谁手里谁就是侍卫——只有侍卫自己知道。皇帝和侍卫二打三，按走科名次给每个人算分。固定 5 个座位，最少 1 个真人就能开，空座开局时由人机补位。线上路径 `/baohuang`（还没上线，端口 3020 / 5291，pm2 名 baohuang）。

规则书：`~/Desktop/游戏规则/保皇.md`；补充和勘误：`~/Desktop/游戏规则/保皇-补充.md`（勘误 K1–K7 全部照改，变体细则 V1–V12 照做）。开工拍板：`~/projects/pipeline/games/baohuang/decisions/kickoff.json`。

## 本地运行和测试

| 命令 | 做什么 |
|---|---|
| `npm install` | 装依赖 |
| `npm run dev` | 服务器 3020 + 网页 5291（Vite 代理 socket）。另起一套：`SERVER_PORT=3120 WEB_PORT=5391 npm run dev`（服务器也认 `PORT`） |
| `npm test` | 94 个测试（规则书 T1–T17、勘误 K1–K7、变体 V1–V12、7 种开房选项各 300 局随机对局、预览局面、出法对拍、服务器流程 / 保密 / 抓包 / 观战 / 挤登录），约 40 秒 |
| `npm run typecheck` | 规则包、测试代码、服务器、网页的类型检查 |
| `BASE_PATH=/baohuang/ npm run build` | 生产构建 |
| `npm run build:game` | 只构建规则包（服务器和脚本读 `packages/game/dist`；改了 packages/game 先跑这个再测服务器） |

服务器测试用的环境变量（要在导入服务器前设好）：`BOT_DELAY_SCALE=0`（人机、自动让位、表态排队的延迟全部 ×0）、`TURN_MS=300`（每一步的限时）、`OFFLINE_TURN_MS`（离线代打等多久，默认 3000）、`BOT_MIN_MS` / `BOT_MAX_MS`（人机出牌延迟，默认 600–1600）。

### 一个人怎么测

- **陪玩脚本**（模拟真人连进来，策略和服务器上的人机一样）：
  - `node scripts/test-bot.mjs host 陪玩 --start-at=1 --hands=3`：建房，自己 + 4 个人机马上开，打完 3 盘；
  - `node scripts/test-bot.mjs host 房主 --start-at=3 [--grab --bie6 --norebel --tie --tehua]`，再 `node scripts/test-bot.mjs fill <房间码> 2`：3 个真人一起打；
  - 浏览器里用同一个昵称和房间码加入，就能接管掉线的座位；`BOT_IDLE=1` 让脚本只挂着（测超时、托管）；`BOT_URL` 指向别的端口。
- **抓包脚本**：`node scripts/spy.mjs [--tie --tehua --grab ...]`，两个真人打完一整场，检查服务器发给每个人的数据里有没有别人的手牌、种子、没揭开的侍卫和暗独、别人的抢独 / 表态。服务器的保密延迟是真的，想快一点就另起一个 `BOT_DELAY_SCALE=0.1 TURN_MS=3000 PORT=3120 npx tsx apps/server/src/index.ts`，再 `BOT_URL=http://localhost:3120 node scripts/spy.mjs`。
- **重连检查**：`node scripts/reconnect-check.mjs`（建房开局 → 断开 → 人机代打 → 原昵称回来）。
- **调试牌桌**：现在的 `apps/web/src/GameBoard.tsx` 是引擎阶段写的调试牌桌，把状态原样列出来、每个合法操作一个按钮，界面阶段会换成正式牌桌。

## 目录

| 位置 | 内容 |
|---|---|
| `packages/game/src/cards.ts` | 牌 id（带副数）、点数、花色、`canCallTypes`（能叫保的牌）、`parseCards`（测试写法） |
| `packages/game/src/sets.ts` | 一套牌的识别 `parseSet`、逐张比较 `beats`、合法性 `checkPlay`（含憋 6、特画）、出法列举 `playOptions` |
| `packages/game/src/baohuang.ts` | 一盘的流程、超时、隐藏信息（`redactBaohuang`）、计分 |
| `packages/game/src/engine.ts` | 服务器、网页、人机统一调用的入口 |
| `packages/game/src/scenes.ts` | 预览局面工厂（对外接口，见下文） |
| `packages/game/src/bot.ts` | 人机**占位**（随机合法、暗保 / 不造反），人机阶段整个替换 |
| `packages/game/test/` | 引擎测试；`test/acceptance/` 归规则核对（背靠背写，引擎不改） |
| `apps/server/src/index.ts` | Socket.IO 房间服务器（建房、加入、开局补人机、托管、离线代打、观战、挤登录、管理员解散、保密延迟） |
| `apps/server/test/` | 服务器测试：`room`（流程、超时托管、离线回座）、`actions`（每种操作经过服务器）、`secrecy`（保密设定）、`spy`（抓包）、`spectate`、`kickSession`；`bots.test.ts` 归人机阶段 |
| `apps/web/` | Vite + React 网页（界面阶段负责；现在是调试牌桌） |
| `art/`、`apps/web/public/art/` | 美术（`art/spec.md` 是规格表）；牌面是掼蛋的像素牌 `apps/web/public/cards-pixel/` |
| `scripts/` | 陪玩、抓包、重连脚本 |

## 规则说明（自己的话）

**分组。** 每盘有一个皇帝和一个侍卫（保皇派），另外三个人是革命党。皇帝是谁大家都知道；侍卫是谁一开始只有侍卫自己知道，连皇帝也不知道。皇帝和侍卫可以是同一个人（独保，一个人打四个）。分数按个人累计，打满约定的盘数，总分最高的人赢（可以并列）。

**牌。** 4 副扑克去掉 3、4、5，共 168 张。点数从小到大：6 7 8 9 10 J Q K A 2 小王 大王。花色不分大小，只在叫保时用来认「同一种牌」（同花色同点数的牌正好 4 张）。4 张大王里有一张带皇冠的是皇牌，出牌时就是普通大王。

**一盘的流程。**
1. 发牌：168 张从发牌起点开始一张张发，起点和它后面两个座位 34 张，另外两个 33 张。第 1 盘起点随机，之后是上一盘的皇帝。
2. 抢独（开房选项）：发完牌所有人同时有 5 秒可以按「抢独」，要一个人打四个（明独）。多人按时，拿皇牌的人优先，否则从他的上家往上家数最近的那个；抢成的人拿走皇牌直接当明独皇帝。
3. 登基：拿皇牌的人选登基或让位。能登基要手里有一种「同花色同点数恰好 3 张或 4 张」的普通牌（2 也算，王不算）。让位就把皇牌交给上家（座位 −1），接到的人再选。转一整圈 5 个人都让位：从最初拿皇牌的人起按座位往下数，第一个有「恰好 3 张」的人必须登基；都没有就重新发牌（不算一盘）。
4. 叫保：皇帝选一种能叫的牌。3 张的亮出 3 张，第 4 张在谁手里谁是侍卫；4 张的可以暗独（只亮 3 张，别人以为有侍卫）或明独（亮 4 张，公开一打四）。
5. 表态（明独跳过）：除皇帝外 4 人同时选，选完或时间到一起公布。侍卫选明保（公开身份，本盘 ×2）或暗保；其他人选造反或不造反。侍卫暗保时，2 人以上造反就成功（侍卫被揭开，暗独则揭开独保，本盘 ×2）；只有 1 人造反算失败（不加倍，他自己被公开是革命党）。明保同时有人造反也只 ×2。
6. 出牌：皇帝先出。一套牌是同点数的普通牌若干张，可以再挂任意张王；或者只出王；没有顺子，2 不能和别的点数一起出。要压住上一套：张数相同，两套各自从大到小排，每一张都严格大于对面那张。轮到的人可以压或不要；不要了以后有人再出，下一圈还能接着压。其他手里还有牌的人都不要，这一轮结束，最后出牌的人随便出下一套；他已经出完的话，由他后面第一个还有牌的人接着出（接风）。
7. 走科：出完的先后就是名次（头科、二科……）。侍卫打出那第 4 张保牌，身份自动公开；暗独的皇帝把 4 张保牌都打出来，独保自动公开（只公开，不改倍数）。
8. 一方的人都走完这盘就结束：二打三是皇帝和侍卫都走完、或 3 个革命党都走完；暗独是皇帝走完或 2 个革命党走完；明独是任何一个人走完。

**计分。** 二打三：侍卫 = 6 −（皇帝名次 + 侍卫名次），皇帝是侍卫的 2 倍，每个革命党是侍卫的相反数；明保或造反成功 ×2。结束时还没走科的人排在后面（同一方，先后不影响）。暗独：皇帝头科 +12、二科 0、更差 −12，另外 4 人各得皇帝的 −1/4；造反成功 ×2。明独：皇帝头科 +24、否则 −24，另外 4 人各 ∓6。每盘加起来都是 0。

## 默认规则表（规则书没写死的地方、开工拍板、全站约定）

| 项目 | 这里的做法 | 出处 |
|---|---|---|
| 牌数 | 168 张（34/34/34/33/33，多拿 1 张的随发牌起点轮换） | 拍板待确认 1 |
| 2 能不能叫保 | 能 | 拍板待确认 2 |
| 逼位 | 转一圈后从 H₀ 起第一个有「恰好 3 张」的人必须登基，都没有就重发；同时有 4 张同花同点的人也不豁免 | 拍板待确认 3、K7 选 A |
| 被逼位的皇帝叫什么 | 他能叫的任何一种都行（叫 4 张也可以独保）；超时叫第一种恰好 3 张 | 规则书没写，按「登基后照常叫保」 |
| 明独时革命党先走科 | 立即结束，皇帝 −24、其余各 +6 | 拍板待确认 4 |
| 侍卫打出保牌 | 自动标记成侍卫（暗独的皇帝打出全部 4 张自动公开独保），倍数不变 | 拍板待确认 5 |
| 表态 | 4 人同时表态，一起公布；侍卫明保时造反的选择照样公布但没效果 | 拍板待确认 6 |
| 发牌起点 | 第 1 盘随机，之后是上一盘的皇帝；重发时不变 | 拍板待确认 7 |
| 憋 6 只剩 6 时 | 能跟牌（张数相同、压得住就行，实际上 6 最小压不住）；自由出牌必须把 6 一次出完；6 不能挂王 | 拍板待确认 8、K5 |
| 叫保有几种能叫 | 皇帝自己选 | 规则书 5.3 |
| 暗独藏哪一张 | 4 张里随机藏一张（从亮出的是哪几副看不出是不是暗独）；暗独皇帝出这种牌时先用亮过的那几张，没亮的那张只在 4 张都出完（或特画打出）时才出现 | 保密需要，不改玩法 |
| 贴牌（开房选项，默认关） | 本盘第 2 次让位起，每次多交 1 张：有 2 交 2，没有交最大的非王牌；同点数几张时系统按「不拆自己的 3/4 张 → 张数多的 → 黑红梅方 → 副数小」自动选；贴牌正面公开、跟着皇牌走，逼位时一起交给被逼的人但不再新贴；重发作废；抢独不贴 | 补充 4.1（V1–V6） |
| 特画（开房选项，默认关） | 叫保后没亮的那张保牌（二打三在侍卫手里，暗独在皇帝手里；明独、抢独没有）当「超级王」（比大王大，按王的规则组合，不能当原点数）；打出就自动公开身份；超时自动出牌时排在最后 | 补充 4.2（V7–V12） |
| 盘数 | 3 / 5 / 8 / 10，默认 5 | 规则书 8.1 |
| 抢独 / 憋 6 / 造反 | 默认关 / 关 / 开 | 规则书 8.1 |
| 人数 | 固定 5 座，最少 1 个真人，空座开局时自动补人机（咕噜一号–四号，带「人机」标签，当侍卫时没有任何别的标记） | 全站约定（覆盖规则书 9.4） |
| 托管 | 连续 2 次超时进托管，**由人机代打**（不是默认动作）；可以取消托管 | 全站约定 |
| 掉线 | 离线 3 秒后由人机代打（不算超时），用原昵称和房间码回来接着打 | 全站约定 |
| 中途退出 | 人机接手座位打完，分数算在原座位上 | 规则书 7.3 |
| 不能登基的人 | 服务器随机等 2–6 秒替他让位（不算超时），界面照样显示「让位」；人机拿到皇牌也随机等 2–6 秒再决定 | 勘误 K6、拍板 |
| 同时选的阶段（抢独、表态） | 选完之前不公开谁选了（状态、事件、版本号都不变，连推送都只发给本人）；倒计时对所有人一样；所有人（含人机）的提交都随机延迟 1–3 秒才生效 | 勘误 K6、拍板 |
| 结算画面 | 15 秒，所有人点「下一盘」或时间到就开下一盘；结束时公开侍卫、是否独保、每人剩下的牌、名次（没走科的显示「未走科」）、得分和倍数原因 | 规则书 9.6、K3 |
| 观战 | 默认只看公开信息；房主打开「观战看手牌」后是上帝视角（所有手牌、侍卫、暗独都能看到）；种子永远不发 | 全站约定 |

## 限时和超时

| 阶段 | 限时 | 超时怎么办 |
|---|---|---|
| 抢独 | 5 秒 | 不抢（不计入超时次数） |
| 登基 / 让位 | 10 秒 | 让位（贴牌照样贴）；逼位是自动的，不用等 |
| 叫保 | 15 秒 | 叫第一种「恰好 3 张」（按点数从小到大、黑红梅方）；没有就叫第一种 4 张、暗独 |
| 表态 | 10 秒 | 侍卫暗保、其他人不造反（超时次数在公布时一起算） |
| 出牌 | 25 秒 | 自由出牌：最小的一张普通牌（憋 6 时手里还有别的牌就跳过 6；只剩 6 就一次出完；只剩王出小王，没小王出大王，特画最后）；跟牌：不要 |
| 一盘结算 | 15 秒 | 下一盘（不计入超时次数） |

连续 2 次超时进托管。等候房间里的文案和这张表一致。

## 隐藏信息

全部只经过 `redactGameForViewer(state, viewerId)` 下发（规则书 9.3）：

- 别人的手牌只给张数（一盘结算时公开剩下的牌）；
- `guard`（侍卫是谁）只发给侍卫本人，**皇帝也不发**；揭开后（明保、造反成功、打出保牌 / 特画）或结算时公开；
- `mode` 是暗独时只发给皇帝本人，别人看到的是 `pair`，直到揭开；
- 抢独谁按了不发（只公开抢成的 `grabber`）；
- 表态公布前别人的选择、连「选没选」都不发；公布后按 3.6：明保、造反成功公开所有选择，造反失败只公开那个造反的人，暗保没被揭开的侍卫对外显示「不造反」；
- 种子、随机数状态、操作记录、超时名单（`seed` / `rng` / `log` / `timedOut`）永远不发；
- 事件（`events` / `history`）全部是公开的，所以事件里从来不放隐藏信息。

验证：单元测试按每个视角检查；随机对局每一步检查「任一座位的视角去掉自己的私有部分后和公开视角一模一样」；`spy.test.ts` 和 `scripts/spy.mjs` 连真实服务器抓包。

## 对外接口（界面、人机、教程、验收用）

从 `@baohuang/game` 导入。

### 牌 id

字符串，带副数 0–3：普通牌 `${副}${花色}${点数}`（花色 S 黑桃 / H 红桃 / C 梅花 / D 方块，点数 6 7 8 9 10 J Q K A 2，例 `2H9`、`0S10`、`3DA`、`1C2`）；小王 `${副}JS`，大王 `${副}JB`；**皇牌是 `0JB`**（`HUANG_ID`、`isHuang`）。别人的手牌下发时是空数组，张数看 `handCount`。工具：`rankOf`（6–15，16 小王，17 大王）、`suitOf`、`kindOf`（「花色+点数」如 `H9`）、`cardName`（「红桃 9」）、`kindName`、`sortCards`、`canCallTypes(hand)`、`canAscend`、`mustAscend`、`parseCards("H9 H9 小 大 皇")`。特画按 `effRank(card, { tehua })` 算成 18。

### 引擎

| 函数 | 说明 |
|---|---|
| `createGame(players, seed, options?)` | players 是 5 个 `{ id, name, bot? }`（会随机排座位）；options 见下 |
| `applyCommand(state, playerId, command)` | 不改输入，返回新状态；不合法抛中文错误 |
| `legalCommands(state, playerId)` | 这位现在能发的操作（对 redact 之后的状态也能用）；出牌列出每种「点数 × 张数 × 挂几张王」一种 |
| `pendingSeats(state)` | 现在要做决定的座位（服务端用完整状态算） |
| `redactGameForViewer(state, viewerId)` / `spectatorGodView(state)` | 给某个座位看的状态 / 观战上帝视角 |
| `timeoutTurn(state, seats?)` / `timeoutCommand(state, seat)` | 超时默认动作 |
| `botCommand(redactedState, seat)` | 人机（**只吃 redact 后的状态**）；现在是占位 |
| `stepSeconds(state)`、`timerKey(state)`、`simultaneousStage(state)` | 限时、计时 key（同时选的阶段里单个人的选择不改它）、是不是同时选的阶段 |
| `parseSet`、`beats`、`checkPlay(hand, cards, topRanks, setRules(state))`、`playOptions` | 一套牌的识别、比较、合法性、出法列举（界面的「提示」、选牌校验可以直接用） |
| `scoreHand(state)`、`chooseTieCard(hand, carried)`、`declareChoices(state, seat)` | 计分、贴牌选哪张、表态能选什么 |

开房选项 `GameOptions`：`{ hands: 3|5|8|10, grabSolo, bie6, rebel, tieCard, tehua }`，默认 `{ hands: 5, grabSolo: false, bie6: false, rebel: true, tieCard: false, tehua: false }`。

操作 `GameCommand`：`GRAB { grab }`、`ASCEND`、`ABDICATE`、`CALL { suit, rank, mode: "pair" | "darkSolo" | "openSolo" }`、`DECLARE { choice: "openGuard" | "darkGuard" | "rebel" | "noRebel" }`、`PLAY { cardIds }`、`PASS`、`READY`、`AUTO { on }`。

状态里界面要用的字段（详细注释见 `packages/game/src/types.ts`，每个字段都写了谁能看到）：`stage`（grab / abdicate / call / declare / playing / handEnd）、`turn`（同时选的阶段是 -1）、`handNo`、`config`、`dealStart`、`huangHolder0` / `huangHolder` / `abdications` / `tiePile`、`forced`、`grabber`、`emperor`、`guardCard` / `shownCards` / `tehua`、`guard`、`mode`、`declaresRevealed` / `doubled` / `doubleReason` / `guardRevealed` / `revealReason` / `rebelFailed`、`lastPlay`（`{ seat, cards, ranks }`，要压的那套）/ `passes` / `table`（每个座位这一轮的出牌或「不要」）/ `played`、`finishOrder`、`summary`（一盘结算，见 `HandSummary`）、`ready`、`finalResult`（整场赢家，可以并列）、`events`（这一步的事件）/ `history`（最近 60 条）、`version`（公开变化 +1，界面据此触发动画）。玩家：`name`、`bot`、`auto`、`score`、`handDelta`、`hand` / `handCount`、`grab` / `declare`（只有自己的）、`declarePublic`（公布后大家看到的表态）、`place`（走科名次）。

事件 `BaohuangEvent`（全部公开）：`HandStarted`、`Dealt`、`GrabResolved`、`Ascended`、`Abdicated`（含贴牌）、`Forced`（逼位）、`Redeal`、`GuardCalled`（亮出的牌）、`DeclaresRevealed`、`Played`、`Passed`、`GuardRevealed`、`Finished`（走科）、`TrickWon`（一轮结束，`jiefeng` 接风）、`HandEnded`、`TimedOut`、`AutoChanged`、`GameEnded`。

房间快照 `LobbyRoomSnapshot` 比模板多一个 `queued`：只发给自己，是自己已经提交、还在随机延迟里的抢独 / 表态（界面显示「已选，等待公布」）。同时选的阶段 `turnRemainingMs` 对所有人一样。

### 预览局面工厂（`packages/game/src/scenes.ts`）

- `scene(name)` → `{ state, viewer, offline?, remainingMs?, queued?, spectator?, god?, note }`；`SCENE_NAMES` 列出全部名字：`start`、`start-cannot`、`start-other`、`abdicating`、`tie-abdicating`、`forced`、`forced-me`、`call`、`call-other`、`declare-guard`、`declare-rebel`、`declare-waiting`、`declare-queued`、`declare-emperor`、`reveal-open`、`reveal-rebel`、`reveal-fail`、`reveal-none`、`reveal-darksolo`、`dark-solo`、`dark-solo-other`、`open-solo`、`grab`、`grab-won`、`playing`、`lead`、`follow`、`jiefeng`、`guard-revealed`、`tehua`、`tehua-played`、`bie6`、`few-cards`、`max-hand`、`hand-end`、`hand-end-solo`、`game-end`（并列）、`offline`、`timeout`、`spectate-god`、`spectate`。
- `sceneSnapshot(name, { viewer?, offline?, remainingMs?, queued?, god? })` → 直接是服务器发给网页的 `LobbyRoomSnapshot`（成员是非人机的座位，socket id 是 `sock-<座位>`，座位 0 是房主）。预览页渲染真正的 GameBoard 时把 `socket.id` 冒充成 `sock-<viewer>`。
- `createScene(spec)` 按参数造任意局面：`{ options?, config?, names?, bots?（默认 [3, 4]）, deal?, dealStart?, handNo?, scores?, steps?, seed? }`。`deal` 可以是 `buildDeal` 的约束（完整 168 张）或者直接给 5 手牌（教程可以每人几张，不要求 168 张）。`steps` 用真引擎一步步走，所以局面一定是规则能走到的：
  `"2 abdicate"`、`"0 ascend"`、`"0 call H9 pair"`（pair / dark / open）、`"1 declare rebel"`（也可以写 明保 / 暗保 / 造反 / 不造反）、`"3 grab"` / `"3 nograb"`、`"0 play 9 9 小"`（点数、`H9` 这样的花色点数、小 / 大 / 皇 / 特、或牌 id；同点数先用不是保牌的那几张）、`"4 pass"`、`"0 ready"`、`"2 auto on"`、`"timeout"`（所有该决定的人超时）、`"timeout 1 3"`、`"simple 7"`（按简单打法走 7 步）、`"until handEnd"`。场景里玩家 id 是 `p0`…`p4`，下标就是座位。
- `buildDeal({ dealStart?, sizes?, must?, noCall?, noThree?, noTwo?, avoidRanks?, seed? })`：造一副满足约束的完整发牌；`toSnapshot(state, options)`：任意状态包成快照；`runStep`、`pickCards`、`simpleCommand`、`dealSizes`。

例：教程第一步「你拿到皇牌、有三张红桃 7」可以写成
`createScene({ names: ["你", "阿福", "小翠", "咕噜一号", "咕噜二号"], deal: ["皇 H7 H7 H7 S8 S8 大", "H7 S9 S10", "SJ SQ SK", "SA D6 D7", "D8 D9 D10"] })`。

## 服务器

- `room:create { name, options }`、`room:join { name, code | roomId, spectate? }`、`room:start`（不满 5 人时空座补人机）、`game:command`、`room:rematch`、`room:options`、`room:access`、`room:sit` / `room:stand`、`room:kick`、`room:dissolve`、`room:chat`、语音、`lobby:get`、`admin:dissolve`、`admin:kick-session`（挤登录）——和全站其他游戏一样。
- 人机、托管、离线的人由服务器代打（`botCommand`，只给它这个座位自己看得到的状态）：出牌 0.6–1.6 秒；登基阶段 2–6 秒；抢独、表态 1–3 秒；离线至少等 3 秒。
- 每局的种子和动作序列写进 `logs/games.jsonl`。端口和密钥（PORT、ADMIN_TOKEN、TURN_*、WEB_ORIGINS）只从环境变量读。
- 测试钩子 `testHooks.loadScene(code, state)`：把房间的对局换成预览局面工厂造的局面（座位 id 和名字换成房间的）。
