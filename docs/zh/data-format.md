# 数据格式

KomaYomi 存储的一切都是纯 JSON 或纯图片文件。本页记录磁盘上的约定，便于你写脚本、做 diff 或手工修复。

## 文件映射

| 路径 | 内容 |
| --- | --- |
| `raw/<volume>/<language>/<chapter>/*.jpg` | 页面图片（输入，永远不会被修改）。 |
| `data/pages/<volume>/<chapter>/<index>.json` | 每页一个页面文档（`index` 从 0 开始）。 |
| `data/templates/panels/<id>.json` | 已保存的分格模板。 |
| `data/templates/export.json` | 已保存的导出模板（一个数组，每项自带信封）。 |
| `data/presets/align/<id>.json` | 已保存的对齐预设。 |
| `data/layouts/<id>.json` | 声明式布局模板。 |
| `data/library.json` | 手动指定的语言目录映射。 |
| `data/cache/thumbs/` | 缩略图缓存（可以安全删除）。 |
| `data/backups/` | 导入的 `.mnproj` 文件的副本。 |
| `exports/` | 生成的 HTML、PNG、备份 ZIP 和项目文件。 |

写入是原子性的：服务器先写入 `<file>.tmp`，再重命名覆盖目标文件。即使崩溃，旧文件也会保持完整。

## 信封

除项目清单外，每个持久化或交换的 JSON 文件都以同样的四个键开头：

```json
{
  "$schema": "https://manga-memo.dev/schemas/page.schema.json",
  "schemaVersion": 1,
  "kind": "page",
  "appVersion": "0.1.0"
}
```

| 键 | 含义 |
| --- | --- |
| `$schema` | 该格式的规范地址。仅作说明，应用不会去请求它。 |
| `schemaVersion` | 整数版本。没有这个键的文件按 v0 读取。 |
| `kind` | 类型标记：`page`、`mnproj`、`mntpl`、`mnexp`、`mntp`、`mnalign`、`mnlayout`、`mnconfig`、`mnstorage`、`mnhistory`。 |
| `appVersion` | 生成该文件的构建版本。只用于诊断，从不参与选择迁移。 |

`.mnproj` 里的 `manifest.json` 是唯一例外：它带 `$schema`、`schemaVersion` 和 `appVersion`，但不带 `kind`，因为压缩包本身就说明了格式。

## 页面文档

路径：`data/pages/<volume>/<chapter>/<pageIndex>.json`

```json
{
  "$schema": "https://manga-memo.dev/schemas/page.schema.json",
  "schemaVersion": 1,
  "kind": "page",
  "appVersion": "0.1.0",
  "volume": "点兔第14卷",
  "chapter": "172",
  "pageIndex": 0,
  "panels": [
    {
      "id": "p1",
      "rect": { "x": 0.04, "y": 0.03, "w": 0.44, "h": 0.31 },
      "source": "auto",
      "number": 1
    }
  ],
  "notes": [
    {
      "id": "n1712345678901",
      "scope": "panel",
      "panelId": "p1",
      "text": "**原文**：……\n\n翻译更正式。",
      "tags": ["语气", "待确认"],
      "source": { "title": "参考页面", "url": "https://example.com" },
      "createdAt": "2026-05-12T10:00:00.000Z",
      "updatedAt": "2026-05-12T10:05:00.000Z"
    }
  ],
  "offsets": {
    "ja": { "x": 0, "y": 0, "scale": 1 },
    "zh": { "x": 0.01, "y": -0.005, "scale": 1.02 }
  },
  "alignMode": "panel",
  "panelOffsets": {
    "p1": { "zh": { "x": 0.01, "y": 0, "scale": 1 } }
  },
  "gridStep": 1,
  "readingDirection": "rtl",
  "detectorVersion": "xycut-1.3",
  "detectedAt": "2026-05-12T09:59:00.000Z",
  "detectSource": "auto",
  "editCount": 7,
  "lastEditedAt": "2026-05-12T10:05:00.000Z",
  "lastEditSummary": "调整格框；修改批注",
  "groups": [{ "id": "g1", "name": "跨页大图", "panelIds": ["p2", "p3"], "number": 1 }],
  "annotations": [
    {
      "id": "a1",
      "kind": "arrow",
      "scope": "panel",
      "panelId": "p1",
      "points": [{ "x": 0.1, "y": 0.2 }, { "x": 0.8, "y": 0.7 }],
      "color": "#c2410c",
      "width": 3,
      "opacity": 0.9,
      "text": null,
      "fontSize": null,
      "createdAt": "2026-05-12T10:00:00.000Z",
      "updatedAt": "2026-05-12T10:00:00.000Z"
    }
  ],
  "annotationsVisible": true,
  "updatedAt": "2026-05-12T10:05:00.000Z"
}
```

