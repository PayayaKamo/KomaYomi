# 目录规则（开发者）

目录规则描述卷、语言、章、页分别位于路径的哪一层。`server/dirRules.ts` 的扫描器就是一个"路径段进、页面记录出"的纯函数，持久化和 HTTP 由 `server/library.ts` 负责。只想在界面里操作的话，先看[目录识别规则](/zh/guide/folder-rules)。

## 规则存在哪

规则保存在 `data/library.json` 的 `rules` 数组里（`kind` 为 `mnconfig`）。数组不存在或为空时，按顺序使用两条内建规则：

```json
[
  { "id": "volume-language-chapter-page", "name": "{volume}/{language}/{chapter}/{page}", "pattern": "{volume}/{language}/{chapter}/{page}" },
  { "id": "series-volume-language-chapter-page", "name": "{series}/{volume}/{language}/{chapter}/{page}", "pattern": "{series}/{volume}/{language}/{chapter}/{page}" }
]
```

第二条覆盖"一个根目录下并列多部作品"的结构。对话框里的**恢复默认**会写回这两条；**保存规则**会先校验整个数组，再触发重新扫描。

## 占位符

| 占位符 | 别名 | 含义 |
| --- | --- | --- |
| `{series}` | `{seriesName}`、`{work}` | 卷之上的一层系列目录。 |
| `{volume}` | `{vol}`、`{book}` | 显示在侧栏里的卷。 |
| `{chapter}` | `{chap}`、`{ch}`、`{episode}` | 章节目录。 |
| `{language}` | `{lang}`、`{locale}` | 被识别为语言的目录。 |
| `{page}` | `{file}`、`{image}`、`{img}` | 图片文件。每条规则都必须有。 |

别名不区分大小写（`{seriesName}` 和 `{seriesname}` 等价）。规则必须包含 `{page}`；没有 `{language}` 时必须声明兜底 `language`。

同时匹配到 `{series}` 和 `{volume}` 时，系列名会单独记录，不拼进卷 id。卷 id 仍是卷文件夹名，"系列 · 卷"只是显示用的标签；`{series}` 可以跨越好几层目录。如果两个系列下有同名卷，冲突时会给卷 id 加上最后一级系列目录前缀（如 `alpha-vol-01`），避免两边的页面数据合并。

## 可选段与通配

| 写法 | 行为 |
| --- | --- |
| `{chapter}?` | 这一段可以缺失。匹配器会先尝试吃掉一段，再尝试跳过。 |
| `*` 或 `**` | 匹配正好一段不关心的目录。两种写法完全等价。 |
| 普通文本 | 必须与目录名相等，不区分大小写。 |

没有"零到多段"的通配。目录深度不固定时，按深度各写一条规则，并按从具体到宽泛的顺序排列。

## `ignore`、`extensions` 与 `language`

| 字段 | 行为 |
| --- | --- |
| `ignore` | 永不进入的目录名，不区分大小写。系统取所有启用规则的并集，所以一条规则忽略的目录，对整个扫描都生效。 |
| `extensions` | 认可的图片扩展名，带不带点都行，统一转成小写并补点。同样取所有启用规则的并集；某条规则省略 `extensions` 时，会贡献默认列表（`.jpg`、`.jpeg`、`.png`、`.webp`、`.gif`、`.avif`、`.bmp`）。 |
| `language` | 没有 `{language}` 时的兜底语言 id。模式里有 `{language}` 时忽略。不能含路径分隔符。 |
| `enabled` | 设为 `false` 时保留在文件里但不参与匹配。 |
| `id` | 稳定标识。省略时生成 `rule-<n>`；重复会被拒绝。 |

因为 `ignore` 和 `extensions` 是所有启用规则的并集，你没法用"一条通用规则只收 `.jpg`、另一条窄规则只收 `.png`"来做互斥。需要不同扩展名时，把列表写在每条规则上，并记住通用规则里的列表也会参与合并。

## 匹配与顺序

- 规则按顺序尝试，第一条完整匹配的生效。
- 模式锚定在扫描根上。对话框预览某个子目录时，按该子树求值。
- `{language}` 段里的目录名会经过 `normalizeLang`（`ja`、`jp`、`日本語`、`zh-cn`、`cn`、`english` 等）。不认识的目录默认不匹配，除非在卷设置里做了映射。
- 规则里没有 `{chapter}` 时，该卷所有页面归入唯一的章节 `全一话`。
- `ignore` 在走目录时、应用任何规则之前就会检查。

## 常见目录结构的完整规则

### 1. 默认：卷 / 语言 / 章 / 页

