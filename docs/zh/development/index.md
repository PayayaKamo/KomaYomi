# 二次开发与自定义

这一分区写给想改动 KomaYomi 本身的人：为某本杂志加一个分格识别插件、调整目录扫描规则、发布一套导出样式，或者直接改应用代码。下面每一处协议和字段都对照源码核对过；如果这里和代码对不上，以代码为准。

只想看漫画、做笔记的话，请从[使用指南](/zh/guide/introduction)开始。

## 本分区包含什么

| 页面 | 回答的问题 |
| --- | --- |
| 本页 | 前端、服务端、共享层各管什么，哪些能力只有本地版才有。 |
| [数据格式](/zh/development/data-formats) | JSON 信封、页面文档、`library.json`、`.mnproj`、`.mntpl`、`.mnexp`，以及版本迁移和未知字段规则。 |
| [分格插件](/zh/development/plugins) | 插件的真实协议、可直接运行的例子、怎么试跑、出错时看哪个错误码。 |
| [目录规则](/zh/development/folder-rules) | 占位符、可选段、通配、`ignore`、`extensions`，以及几种常见目录结构的完整写法。 |
| [导出模板](/zh/development/export-templates) | 模板能存哪些字段、完整的 `.mnexp` 示例、怎么套用。 |
| [构建与打包](/zh/development/build) | 开发服务、生产构建、独立服务、Electron、Docker 与静态在线版的差别。 |
| [贡献指南](/zh/development/contributing) | 分支与提交规范、检查命令，以及一个最小改动的完整示例。 |

## 仓库结构

| 路径 | 负责什么 |
| --- | --- |
| `src/` | React 18 前端：图库侧栏、切格工作台、对照阅读、笔记、导出对话框、各类弹窗与多语言文案。 |
| `server/` | Node HTTP API 和全部本地能力：图库扫描、分格检测、布局模板、插件、对齐预设、导出、备份、存储、版本历史。 |
| `shared/` | 前后端共用：领域类型、JSON 信封与迁移、分格排序、Markdown 渲染。 |
| `electron/` | Electron 主进程和数据目录处理。 |
| `scripts/` | 批量 CLI（`manga-cli.ts`）、服务端打包脚本、i18n 扫描、检测基线。 |
| `plugins/` | 可选的分格插件目录；也可以放在 `data/plugins/`。 |
| `docs/` | 当前这个 VitePress 文档站，有独立的 `package.json`。 |
| `raw/`、`data/`、`exports/` | 你的图片、你的 JSON、生成的文件，都不进仓库。 |

## 三层各做什么

### 前端 `src/`

一个由 Vite 构建的 React 单页应用。`src/App.tsx` 负责整体框架：顶栏、侧栏、主舞台、笔记栏和分隔条；具体功能放在 `src/components/`。`src/api.ts` 是唯一和后端通信的地方，所有请求都是对相对路径 `/api/...` 的 `fetch`。因此前端不知道自己是跑在 Vite、独立服务还是 Electron 里。

图库、当前页面文档、已保存的模板这些属于服务端的状态，都通过 `src/api.ts` 读取，再显式写回。正常使用时浏览器里没有本地数据库。

### 服务端 `server/`

只有一个路由函数：`server/app.ts` 里的 `createMangaHandler({ rootDir })` 根据 `pathname` 和 `method` 分派到各领域模块。同一个 handler 跑在三种宿主里：

| 宿主 | 入口 | 怎么访问 |
| --- | --- | --- |
| 开发与预览 | `server/plugin.ts` | 挂成 Vite 中间件，地址 `127.0.0.1:5173`，不需要另起进程。 |
| 独立服务 / Docker | `server/standalone.ts` | `npm start`，端口 `3921`，可用 `RAW_DIR`、`DATA_DIR`、`EXPORT_DIR` 改目录。 |
| 桌面版 | `dist-server/app.mjs` | `scripts/build-server.mjs` 打包后由 `electron/main.cjs` 加载。 |

模块划分刻意做窄：`library.ts` 扫描并组织页面，`dirRules.ts` 把路径模式变成页面记录，`detect.ts` 是 XY-cut 检测器，`plugins.ts` 运行插件，`layouts.ts` 展开声明式网格，`storage.ts` 负责页面读写，`schemaStore.ts` 负责迁移与原子写入，`export.ts` 与 `exportDocx.ts` 生成文档，`project.ts` 和 `backup.ts` 处理工程包与 ZIP。

