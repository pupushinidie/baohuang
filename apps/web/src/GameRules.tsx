import { useEffect, useState } from "react";
import { parseCards, type CardId } from "@baohuang/game";
import { CardRow } from "./cards.js";

/** 示意牌：一套牌的几种样子（引擎阶段写的初版，界面阶段可以重排）。 */
const EXAMPLES: { label: string; cards: CardId[] }[] = [
  { label: "三张 8", cards: parseCards("S8 H8 C8") },
  { label: "9 挂小王", cards: parseCards("S9 H9 小") },
  { label: "只出王", cards: parseCards("大 小") },
  { label: "叫保：三张红桃 9", cards: parseCards("H9 H9 H9") },
];

/** 规则说明：一个按钮，点开是像素弹窗。用自己的话写，不照搬别人的规则书。 */
function GameRules() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button className="quiet-button bh-rules-button" type="button" aria-expanded={open} onClick={() => setOpen(true)}>规则</button>
      {open && (
        <div className="gm-modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <section className="gm-panel bh-rules" role="dialog" aria-modal="true" aria-labelledby="bh-rules-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="bh-rules-title">保皇怎么打</h2>
            <div className="game-rules-block">
              <h3>谁和谁一伙</h3>
              <p>5 个人、4 副牌（去掉 3、4、5，共 168 张）。每盘有一个<b>皇帝</b>和一个<b>侍卫</b>（保皇派），另外 3 个人是<b>革命党</b>。皇帝是谁大家都知道；侍卫是谁一开始只有侍卫自己知道，连皇帝也不知道。按名次给每个人算分，打满约定的盘数，个人累计分最高的人赢。</p>
            </div>
            <div className="game-rules-block">
              <h3>一盘的流程</h3>
              <ol>
                <li><b>登基</b>：拿到皇牌（带皇冠的大王）的人可以登基，也可以让位给上家。登基要手里有「同花色同点数恰好 3 张或 4 张」的牌。转一圈都没人登基，就从最先拿皇牌的人起，第一个有恰好 3 张的人必须登基；都没有就重新发牌。</li>
                <li><b>叫保</b>：皇帝亮出 3 张同花色同点数的牌（比如三张红桃 9），第 4 张在谁手里谁就是侍卫。皇帝有 4 张时可以一个人打四个（独保）：只亮 3 张是暗独，亮 4 张是明独。</li>
                <li><b>表态</b>：其他 4 人同时选，选完一起公布。侍卫选明保（公开身份，本盘 ×2）或暗保；其他人选造反或不造反——2 人以上造反就成功（侍卫被揭开，本盘 ×2），只有 1 个人造反算失败，他自己暴露是革命党。最多 ×2。</li>
                <li><b>出牌</b>：皇帝先出。之后轮流出更大的同张数的牌，或者不要；不要了下一圈还能接着出。其他还有牌的人都不要时，最后出牌的人重新随便出。最后一手打完就「走科」；他这一手没人压的话，由他后面第一个还有牌的人接着出（接风）。</li>
                <li>侍卫打出那第 4 张保牌时，身份自动公开（倍数不变）。</li>
              </ol>
            </div>
            <div className="game-rules-block">
              <h3>一套牌和比大小</h3>
              <p>一套牌是同点数的普通牌若干张，可以再挂任意张王；或者只出王。没有顺子，2 不能和别的点数一起出。点数：6 &lt; 7 &lt; … &lt; A &lt; 2 &lt; 小王 &lt; 大王（皇牌就是大王），花色不分大小。</p>
              <p>要压住上一套：<b>张数相同</b>，两套各自从大到小排，<b>每一张都比对面那张大</b>，打平不算。所以「大王 小王」压不住「小王 小王」；挂了大王的一套谁也压不了。</p>
              <div className="bh-rules-examples">
                {EXAMPLES.map((example) => (
                  <span key={example.label}>
                    <CardRow cards={example.cards} scale={1} step={16} />
                    <small>{example.label}</small>
                  </span>
                ))}
              </div>
            </div>
            <div className="game-rules-block">
              <h3>计分</h3>
              <p>一方的人都走完，这盘就结束（暗独：皇帝走了或 2 个革命党走了；明独：任何一个人走了）。二打三时，侍卫得分 = 6 −（皇帝名次 + 侍卫名次），皇帝是侍卫的 2 倍，每个革命党是侍卫的相反数；明保或造反成功再 ×2。暗独：皇帝头科 +12、二科 0、更差 −12（另外 4 人各得相反的四分之一）；明独：皇帝头科 +24，否则 −24。</p>
            </div>
            <div className="game-rules-block">
              <h3>开房选项和本站设定</h3>
              <ul>
                <li>盘数 3 / 5 / 8 / 10；抢独（发完牌 5 秒内抢明独）、憋 6（6 只能留到最后一次出完、不能挂王）、造反、让位贴牌（第 2 次让位起每次多交一张最大的牌）、特画（侍卫那张保牌当比大王还大的超级王）。</li>
                <li>限时：登基 10 秒、叫保 15 秒、表态 10 秒、出牌 25 秒。超时：让位、叫第一种 3 张、暗保 / 不造反；该你先出就出最小的一张，跟牌就不要。连续超时 2 次转托管（人机替你打）；掉线 3 秒后人机代打，用原昵称回来就能接上。</li>
                <li>为了保密：不能登基的人也会等几秒才让位；表态时看不到谁选了，所有人的选择都隔 1–3 秒才生效。</li>
              </ul>
            </div>
            <div className="gm-panel-actions">
              <button className="primary-button" type="button" onClick={() => setOpen(false)}>知道了</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export default GameRules;