```text
raw/
  点兔第14卷/
    raw-ja/
      172/
        001.jpg
    raw-zh/
      172/
        001.jpg
```

```json
[
  {
    "id": "default",
    "name": "卷 / 语言 / 章 / 页",
    "pattern": "{volume}/{language}/{chapter}/{page}"
  }
]
```

### 2. 卷之上还有系列，章节可选，忽略杂项目录

```text
raw/
  きらら/
    点兔第14卷/
      ja/
        172/
          001.jpg
      zh/
        172/
          001.jpg
    covers/
```

```json
[
  {
    "id": "series-volume-language-chapter-page",
    "name": "系列 / 卷 / 语言 / 可选章 / 页",
    "pattern": "{series}/{volume}/{language}/{chapter}?/{page}",
    "ignore": ["covers", "_extras"],
    "extensions": [".jpg", ".jpeg", ".png"]
  }
]
```

卷会显示成 `きらら / 点兔第14卷`。没有章节目录的卷也能匹配同一条规则。

### 3. 语言在最前

```text
raw/
  ja/
    volume-01/
      01/
        001.jpg
  zh/
    volume-01/
      01/
        001.jpg
```

```json
[
  {
    "id": "language-volume-chapter-page",
    "name": "语言 / 卷 / 章 / 页",
    "pattern": "{language}/{volume}/{chapter}/{page}"
  }
]
```

### 4. 单语言平铺收藏

```text
raw/
  侦探漫画 第01卷/
    第01话/
      001.jpg
```

```json
[
  {
    "id": "flat-japanese",
    "name": "平铺目录，固定日语",
    "pattern": "{volume}/{chapter}/{page}",
    "language": "ja"
  }
]
```

### 5. 固定的出版社前缀

```text
raw/
  manga/
    volume-01/
      ja/
        01.jpg
```

```json
[
  {
    "id": "publisher-prefix",
    "name": "固定 manga/ 前缀",
    "pattern": "manga/{volume}/{language}/{page}"
  }
]
```

普通文本段必须真实存在。预览一片空白时，最常见的原因就是这种固定段写错了。

### 6. 用通配跳过一层

```text
raw/
  volume-01/
    scans/
      ja/
        01.jpg
```

```json
[
  {
    "id": "wildcard-level",
    "name": "卷与语言之间有一层未知目录",
    "pattern": "{volume}/*/{language}/{page}"
  }
]
```

`*` 只吃掉正好一段，不会重复。

## 校验错误

`validateRules` 会拒绝整个数组，并报出下面某个错误码：

| 错误码 | 含义 |
| --- | --- |
| `ERR_RULES_NOT_ARRAY` | 值不是非空数组。 |
| `ERR_RULE_NOT_OBJECT` | 某一项不是对象。 |
| `ERR_RULE_PATTERN_MISSING` | 某一项没有 `pattern`。 |
| `ERR_RULE_PATTERN_ABSOLUTE` | 模式是绝对路径或包含 `..`。 |
| `ERR_RULE_PAGE_MISSING` | 模式里没有 `{page}`。 |
| `ERR_RULE_LANGUAGE_MISSING` | 既没有 `{language}`，也没有 `language` 兜底。 |
| `ERR_RULE_LANGUAGE_INVALID` | `language` 值里有路径分隔符。 |
| `ERR_RULE_DUPLICATE_ID` | 两条规则用了同一个 `id`。 |
| `ERR_RULE_UNKNOWN_PLACEHOLDER` | `{...}` 名字不在别名表里。 |
| `ERR_RULE_EMPTY` | 去掉首尾斜杠后模式为空。 |
| `ERR_RULE_PARSE` | 扫描时解析某条已存规则失败。 |

没有匹配任何规则的文件夹不会被悄悄丢掉：扫描结果里有一份 `unmatched` 列表，附带原因，例如 `WARN_RULE_LEVEL_MISMATCH`、`WARN_RULE_NO_LANGUAGE`、`WARN_UNKNOWN_LANGUAGE_DIR`、`WARN_NO_RULE_MATCHED`。对话框会在预览下方列出这些内容。

## 在已有图库上改规则

页面数据按卷 id 和章 id 存放：`data/pages/<卷>/<章>/<序号>.json`。规则一变，这两个 id 可能跟着变，已有的分格和笔记不会自动迁移。请在开始批注之前把规则定好；确实要改的话，先做一次备份，改完抽查几页。

## 相关页面

- [目录识别规则](/zh/guide/folder-rules)：对话框操作与常见坑。
- [数据格式](/zh/development/data-formats)：`library.json` 与页面路径。
- [匹配器源码](https://github.com/PayayaKamo/KomaYomi/blob/main/server/dirRules.ts)。