### 字段参考

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `$schema`、`schemaVersion`、`kind`、`appVersion` | 见上 | 信封；`kind` 为 `page`。 |
| `volume`、`chapter` | string | 必须与文件夹名一致。 |
| `pageIndex` | number | 从 0 开始。 |
| `panels` | `Panel[]` | 见下文。坐标会被限制在 `0..1`；宽高至少为 `0.005`。 |
| `notes` | `Note[]` | `scope` 为 `page` 或 `panel`；分格笔记必须带 `panelId`。没有字符串 `text` 的记录会被丢弃。 |
| `offsets` | `Record<Lang, AlignOffset>` | 页面级对齐。`scale` 被限制在 `0.2..4`。 |
| `alignMode` | `page \| panel \| anchors \| grid` | 无效值会变成 `page`。 |
| `panelOffsets` | `Record<panelId, Record<Lang, AlignOffset>>` | 分格级对齐。 |
| `gridStep` | number | 百分比，限制在 `0.1..10`，默认 `1`。 |
| `readingDirection` | `rtl \| ltr \| ttb \| horizontal-rl \| horizontal-lr \| vertical-rl \| vertical-lr` | 无效值会变成 `rtl`；旧文件中已移除的 `continuous-vertical` 也按 `rtl` 读取。 |
| `detectorVersion` | string | 例如 `xycut-1.3`、`layout:<id>`、`plugin:<name>`。 |
| `detectedAt` | ISO string | 最后一次检测的时间。 |
| `detectSource` | `auto \| template \| plugin \| manual` | 分格是由哪条路径产生的。 |
| `editCount` | number | 每次写入都会递增。不是审计日志。 |
| `lastEditedAt`、`lastEditSummary` | string | 人类可读的变更摘要。 |
| `groups` | `PanelGroup[]` | 读取时会移除悬空的分格 id；空分组会被丢弃。 |
| `annotations` | `Annotation[]` | 无效的点会被丢弃。 |
| `annotationsVisible` | boolean | 为 `false` 时在界面和导出中隐藏标注图层；数据仍然保留。 |
| `updatedAt` | ISO string | 写入时由服务器设置。 |

### 分格（Panel）

```json
{
  "id": "p1",
  "rect": { "x": 0.04, "y": 0.03, "w": 0.44, "h": 0.31 },
  "source": "auto",
  "number": 1
}
```

- `id` 在页面内局部有效，且必须唯一。
- `x`、`y`、`w`、`h` 以页面为基准归一化。
- `source` 为 `auto`、`manual` 或 `merged`。
- `number` 是可选的；省略时使用阅读顺序。

### 笔记（Note）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 在页面内唯一。 |
| `scope` | `page \| panel` | |
| `panelId` | string \| null | 分格范围时必填。 |
| `text` | string | Markdown。原始 HTML 会被转义。 |
| `tags` | string[] | |
| `source` | `{ title?, url?, text? }` | `text` 是自由形式的来源标签。 |
| `images` | `{ id, name, dataUrl }[]` | 笔记附带的截图。可在笔记编辑器中粘贴、拖入或添加；超过 400 KB 的图片会缩小到长边 1600 px。 |
| `createdAt`、`updatedAt` | ISO string | |

### 标注类型

`arrow`、`rect`、`ellipse`、`highlight`、`text`、`badge`、`mosaic`、`pen`。

坐标相对于标注的作用范围（页面框或分格框）。自由画笔使用完整的 `points` 折线；箭头使用首尾两个点。

## 版本规则

### 页面文档

