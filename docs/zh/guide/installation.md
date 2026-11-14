# 安装与运行

KomaYomi 既可以作为**由本地 Node 服务器支撑的浏览器应用**运行，也可以作为 **Electron 桌面窗口**运行。两者使用同一套服务器代码和同一个数据目录。

## 环境要求

- **Node.js 20 或更高版本**（服务器 bundle 以 Node 20 为目标；仓库的开发环境使用 Node 22+）。
- npm（随 Node 一起提供）。
- 可选：Electron 相关依赖会随 `npm install` 一起安装。

没有托管服务，也不需要账号。应用只监听 `127.0.0.1`。

## 安装

在仓库根目录执行：

```bash
npm install
```

## 以开发模式运行

```bash
npm run dev
```

这会在 `http://127.0.0.1:5173` 上启动 Vite（如果 5173 被占用，端口可能会变化）。API 由 Vite 中间件插件提供，因此不需要启动第二个进程。

## 以桌面应用运行

```bash
npm run desktop
```

该命令做三件事：

1. `npm run build` —— 类型检查并把前端构建到 `dist/`。
2. `npm run server:build` —— 用 esbuild 把服务器打包为 `dist-server/app.mjs`。
3. `electron .` —— 打开一个窗口，从本地 HTTP 服务器加载打包好的静态文件。

桌面版数据目录：

- 从源码运行（`npm run desktop`）时，使用仓库文件夹，`raw/`、`data/` 和 `exports/` 与代码放在一起。
- 打包版默认使用 Electron `userData` 目录内的 `library` 文件夹，并在首次启动时让你选择文件夹。
- `Ctrl+Shift+D` 可切换数据目录（需要重启）。
- 环境变量 `MANGA_DATA_DIR` 会覆盖数据目录。
- `MANGA_PORT` 固定内部端口；否则会选择一个空闲端。

<Badge type="warning" text="计划中" /> 可分发安装程序（`.exe` / `.dmg`）尚未配置。`electron-builder` 作为开发依赖存在，但仓库中没有 `build` 配置，也没有打包脚本。

## 构建产物

| 命令 | 产物 | 用途 |
| --- | --- | --- |
| `npm run build` | `dist/` | 静态前端。 |
| `npm run server:build` | `dist-server/app.mjs` | Electron 使用的打包 Node 服务器。 |
| `npm run preview` | — | 用 Vite preview 提供构建后的前端。API 中间件是开发服务器的特性；若要访问 API，请使用桌面应用或 `npm run dev`。 |
| `npm run typecheck` | — | TypeScript 项目检查。 |

## 数据目录结构

```text
raw/                       # your images (gitignored)
  <volume>/<language>/<chapter>/01.jpg
data/
  pages/<volume>/<chapter>/0.json     # one page JSON, 0-based index
  templates/                          # panel templates and export templates
  presets/                            # alignment presets
  layouts/*.json                      # declarative layout templates
  library.json                        # manual language-directory mapping
  cache/thumbs/                       # thumbnail cache (safe to delete)
  backups/                            # project import backups (gitignored)
exports/                   # generated HTML, PNG, backups, .mnproj (gitignored)
```

`npm run dev` 通过 `/raw/...` 提供图片，通过 `/exports/...` 提供生成的文件；这两个文件夹都不会被暴露为静态目录列表。

## 端口与主机

- 开发界面：`127.0.0.1:5173`。
- 文档站点（本站）：从 `docs/` 启动时为 `127.0.0.1:5174`。
- Electron 窗口连接一个临时的 localhost 端口。

## 首次运行

1. 按 `raw/<volume>/<ja|zh|en>/<chapter>/<pages>` 的结构，至少把一个卷放到 `raw/` 下。
2. 打开应用。侧边栏会列出卷和章。
3. 选择一页。首次打开时该页会被自动检测并保存。
4. 如果某个语言文件夹未被识别，打开卷设置手动映射目录。

命名规则以及扫描器接受的语言别名，请参见[图库](/zh/guide/gallery)。

## 文档站点

文档位于 `docs/`，有自己独立的依赖：

```bash
cd docs
npm install
npm run docs:dev     # http://127.0.0.1:5174
npm run docs:build   # static output in docs/.vitepress/dist
npm run docs:preview # preview the production build
```

在仓库根目录也可以使用 `npm --prefix docs run docs:dev`。
