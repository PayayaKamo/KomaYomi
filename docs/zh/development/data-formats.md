# 数据格式（开发者）

KomaYomi 的全部状态都保存在磁盘上的 JSON 里。本页写给需要写脚本或改格式的人：共用的信封、最常打交道的几种结构，以及让旧文件在新代码下仍能打开的那些规则。

面向使用者的概览在[工程文件与格式](/zh/guide/project-files)；运行时真正生效的校验器是 `shared/format.ts`。

## 信封

交换文件和存储文件共用同一段文件头：

```json
{
  "$schema": "https://manga-memo.dev/schemas/page.schema.json",
  "schemaVersion": 1,
  "kind": "page",
  "appVersion": "0.1.0"
}
```

| 字段 | 含义 |
| --- | --- |
| `$schema` | 该格式的规范地址，只作说明，应用不会去下载它。 |
| `schemaVersion` | 整数版本。没有这个键就按 v0 处理。 |
| `kind` | 格式标记：`page`、`mnproj`、`mntpl`、`mnexp`、`mntp`、`mnalign`、`mnlayout`、`mnconfig`、`mnstorage`、`mnhistory`。 |
| `appVersion` | 生成该文件的构建版本，只用于排查，不参与选择迁移。 |

有一个例外：`.mnproj` 的 `manifest.json` 只有 `$schema`、`schemaVersion` 和 `appVersion`，没有 `kind`，因为 ZIP 本身已经说明了格式。

## 格式一览

| `kind` | 磁盘位置 | 扩展名 | 内容 |
| --- | --- | --- | --- |
| `page` | `data/pages/<卷>/<章>/<序号>.json` | 导出时为 `.mnpage.json` | 分格、笔记、偏移、分组、批注、编辑信息。 |
| `mnconfig` | `data/library.json` | — | 卷覆盖、目录规则、语言顺序、历史上限、自动备份计划。 |
| `mnproj` | `.mnproj` ZIP 内的 `manifest.json` | `.mnproj` | 工程名、存储方式、语言映射、图片清单、笔记计数。 |
| `mntpl` | 导出的布局模板 | `.mntpl` | 行列网格、边距、间隙、列宽权重、单页覆盖。 |
| `mnexp` | `data/templates/export.json` 中的条目 | `.mnexp` | 导出对话框的配置。 |
| `mntp` | `data/templates/panels/<id>.json` | — | 保存下来的分格矩形与阅读方向。 |
| `mnalign` | `data/presets/align/<id>.json` | — | 页面或章节的对齐偏移。 |
| `mnlayout` | `data/layouts/<id>.json` | — | 绑定到卷、章或页的声明式布局。 |
| `mnstorage` | `data/storage.json` | — | 存储方式、凭据、缓存上限。 |
| `mnhistory` | `data/history/<卷>/<章>/<序号>.json` | — | 跨会话的页面快照。 |

## 页面文档