- `schemaVersion` 目前为 **1**。没有这个键的文件按 v0 处理，读取时迁移：补上信封并删除旧的 `version` 键。
- **更高**的 schema 版本在写入时会被拒绝，报 `ERR_SCHEMA_TOO_NEW`，避免旧版本悄悄降级新文件。
- 读取时会**规范化**取值：无效数字变为默认值，矩形被限制范围，悬空的分组引用被移除，缺失的 id 会被生成。
- **顶层**未知字段会经 `preserveUnknown` 在读取 → 写入之间保留。带 `id` 的对象数组按 id 合并，其他数组用新值覆盖。
- `panels`、`notes`、`groups`、`annotations` 这些已知子对象在写入时逐字段重建，因此它们**内部**的未知字段不保证保留。
- 无法解析的页面 JSON 会被视为不存在；应用随后会自动检测并重新创建它。
- 迁移按版本串联（`0 → 1 → …`）；每一步只新增或重命名字段，不会删除用户内容。

### 项目包

- `schemaVersion` 目前为 **1**。
- 声明了**更高**版本的项目包会被拒绝，并给出明确错误：请先升级应用。
- 版本 **0** 的项目包（早期实验）会在导入时迁移：顶层的 `images`、`file` 字段和扁平的 `langDirs` 映射会被转换为当前的 manifest 结构。
- 缺失的可选字段会用默认值填充；无效的图片会被丢弃，而不是中止导入。

## 项目包（`.mnproj`）

`.mnproj` 文件是一个 ZIP：

```text
manifest.json
pages/<volume>/<chapter>/<index>.json
templates/...
presets/...
config/library.json          (optional)
assets/<sha1>.<ext>          (packaged mode only)
```

### 清单（Manifest）

```json
{
  "$schema": "https://manga-memo.dev/schemas/mnproj.schema.json",
  "schemaVersion": 1,
  "appVersion": "0.1.0",
  "createdAt": "2026-05-12T10:00:00.000Z",
  "updatedAt": "2026-05-12T10:00:00.000Z",
  "storageMode": "reference",
  "name": "点兔第14卷 学习笔记",
  "language": {
    "volumes": { "点兔第14卷": { "ja": "raw-ja", "zh": "raw-zh" } },
    "resolved": { "点兔第14卷": { "ja": "raw-ja", "zh": "raw-zh" } }
  },
  "inventory": {
    "volumes": [
      {
        "volume": "点兔第14卷",
        "languages": ["ja", "zh"],
        "langDirs": { "ja": "raw-ja", "zh": "raw-zh" },
        "chapters": [{ "chapter": "172", "pages": 18, "images": 36 }]
      }
    ],
    "pageCount": 18,
    "images": [
      {
        "volume": "点兔第14卷",
        "chapter": "172",
        "pageIndex": 0,
        "lang": "ja",
        "name": "001.jpg",
        "sha1": "…",
        "size": 245678,
        "path": "raw/点兔第14卷/raw-ja/172/001.jpg"
      }
    ]
  },
  "notes": { "pages": 18, "noteCount": 42, "annotationCount": 0, "text": "optional user memo" }
}
```

与其他格式不同，清单没有 `kind`：`.mnproj` 压缩包本身就说明了它是什么。

### 存储模式

| 模式 | 图片 | 大小 | 可移植性 |
| --- | --- | --- | --- |
| `reference` | 清单中只有路径 + SHA-1。 | 小。 | 需要原始图片。支持按 SHA-1 或文件名重新关联文件夹。 |
| `packaged` | 去重后放入 `assets/<sha1>.<ext>`。 | 大。 | 自包含；导入时会把图片写入 `raw/`。 |

导入会逐文件检查冲突，并提供**覆盖**、**合并**或**跳过**：

- **合并**会在传入页面缺少分格/标注时保留已有的分格/标注，按 id 合并笔记（同一 id 以传入的为准），并且从不会删除已有笔记。
- 任何导入之前都会写入 `data/` 的快照；原始项目包也会保留在 `data/backups/projects/` 下。

## 布局模板

路径：`data/layouts/<id>.json`

