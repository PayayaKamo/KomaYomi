# 导出模板

导出模板保存导出对话框里的设置，省得每次都重填。模板不记录导出哪些页——卷、章、页码范围和对齐偏移都在导出时选择。

面向使用者的说明在[导出](/zh/guide/export)。

## 模板存在哪

| 文件 | 内容 |
| --- | --- |
| `data/templates/export.json` | 模板对象数组，每个都带交换文件同款信封。 |
| `<名字>.mnexp` | 单个模板，用于分享或备份。 |

对话框通过 `GET /api/export-templates` 读取数组，通过 `POST /api/export-templates` 保存、`DELETE /api/export-templates?id=…` 删除。`.mnexp` 的导入导出走交换接口：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/exchange/export-template/export` | 导出一个模板；请求体为 `{ "templateId": "…" }`（也接受 `{ "id": "…" }`）。 |
| `POST` | `/api/exchange/export-template/import` | 导入 `.mnexp`；请求体为 `{ "data": "<文件文本>" }`。缺少 `id` / `name` / `createdAt` 会自动补上；`id` 已存在时由导入的模板替换。 |

## 可自定义的字段

| 字段 | 类型 | 界面范围 | 含义 |
| --- | --- | --- | --- |
| `template` | `two-column` \| `stack` \| `compare-wide` | — | 页面版式。`two-column` 左图右笔记，`stack` 按语言叠放，`compare-wide` 用宽幅图片网格。 |
| `title` | string | — | 导出页面顶部的标题。 |
| `languages` | string[] | — | 包含的语言及显示顺序。图库里出现的任意语言 id 都可以。 |
| `embedImages` | boolean | — | 把图片内嵌为 data URL，而不是链接文件。 |
| `showPanelBoxes` | boolean | — | 在图片上画出分格框。 |
| `includeNotes` | boolean | — | 文档中是否包含笔记。 |
| `onlyWithNotes` | boolean | — | 跳过完全没有笔记的页面。 |
| `print` | boolean | — | 生成适合打印的页面，打开时唤起浏览器打印（可另存为 PDF）。 |
| `noteFilterTags` | string[] | — | 只显示带这些标签之一的笔记；空数组表示不筛选。 |
| `pageWidthRatio` | number | 28–75 | 图片列占内容宽度的百分比。 |
| `columnGap` | number | 0–64 | 列间距，单位像素。 |
| `fontScale` | number | 0.8–1.4 | 笔记字号缩放，`1` 为 100%。 |
| `columns` | number | 1–4 | 分格对照版式里每行的分格数。 |

`volume`、`chapter`、`pageIndices`、`offsets` 属于运行时的 `ExportConfig`，但不写进模板。

## 一份完整的 `.mnexp`

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
    "noteFilterTags": ["语气"],
    "pageWidthRatio": 52,
    "columnGap": 24,
    "fontScale": 1.1,
    "columns": 1
  }
}
```

存储时 `config` 是部分对象：从对话框保存的模板会带上它管理的全部字段，手写的文件可以省略若干键，用默认值补齐（`two-column`、`漫画对照批注`、`ja`/`zh`/`en`、`pageWidthRatio` 46、`columnGap` 28、`fontScale` 1、`columns` 1）。

## 套用模板

- **在对话框里。** 打开导出，从列表选一个模板，再按需调整页码范围。保存会把当前版式存成一个新模板。
- **用文件。** 交换对话框 → **导入** → 选择 `.mnexp`，模板会立即出现在列表里。`id` 相同的话，导入会替换掉原有那条。
- **用 API。** `POST /api/export` 接受完整的 `ExportConfig`，把模板的 `config` 和本次范围拼起来即可：

```json
{
  "volume": "点兔第14卷",
  "chapter": "172",
  "pageIndices": [0, 1, 2],
  "template": "two-column",
  "title": "漫画对照批注",
  "languages": ["ja", "zh"],
  "embedImages": false,
  "offsets": { "zh": { "x": 0.01, "y": 0, "scale": 1.02 } },
  "showPanelBoxes": false,
  "includeNotes": true,
  "onlyWithNotes": false,
  "noteFilterTags": ["语气"],
  "pageWidthRatio": 52,
  "columnGap": 24,
  "fontScale": 1.1,
  "columns": 1
}
```

## 未知字段

`shared/format.ts` 里的 `exportConfigSpec` 允许未知键，所以未来版本写出的模板经过当前版本往返后仍然完整。当前界面不认识、也不渲染的键不会被删掉。`print` 就是个例子：导出器认识它，只是旧文档没有列出来。

## 模板看起来没生效时

| 现象 | 可能原因 |
| --- | --- |
| 导入后列表里没有 | 对话框只在打开时读取一次，重新打开即可。接口会校验整份文件，`config` 不合法时会返回带字段路径的错误。 |
| `languages` 顺序不对 | 导出按模板里的顺序，但只保留所选卷里实际存在的语言。 |
| 排版与预览不一致 | `pageWidthRatio`、`columnGap`、`fontScale` 影响打印 / PDF 输出，屏幕预览只是近似。 |
| 列表里出现两个同名模板 | 导入时 `id` 相同会直接替换；若确实出现两条，多半是文件里的 `id` 不同，导入后在对话框里改名即可。 |