### 共享层 `shared/`

`shared/` 不能依赖 Node 专有 API，也不能碰 DOM，否则总有一端用不了。

| 文件 | 内容 |
| --- | --- |
| `types.ts` | `PageDoc`、`Panel`、`Note`、`Annotation`、阅读方向、导出配置、图库类型。 |
| `format.ts` | `$schema` / `schemaVersion` 信封、各格式校验、迁移分派、`preserveUnknown`。 |
| `migrations.ts` | 纯函数式的 v0 → v1 迁移，不读写磁盘。 |
| `panelOrder.ts` | 显示、导出和 CLI 共用的阅读顺序与分组顺序。 |
| `markdown.ts` | Markdown 渲染，原始 HTML 会被转义。 |
| `schemas/*.json` | 便于阅读的 JSON Schema 镜像；运行时以代码里的校验器为准。 |

## 一次请求怎么走

**读取图库。** 侧栏请求 `GET /api/library`。`server/app.ts` 收到后交给 `server/library.ts`：读 `data/library.json`，用 `server/dirRules.ts` 解析规则，遍历 `raw/`（或映射后的远端目录），按 卷 → 章 → 页 分组，最后返回 JSON。整个过程不写盘。

**保存页面。** 工作台用 `PUT /api/page` 提交整份页面文档。`server/app.ts` 先校验基本结构，然后由 `server/storage.ts` 的 `writePageDoc` 依次做五件事：

1. 文件来自更新版本时拒绝写入（`409`，`ERR_SCHEMA_TOO_NEW`）；
2. 规范化矩形、笔记、偏移和 id；
3. 用 `preserveUnknown` 把上一版里的未知字段合并回来；
4. 经 `server/schemaStore.ts` 原子写入；
5. 除非调用方要求跳过，否则记录一份版本快照。

**检测分格。** `POST /api/detect` 先找绑定到该页、该章或该卷的布局模板，再找第一个匹配的插件，最后才用内建检测器。结果会和 `detectSource`、`detectorVersion` 一起写回去，方便以后判断这些格框是谁给的。

## 只有本地版才有的能力

桌面版和本地服务版能读文件、能起进程，所以下面这些能力静态在线版没有：

| 能力 | 本地网页 / 桌面版 | 静态在线版 |
| --- | --- | --- |
| 扫描 `raw/` 下的目录 | 有 | 没有，浏览器无法遍历目录树。 |
| 自动分格检测 | 有 | 尚未移植。 |
| 布局模板与插件 | 有 | 没有，两者都跑在服务端进程里。 |
| WebDAV / 网络存储与图片缓存 | 有 | 没有。 |
| 备份 ZIP、工程导入导出 | 有 | 能打开工程文件，没有目录备份。 |
| 数据存在哪 | 图片旁边的 `data/` | 浏览器的 IndexedDB |

静态在线版是另一个仓库，仍在开发中：`https://github.com/PayayaKamo/KomaYomi-online`。本仓库只构建本地版。共享与不共享的边界见[构建与打包](/zh/development/build#静态在线版)。

## 几条约定

- 服务端是纯 ESM TypeScript，开发时由 Node 的类型剥离直接运行；import 要带 `.ts` 后缀。
- 没有数据库。所有持久化内容都是 JSON 文件，写入是原子的。
- 面向用户的提示放在 `server/messages/catalog.ts`，前端文案放在 `src/i18n/`。在组件里写死中文会被 `npm run i18n:scan` 判为问题。
- 文档站三语同构。新增页面要同时有 `docs/<page>.md`、`docs/zh/<page>.md`、`docs/ja/<page>.md`，并在 `docs/.vitepress/config.mts` 里补上导航和侧栏。

## 从哪里下手

- 改页面在磁盘上怎么找：看[目录规则](/zh/development/folder-rules)。
- 给某本杂志换检测方式：看[分格插件](/zh/development/plugins)。
- 写工具读写 KomaYomi 数据：看[数据格式](/zh/development/data-formats)。
- 直接改应用本身：看[贡献指南](/zh/development/contributing)。
