/**
 * 像素扑克牌（和掼蛋、德州、斗地主共用的牌面，41×57，见 public/cards-pixel/）。只按整数倍放大。
 * 保皇的牌 id 带副数（见 packages/game/src/cards.ts）：0H9、3S10、1JS（小王）、2JB（大王）、0JB（皇牌）。
 */
import type { CSSProperties, HTMLAttributes } from "react";
import { cardName, isHuang, isJoker, rankOf, suitOf, type CardId } from "@baohuang/game";

export const CARD_W = 41;
export const CARD_H = 57;

const BASE = `${import.meta.env.BASE_URL}cards-pixel/`;
const ART = `${import.meta.env.BASE_URL}art/`;

/** 隐藏的牌（牌背）。 */
export const CARD_BACK = "back";

/** 牌面图片：黑桃 A 是 Sa.png、红桃 10 是 H10.png、梅花 2 是 C2.png；大王 J1（彩色）、小王 J2（黑白）；皇牌用美术的 card-huang.png；牌背 back.png。 */
export function cardImage(card: CardId): string {
  if (card === CARD_BACK) return `${BASE}back.png`;
  if (isHuang(card)) return `${ART}card-huang.png`;
  if (isJoker(card)) return `${BASE}${rankOf(card) === 17 ? "J1" : "J2"}.png`;
  const rank = rankOf(card);
  const label = ({ 11: "j", 12: "q", 13: "k", 14: "a", 15: "2" } as Record<number, string>)[rank] ?? String(rank);
  return `${BASE}${suitOf(card)}${label}.png`;
}

interface CardViewProps extends HTMLAttributes<HTMLSpanElement> {
  readonly card: CardId;
  readonly scale: number;
}

/** 一张牌。外层 span 定尺寸（41×57 的整数倍），样式由 className 加（选中、变暗、角标……）。 */
export function CardView({ card, scale, className, style, ...rest }: CardViewProps) {
  const size: CSSProperties = { width: CARD_W * scale, height: CARD_H * scale, ...style };
  const name = card === CARD_BACK ? "牌背" : cardName(card);
  return (
    <span className={["bh-card", className].filter(Boolean).join(" ")} style={size} title={name} {...rest}>
      <img src={cardImage(card)} alt={name} draggable={false} width={CARD_W * scale} height={CARD_H * scale} />
    </span>
  );
}

/** 一排叠着的牌。step 是相邻两张错开的像素。 */
export function CardRow({ cards, scale, step, className }: {
  readonly cards: readonly CardId[];
  readonly scale: number;
  readonly step?: number;
  readonly className?: string;
}) {
  const gap = step ?? Math.round(CARD_W * scale * 0.42);
  return (
    <span className={["bh-card-row", className].filter(Boolean).join(" ")}>
      {cards.map((card, index) => (
        <CardView key={`${card}-${index}`} card={card} scale={scale} style={index > 0 ? { marginLeft: gap - CARD_W * scale } : undefined} />
      ))}
    </span>
  );
}