```json
{
  "$schema": "https://manga-memo.dev/schemas/mnlayout.schema.json",
  "schemaVersion": 1,
  "kind": "mnlayout",
  "appVersion": "0.1.0",
  "id": "layout-1712345678901",
  "name": "四格等分",
  "scope": "page",
  "volume": "点兔第14卷",
  "chapter": "172",
  "pageIndex": 3,
  "readingDirection": "rtl",
  "margin": { "top": 0.02, "right": 0.02, "bottom": 0.02, "left": 0.02 },
  "gap": 0.012,
  "colWeights": [1, 1],
  "grid": {
    "cols": 2,
    "rows": [
      { "height": 1, "cells": [{}, {}] },
      { "height": 1, "cells": [{}, {}] }
    ]
  },
  "pageOverrides": {
    "2": { "gap": 0.02 }
  },
  "createdAt": "2026-05-12T10:00:00.000Z",
  "notes": "用于第172话大部分页面"
}
```

- `scope` 为 `page`、`chapter` 或 `volume`；解析时优先选择最窄的匹配。
- `cells[].span` 允许一个单元格跨多列。
- `row.height` 是相对权重。
- `pageOverrides` 的键是从 1 开始的页码。
- `margin` 和 `gap` 是比例；`colWeights` 默认等宽。
- 导出为模板时会写成 `.mntpl` 文件：内容相同，`kind` 改为 `mntpl`，`scope` 改为 `template`，并去掉 `volume`、`chapter`、`pageIndex`。

## 分格模板与对齐预设

**分格模板** —— 从某一页复制矩形：

```json
{
  "$schema": "https://manga-memo.dev/schemas/mntp.schema.json",
  "schemaVersion": 1,
  "kind": "mntp",
  "appVersion": "0.1.0",
  "id": "tpl-…",
  "name": "四格无缝隙",
  "volume": "点兔第14卷",
  "chapter": "172",
  "panels": [{ "x": 0.02, "y": 0.02, "w": 0.47, "h": 0.47 }],
  "readingDirection": "rtl",
  "createdAt": "2026-05-12T10:00:00.000Z"
}
```

**对齐预设**：

```json
{
  "$schema": "https://manga-memo.dev/schemas/mnalign.schema.json",
  "schemaVersion": 1,
  "kind": "mnalign",
  "appVersion": "0.1.0",
  "id": "preset-…",
  "name": "172 话整体偏移",
  "scope": "chapter",
  "volume": "点兔第14卷",
  "chapter": "172",
  "mode": "page",
  "offsets": { "zh": { "x": 0.01, "y": 0, "scale": 1 } },
  "panelOffsets": {},
  "gridStep": 1,
  "createdAt": "2026-05-12T10:00:00.000Z"
}
```

## 导出模板

路径：`data/templates/export.json`

一个由具名模板组成的数组，每个模板存储导出配置的一部分：

```json
[
  {
    "$schema": "https://manga-memo.dev/schemas/mnexp.schema.json",
    "schemaVersion": 1,
    "kind": "mnexp",
    "appVersion": "0.1.0",
    "id": "exp-…",
    "name": "左图右注-紧凑",
    "createdAt": "2026-05-12T10:00:00.000Z",
    "config": {
      "template": "two-column",
      "languages": ["ja", "zh"],
      "embedImages": false,
      "pageWidthRatio": 46,
      "columnGap": 28,
      "fontScale": 1,
      "columns": 1
    }
  }
]
```

完整的导出配置还包括 `title`、`volume`、`chapter`、`pageIndices`、`offsets`、`showPanelBoxes`、`includeNotes`、`onlyWithNotes`、`noteFilterTags` 和 `print`。`print` 为 `true` 时，导出的 HTML 加载后会直接弹出浏览器打印对话框，文件名带 `-print` 后缀。

## 备份 ZIP

备份是一个 ZIP，其中每个条目都以 `data/` 为前缀：

```text
data/pages/...
data/templates/...
data/presets/...
data/library.json
data/.backup-meta.json
```

缩略图缓存（`data/cache/`）以及 `.tmp` / `.log` 文件会被排除。恢复会覆盖 `data/` 下的同名文件，但不会删除备份中不存在的页面；恢复前会先写入当前数据的快照。

## `data/library.json`

```json
{
  "$schema": "https://manga-memo.dev/schemas/mnconfig.schema.json",
  "schemaVersion": 1,
  "kind": "mnconfig",
  "appVersion": "0.1.0",
  "volumes": {
    "点兔第14卷": {
      "dirs": { "ja": "raw-ja", "zh": "raw-zh" }
    }
  }
}
```

这里只存放手动覆盖项。没有条目的卷仍会进行自动语言识别。
