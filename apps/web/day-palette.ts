import type { DayPalette } from "./day-theme";

/**
 * 白天版调色表（保皇；从斗地主继承的夜色蓝灰，界面阶段按金銮殿配色改）。
 * 深色底、面板、按钮 → 白底浅色；深色像素描边保留；浅色字 → 深色字。
 * 牌桌（农家院场景、牌）和桌上的深色小牌子（名牌、底牌倍数条、操作条……）、座位色、按钮里的金色红色这些内容色不换。
 */
export const palette: DayPalette = {
  files: ["app-pixel.css", "baohuang.css"],
  colors: {
    "#0c1120": "#ffffff", // 底色、输入框
    "#101729": "#f8f9fc", // 底色的棋盘纹
    "#16203a": "#f5f7fb", // 面板
    "#1d2a48": "#e8edf5", // 面板 2、分隔线
    "#263759": "#e1e7f1", // 普通按钮、分隔线
    "#18233d": "#fbf3df", // 管理员区
    "#3a2c10": "#fcefc6", // 金色字的底（选中项、状态牌）
    "#04060c": "#1c2638", // 像素描边
    "#3d5482": "#ffffff", // 面板亮边
    "#080c17": "#c9d3e3", // 面板暗边
    "#5a78ad": "#ffffff", // 按钮亮边
    "#0b1120": "#aebad0", // 按钮暗边
    "#1c2d4a": "#f3ead2", // 沙滩图没加载出来时的底色
  },
  text: {
    "#eef3fb": "#1d2433",
    "#93a3bd": "#5b6a86",
    "#5d6f92": "#9aa8c0", // 输入框占位字
  },
  background: {
    "#eef3fb": "#1d2a48", // 左上角标志中间那一条，白底上看不见，换成深蓝
  },
  values: {
    // 不能点的按钮：夜间是压暗，白底上压暗成了泥色，改成褪成浅灰
    "grayscale(0.6) brightness(0.7)": "grayscale(0.85) brightness(1.15)",
  },
  textShadows: {
    // 大标题的投影：夜间是黑色，白底上换成浅金色
    "calc(var(--px) * 2) calc(var(--px) * 2) 0 var(--edge)": "calc(var(--px) * 2) calc(var(--px) * 2) 0 #f0d890",
  },
  keep: [
    "bh-table", "bh-top", "bh-bottom", "bh-multi", "bh-hand-no", "bh-tracker-pop", "bh-plate", "bh-avatar-box", "bh-chip", "bh-role",
    "bh-count", "bh-clock", "bh-alert", "bh-bubble", "bh-open-hand", "bh-open-text", "bh-plays", "bh-play", "bh-play-cards", "bh-play-label", "bh-pass",
    "bh-fx", "bh-center", "bh-actions", "bh-actions-time", "bh-note", "bh-mine", "bh-hand", "bh-banner", "bh-auto-banner", "bh-status-mini", "bh-card",
  ],
  textVarColors: {
    "--gold": "#94650a",
    "--gold-2": "#94650a",
    "--ok": "#1f8a45",
    "--bad": "#d1303f",
  },
};
