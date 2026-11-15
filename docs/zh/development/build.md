# 构建与打包

同一套代码能产出四种形态：带本地服务的浏览器版、独立服务、Electron 桌面版，以及另一个仓库里的静态在线版。本页列出命令，以及改代码时真正需要区别对待的地方。

## 环境要求

- Node.js 22 或更新版本，配 npm。
- 批量 CLI 依赖 Node 的 TypeScript 支持。Node 22.6–23.5 需要加 `--experimental-strip-types`；Node 23.6 起默认开启，Node 26 可以直接跑 `.ts` 入口。
- 桌面打包默认面向 Windows x64（见 `electron-builder.yml`）；服务端本身在任何能跑 Node 的系统上都行。

## 命令

| 命令 | 作用 | 产物 |
| --- | --- | --- |
| `npm run dev` | 起 Vite 开发服务并挂上 API 中间件，地址 `127.0.0.1:5173`（被占用时顺延）。 | 无 |
| `npm run build` | 类型检查并构建前端。 | `dist/` |
| `npm run preview` | 用同一个 API 中间件预览构建结果。 | — |
| `npm run server:build` | 用 esbuild 打包 `server/app.ts` 与 `server/standalone.ts`。 | `dist-server/app.mjs`、`dist-server/standalone.mjs` |
| `npm start` | 运行打包后的独立服务。 | `127.0.0.1:3921` |
| `npm run desktop` | 构建、打包服务并打开 Electron。 | 窗口 |
| `npm run dist:win` | 生成 NSIS 安装包和便携版。 | `release/` |
| `npm run dist:dir` | 生成未打包目录，快速验证桌面版。 | `release/win-unpacked/` |
| `npm run docker:up` | 构建并运行容器，挂载本地目录。 | `http://127.0.0.1:3921` |
| `npm run docs:dev` | 文档站开发服务，按站点根路径访问（`DOCS_BASE=/`）。 | `127.0.0.1:5174` |
| `npm run docs:build` | 构建文档站，死链会让构建失败。 | `docs/.vitepress/dist/` |

## 本地开发

```bash:no-line-numbers
npm install
npm run dev
```

不需要另起进程：`server/plugin.ts` 把 `createMangaHandler` 挂成 Vite 中间件，`configureServer` 和 `configurePreviewServer` 都覆盖了。所以 `/api/library` 和页面在同一个事件循环里处理，服务端的 `console.log` 就打在跑 Vite 的那个终端里。

前端由 Vite 从 `src/` 提供；服务端按仓库根目录读写 `raw/` 和 `data/`。

## 生产构建

```bash:no-line-numbers
npm run build
npm run server:build
npm start
```

`npm run build` 先跑 `tsc -b`，有类型错误就直接失败。`server:build` 以 `platform: node`、`format: esm`、`target: node20` 打包，并注入 `createRequire` 头，因为 `pngjs` 和 `jpeg-js` 内部仍会调用 `require`。

`npm start` 要求 `dist/` 已存在，否则 `server/standalone.ts` 会以 `CLI_MISSING_STATIC_DIR` 退出。配置全部走环境变量：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 监听地址。仅在需要局域网访问时设为 `0.0.0.0`；本服务没有登录鉴权。 |
| `PORT` | `3921` | 监听端口。 |
| `RAW_DIR` | `<cwd>/raw` | 漫画图片目录。 |
| `DATA_DIR` | `<cwd>/data` | JSON 数据目录。 |
| `EXPORT_DIR` | `<cwd>/exports` | 生成文件目录。 |
| `STATIC_DIR` | `<cwd>/dist` | 构建后的前端。 |
| `MANGA_LOCALE` | 自动 | 界面语言提示：`en`、`zh`、`ja`。 |
| `LOG_LEVEL` | `info` | `debug`、`info`、`warn`、`error`。 |

## 桌面版

```bash:no-line-numbers
npm run desktop
npm run dist:win
```

`electron/main.cjs` 在进程内加载 `dist-server/app.mjs`，提供 `dist/` 并打开窗口。数据不会打进安装包：首次启动会要求选择图库目录，并记在 `%APPDATA%/manga-memo/config.json`，`raw/`、`data/`、`exports/` 仍留在你自己的目录里。

打包配置在 `electron-builder.yml`。只会打包 `dist/`、`dist-server/`、`electron/` 和 `package.json`；服务端已经把自己的依赖打进去了，因此不附带 `node_modules`。

## Docker

```bash:no-line-numbers
docker compose up --build
```

容器运行 `dist-server/standalone.mjs`，从宿主机挂载 `raw/`、`data/`、`exports/`。它是给本机用的：没有账号也没有鉴权，不要把端口暴露到公网。

## 静态在线版

静态在线版是另一个项目：`https://github.com/PayayaKamo/KomaYomi-online`，只保留浏览器能跑的那部分。它共用页面格式和工程文件读取，但无法扫描目录、做分格检测、加载插件或连接 WebDAV，因为这些都离不开服务端进程。在那里保存的内容放在 IndexedDB。

新增功能时先想清楚它属于哪种形态：

| 改动 | 本地服务版 | 静态在线版 |
| --- | --- | --- |
| 页面文档新增字段 | 改 `shared/` 和服务端规范化逻辑。 | 只要逻辑在 `shared/` 里就能用。 |
| 新增检测器或插件钩子 | `server/detect.ts`、`server/plugins.ts`。 | 不可用。 |
| 新增对话框或视图 | `src/components/`。 | 只调用现有 API 的话通常可移植。 |
| 文件系统、进程或网络访问 | 仅服务端。 | 不可用。 |

## 更新检测基线

```bash:no-line-numbers
node scripts/manga-cli.ts regress
node scripts/manga-cli.ts regress --update
```

第一条命令把当前分格数量与 `scripts/detect-baseline.json` 对比；`--update` 重写基线。提交前先看 diff——更新基线等于承诺新数量是对的。

## 提 PR 之前

```bash:no-line-numbers
npm run lint
npm run typecheck
npm test
npm run i18n:scan
npm run docs:build
```

`i18n:scan` 默认非严格；CI 会把 `src/` 里新增的写死中文当作失败。`docs:build` 遇到死链会失败，这是发现三语页面改名遗漏最省事的办法。
