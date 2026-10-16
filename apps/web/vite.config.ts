import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dayTheme } from "./day-theme";
import { palette } from "./day-palette";
import { gmPreload } from "./gm-preload-plugin";

// 端口从环境变量读（默认是分配给保皇的 5291 / 3020），这样别人能另起一套服务不撞端口：
//   WEB_PORT=5391 SERVER_PORT=3120 npm run dev
const WEB_PORT = Number(process.env.WEB_PORT ?? 5291);
const SERVER_PORT = Number(process.env.SERVER_PORT ?? 3020);
const SERVER = `http://localhost:${SERVER_PORT}`;

export default defineConfig({
  // 部署在子路径时用 BASE_PATH 指定，例如 BASE_PATH=/baohuang/ npm run build。
  base: process.env.BASE_PATH ?? "/",
  plugins: [react(), dayTheme(palette), gmPreload()],
  server: {
    port: WEB_PORT,
    strictPort: true,
    proxy: {
      "/socket.io": { target: SERVER, ws: true },
      "/health": SERVER
    }
  }
});
