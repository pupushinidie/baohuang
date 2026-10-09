# 保皇

山东民间五人扑克的网页联机版：4 副牌去掉 3、4、5 共 168 张，拿皇牌的人当皇帝，亮出三张同花同点的牌，第 4 张在谁手里谁就是侍卫（只有他自己知道）。皇帝和侍卫二打三，比谁先出完。固定 5 座，最少 1 个真人就能开，空座开局时由人机补位。线上路径 /baohuang（还没上线）。

规则书：`~/Desktop/游戏规则/保皇.md`，补充和勘误：`~/Desktop/游戏规则/保皇-补充.md`。

> 脚手架从斗地主（doudizhu @ 468d826）复制，正在写规则引擎。本文件随引擎完成补全。

常用命令：`npm run dev`（服务 3020、网页 5291；另起一套用 `SERVER_PORT=… WEB_PORT=… npm run dev`）、`npm test`、`npm run typecheck`、`BASE_PATH=/baohuang/ npm run build`。