一页一个文件，序号从 0 开始。矩形和坐标都按页面归一化，范围 `0..1`。

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
    { "id": "p1", "rect": { "x": 0.04, "y": 0.03, "w": 0.44, "h": 0.31 }, "source": "auto", "number": 1 },
    { "id": "p2", "rect": { "x": 0.52, "y": 0.03, "w": 0.44, "h": 0.31 }, "source": "manual", "number": 2 }
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
      "createdAt": "2026-05-12T10:00:00.000Z",
      "updatedAt": "2026-05-12T10:00:00.000Z"
    }
  ],
  "annotationsVisible": true,
  "updatedAt": "2026-05-12T10:05:00.000Z"
}
```

手写页面文件之前，先记住几条：

- `panels[].id` 只在页内唯一即可。`source` 取 `auto`、`manual` 或 `merged`，`number` 可省略。
- `notes[].scope` 是 `page` 或 `panel`；分格笔记必须带 `panelId`。`text` 不是字符串的笔记会被丢弃。
- `offsets[lang].scale` 会被限制在 `0.2..4`。`gridStep` 是百分比，限制在 `0.1..10`。
- `readingDirection` 可用 `rtl`、`ltr`、`ttb`、`horizontal-rl`、`horizontal-lr`、`vertical-rl`、`vertical-lr`。已删除的 `continuous-vertical` 按 `rtl` 读取。
- 批注 `kind` 为 `arrow`、`rect`、`ellipse`、`highlight`、`text`、`badge`、`mosaic`、`pen` 之一。手绘笔迹使用全部点，箭头只用首尾两点。
- `groups[].panelIds` 有顺序，这个顺序就是导出顺序和对照翻页顺序。读取时指向不存在分格的 id 会被清掉。

## `data/library.json`

```json
{
  "$schema": "https://manga-memo.dev/schemas/mnconfig.schema.json",
  "schemaVersion": 1,
  "kind": "mnconfig",
  "appVersion": "0.1.0",
  "volumes": {
    "点兔第14卷": {
      "title": "点兔 第14卷",
      "series": "请问您今天要来点兔子吗？",
      "dirs": { "ja": "raw-ja", "zh": "raw-zh" },
      "defaultDirection": "rtl",
      "chapters": {
        "172": {
          "title": "第172话",
          "order": [0, 1, 2],
          "excluded": [12],
          "kinds": { "0": "cover" },
          "hidden": false,
          "pageOffsets": { "zh": { "from": 5, "to": 6 } }
        }
      }
    }
  },
  "rules": [
    {
      "id": "volume-language-chapter-page",
      "pattern": "{volume}/{language}/{chapter}/{page}"
    },
    {
      "id": "series-volume-language-chapter-page",
      "pattern": "{series}/{volume}/{language}/{chapter}/{page}"
    }
  ],
  "langOrder": ["ja", "zh", "en"],
  "historyLimit": 50,
  "autoBackup": { "enabled": true, "intervalHours": 24, "keep": 7 }
}
```

- `volumes` 只存覆盖项，不会重命名磁盘上的目录。`title`、`series` 改侧栏显示，`defaultDirection` 由该卷的新页面继承。
- `chapters` 以话 ID 为键：`hidden: true` 把话从图库移除但保留文件夹和页面数据，`pageOffsets` 让某语言从第 `from` 页对齐到参考版的第 `to` 页。
- `rules` 按顺序尝试，为空时回退到两条内建规则。写法见[目录规则](/zh/development/folder-rules)。
- `langOrder` 只是偏好。扫描时新发现的语言会排在配置的语言之后。
- `historyLimit` 默认 50，限制在 `5..200`。
- `autoBackup` 可省略；应用或服务运行时才会按计划执行。

## `.mnproj` 工程包

`.mnproj` 是一个 ZIP。引用模式只存路径和哈希，内嵌模式额外带上图片字节。

```text
manifest.json
pages/<卷>/<章>/<序号>.json
history/<卷>/<章>/<序号>.json
templates/...
presets/...
config/library.json          （可选）
assets/<sha1>.<ext>          （仅内嵌模式）
```

引用模式的 manifest：

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
        "sha1": "9f2c…",
        "size": 245678,
        "path": "raw/点兔第14卷/raw-ja/172/001.jpg"
      }
    ]
  },
  "notes": { "pages": 18, "noteCount": 42, "annotationCount": 0, "text": "可选的用户备注" }
}
```

内嵌模式下，每条图片记录的 `path` 换成 `asset: "assets/<sha1>.<ext>"`，导入时会把图片写进 `raw/`。

导入时按文件判断冲突，可选**覆盖**、**合并**或**跳过**。合并会保留本地已有分格和批注，笔记按 id 求并集（同 id 以导入文件为准），本地独有的笔记不会被删除。

## `.mntpl` 布局模板

导出布局时会去掉卷 / 章 / 页绑定，变成可复用模板：

