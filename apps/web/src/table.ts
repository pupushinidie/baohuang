/**
 * 牌桌用的小工具：倒计时。
 */
import { useEffect, useState } from "react";
import type { LobbyRoomSnapshot } from "@baohuang/game";

/** 当前这一步还剩几秒（服务器给的 turnRemainingMs 按本地时钟往下数）。 */
export function useCountdown(room: LobbyRoomSnapshot): number | null {
  const [now, setNow] = useState(Date.now());
  const [anchor, setAnchor] = useState({ at: Date.now(), ms: room.turnRemainingMs });
  useEffect(() => setAnchor({ at: Date.now(), ms: room.turnRemainingMs }), [room]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  if (anchor.ms === undefined) return null;
  return Math.max(0, Math.ceil((anchor.ms - Math.max(0, now - anchor.at)) / 1000));
}