```json
{
  "$schema": "https://manga-memo.dev/schemas/mntpl.schema.json",
  "schemaVersion": 1,
  "kind": "mntpl",
  "appVersion": "0.1.0",
  "id": "four-panel",
  "name": "四格等分",
  "scope": "template",
  "readingDirection": "rtl",
  "margin": { "top": 0.03, "right": 0.03, "bottom": 0.03, "left": 0.03 },
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

存在 `data/layouts/<id>.json` 里的布局（`kind: "mnlayout"`）网格写法相同，但改为携带 `scope: "page" | "chapter" | "volume"` 以及 `volume`、`chapter`、`pageIndex`，检测时会自动套用。`pageOverrides` 的键是**从 1 开始**的页码。

## `.mnexp` 导出模板

完整模板如下。它既存在 `data/templates/export.json` 里，也可以写成独立的 `.mnexp` 文件：

```json
{
  "$schema": "https://manga-memo.dev/schemas/mnexp.schema.json",
  "schemaVersion": 1,
  "kind": "mnexp",
  "appVersion": "0.1.0",
  "id": "exp-1712345678901",
  "name": "左图右笔记",
  "createdAt": "2026-05-12T10:00:00.000Z",
  "config": {
    "template": "two-column",
    "title": "漫画对照批注",
    "languages": ["ja", "zh"],
    "embedImages": false,
    "showPanelBoxes": false,
    "includeNotes": true,
    "onlyWithNotes": false,
    "noteFilterTags": [],
    "pageWidthRatio": 46,
    "columnGap": 28,
    "fontScale": 1,
    "columns": 1
  }
}
```

`template` 取 `two-column`、`stack` 或 `compare-wide`。导出范围（`volume`、`chapter`、`pageIndices`）和 `offsets` 在导出时选择，不存进模板。逐字段说明见[导出模板](/zh/development/export-templates)。

## 版本、迁移与未知字段

### 读取交换文件

`prepareExchange(kind, value)` 按顺序做四步：

1. `checkSchemaVersion`：版本高于当前就报错，不会尝试降级。
2. 迁移 `0 → 1 → … → 当前`，每一步对应 `shared/format.ts` 与 `shared/migrations.ts` 里的一个函数。
3. `finalizeEnvelope`：写入 `$schema`、`schemaVersion`、`kind`、`appVersion`。
4. 完整校验。错误会带路径，例如 `manifest.volumes[2].chapters: required`。

四步全部通过才会写盘，所以导入失败不会留下半份文件。

### 读取 `data/` 下的存储文件

只有 `server/schemaStore.ts` 读写这些文件：

- 旧文件在读取时迁移并就地重写，重写前先把原始字节备份到 `<文件名>.v<旧版本>.bak`。
- 校验是宽松的（`strict: false`）：缺一个可选字段不能把用户锁在门外。
- 来自更新版本的文件原样返回，但拒绝写入，返回 HTTP `409` 和 `ERR_SCHEMA_TOO_NEW`。
- 写入是原子的：先写同目录临时文件，再改名覆盖。

### 未知字段会跟着文件往返

`preserveUnknown(previous, next)` 会把磁盘上已有的值合并进待写入的值：

- 未知的对象键递归复制。
- 带 `id` 的对象数组按 `id` 逐个合并。
- 其他数组采用新值，顺序和删除由写入方决定。

这就是"新版本打开、旧版本保存、再回到新版本"不会丢字段的原因。

页面文档有一个前提：`server/storage.ts` 的 `normalizeDoc` 会在 `preserveUnknown` 之前逐字段重建分格、笔记和批注。已有对象上的未知字段能靠合并留下来，但**新建**的分格或笔记上多出来的字段，如果 `normalizeDoc` 不认识，就不会写进去。只改类型定义是不够的。

### 版本历史

目前还没有 v2。迁移写法保证以后加 v2 时不用改调用点。删除某个字段值不需要升版本：`continuous-vertical` 被移除后直接按 `rtl` 读取。

内容语言 id 是运行时字符串，不是固定枚举。`ja`、`zh`、`en` 有固定显示名，其他 id 也会被当作语言，用通用标签展示。`library.langOrder`、卷的 `langDirs`、页面 `files` 和导出的 `languages` 都接受任意 id。

## 安全地改格式

增加可选字段不需要升版本：

1. 在 `shared/types.ts` 的类型里加可选字段。
2. 在 `shared/format.ts` 对应 spec 里加可选字段，不要放进 `required`。
3. 如果字段属于分格、笔记或批注，还要让 `server/storage.ts` 的 `normalizeDoc` 保留它。
4. 如果用户会导入导出这种格式，同步更新 `shared/schemas/*.json`。
5. 在 `tests/unit/formats.test.ts` 加一条：旧文件仍能打开，写入后字段还在。

以下情况必须升 `schemaVersion` 并追加迁移：

- 已有字段的含义或类型变了；
- 原本可选的字段改成必填；
- 数据结构需要重排（例如把几个键挪进嵌套对象）。

新增一种格式则要：

1. 在 `shared/format.ts` 的 `SCHEMA_URLS`、`FORMAT_LABEL`、`FORMAT_EXTENSION`、`CURRENT_SCHEMA_VERSION` 里加条目。
2. 在同文件加 spec。
3. 在 `MIGRATIONS` 里加 v0 的迁移。
4. 如果用户能导入，加 `shared/schemas/<kind>.schema.json`。
5. 读写一律走 `server/schemaStore.ts` 的 `readStoredFile` / `writeStoredFile`。

## 文件损坏时怎么救

1. 先停掉应用，避免它又把文件写回去。
2. 在迁移后的文件旁边找 `<文件名>.json.v0.bak`。
3. 用备份覆盖当前文件，恢复成原来的名字。

备份每个版本只写一次，应用不会删除它，也不会把它打进工程包或导出文件，并且被 git 忽略。

## 固定这些行为的测试

`npm test` 覆盖了最容易出问题的部分：

- v0 → v1 页面迁移，包括删除旧的 `version` 键，以及重复执行结果不变。
- manifest v0 把 `images`、`langDirs`、`pageCount` 折进 `inventory`。
- 顶层与嵌套的未知字段在读写往返后仍然存在。
- 第一次就地迁移前会生成 `.v0.bak` 备份。
- 更新版本的文件只读打开，写入时报 `ERR_SCHEMA_TOO_NEW`。
- 导入时拒绝更高的 `schemaVersion`。
