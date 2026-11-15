# 分格插件

分格插件接管它所匹配的页面，替代内建检测器。插件是普通 JavaScript 模块，**直接跑在服务端进程里**，不是子进程，也不是 shell 脚本。没有 stdin/stdout 协议，没有外部运行器施加的超时，也没有退出码可读；约定就是一个返回矩形的函数。

本页写的是 `server/plugins.ts` 的真实行为，也纠正了过去把插件描述成外部程序的说法。

## 插件放在哪

| 位置 | 用途 |
| --- | --- |
| `plugins/`（仓库根目录） | 跟项目一起维护的插件。 |
| `data/plugins/` | 跟图库数据放一起的插件。 |

每次调用都会扫描这两个目录。`.mjs`、`.cjs`、`.js` 结尾的文件会被加载，点开头的文件跳过。列表来自 `fs.readdirSync` 的输出顺序，所以**不要指望按字母顺序决定优先级**；请写精确的 `match`，不要堆叠互相覆盖的插件。

改完文件不用重启：每次 import 都会带上文件 mtime 作为查询串来绕过缓存。

## 协议

插件模块默认导出一个函数或一个对象：

```ts
type PanelRect = { x: number; y: number; w: number; h: number } // 归一化 0..1

type PluginPanelInfo = {
  width: number        // 检测到的图片宽度（像素）
  height: number
  volume: string
  chapter: string
  pageIndex: number    // 从 0 开始
  filename: string
}

type PanelPlugin = {
  name?: string
  match?: {
    volume?: string | RegExp
    chapter?: string | RegExp
    file?: string | RegExp
  }
  panels: (
    info: PluginPanelInfo,
  ) =>
    | PanelRect[]
    | { panels: PanelRect[]; warnings?: string[] }
    | Promise<PanelRect[] | { panels: PanelRect[]; warnings?: string[] }>
}
```

默认导出是函数时，它会被当作 `panels()`，插件名取文件名（含扩展名）。

### 匹配

- 字符串模式是不区分大小写的子串匹配。
- `RegExp` 用 `.test()` 判断。
- 写了的字段必须全部匹配。省略 `match` 会匹配所有页面，调试时方便，忘了删就危险。
- `file` 是图片文件名，含扩展名。

### 结果与失败

- 返回矩形数组，或返回带 `panels` 和可选 `warnings` 的对象。
- 返回空数组算失败；抛异常或执行超过 **2500 毫秒**也算失败。
- 失败时调用方回退到内建检测器并显示警告，坏插件不会让页面空白。
- `x`、`y`、`w`、`h` 会被限制在 `0..1`，宽高最小 `0.005`。
- `warnings` 会出现在检测结果和 CLI 输出里，但不会让整次检测失败。

插件拥有完整的 Node 权限，能读写文件、发网络请求、读环境变量。只装你信得过的插件。

## 示例 1：固定 2×2 网格

`plugins/example-2x2-grid.mjs`

```js
export default {
  name: 'example-2x2-grid',
  match: { volume: /example/i },
  panels() {
    const gap = 0.01
    const w = (1 - gap) / 2
    const h = (1 - gap) / 2
    return [
      { x: 0, y: 0, w, h },
      { x: w + gap, y: 0, w, h },
      { x: 0, y: h + gap, w, h },
      { x: w + gap, y: h + gap, w, h },
    ]
  },
}
```

这个正则会匹配卷名里带 "example" 的图库。换成真实图库时，把 `match` 改成卷目录名，例如 `match: { volume: '点兔第14卷', chapter: '172' }`。

## 示例 2：`.cjs` 写的横向三格

CommonJS 模块写法相同，默认导出就是 `module.exports`。

`plugins/three-strips.cjs`

```js
module.exports = {
  name: 'three-strips',
  match: { volume: 'weekly', chapter: /^\d+$/ },
  panels() {
    const rows = 3
    const gap = 0.008
    const h = (1 - gap * (rows - 1)) / rows
    return Array.from({ length: rows }, (_, i) => ({
      x: 0,
      y: i * (h + gap),
      w: 1,
      h,
    }))
  },
}
```

`chapter: /^\d+$/` 让插件只对纯数字章节目录生效。

## 示例 3：带警告的返回

页面尺寸不合预期、但还能给出可用猜测时，返回对象比只返回数组更合适：

`plugins/wide-gutter.mjs`

```js
export default {
  name: 'wide-gutter',
  match: { file: /^00[1-4]\.jpg$/i },
  panels({ width, height }) {
    if (!width || !height) {
      return { panels: [], warnings: ['Image size unavailable'] }
    }
    const left = 0.08
    const right = 0.08
    const gutter = 0.02
    const w = (1 - left - right - gutter) / 2
    return {
      panels: [
        { x: left, y: 0.05, w, h: 0.9 },
        { x: left + w + gutter, y: 0.05, w, h: 0.9 },
      ],
      warnings: [`Assumed a ${width}×${height} two-panel spread`],
    }
  },
}
```

## 启用与试跑

1. 把文件放进 `plugins/` 或 `data/plugins/`。
2. 打开应用，进入 **插件** 对话框（侧栏里和目录规则、交换文件放在一起）。这个对话框只读：列出每个文件、声明的名字、`match` 摘要，或者加载错误和错误码。改完文件按**刷新**。
3. 打开插件匹配的页面，在切格工作台执行**切格**。下一次写入会把 `detectSource: "plugin"` 和 `detectorVersion: "plugin:<名字>"` 记进页面 JSON。
4. 也可以不打开浏览器，直接跑命令行：

```bash:no-line-numbers
node scripts/manga-cli.ts plugins
node scripts/manga-cli.ts detect --volume <卷> --chapter <章> --pages 1 --plugin example-2x2-grid --apply
```

`plugins` 打出的列表和对话框一致。`detect` 不带 `--apply` 是试跑；`--auto` 即使有插件匹配也强制使用内建检测器。

优先级永远是**布局模板 → 插件 → 内建检测器**。页面绑定了布局模板时，插件根本不会被问到。

## 排查

| 现象 | 错误码 | 原因与处理 |
| --- | --- | --- |
| 对话框里一行标红 | `ERR_PLUGIN_NO_EXPORT` | 模块既没导出函数，也没导出带 `panels()` 的对象。检查默认导出。 |
| 对话框显示语法或加载错误 | — | Node 无法加载该文件，消息就是原始异常。检查扩展名和 import 路径。 |
| 检测回退到自动 | `ERR_PLUGIN_TIMEOUT` | `panels()` 超过 2500 毫秒。把重活放到模块加载时做一次，不要每页都算。 |
| 检测回退到自动 | `ERR_PLUGIN_NO_PANELS` | 插件返回了 `[]`。按设计，返回空就是失败，不是"这一页没有分格"。 |
| 插件从未被调用 | `ERR_PLUGIN_NONE` | 没有文件匹配，或者布局模板先赢了。对照真实的卷 / 章 / 文件名检查 `match`。 |
| 后面的插件不执行 | — | 前一个文件加载失败会直接中断查找。删掉或修好那个坏文件。 |
| 改了没效果 | — | 对话框列表按次缓存，先按**刷新**；页面也会保留已保存的分格，需要重新切格。 |

## 安全与可移植性

- 插件就是可信代码，能读你的文件、发网络请求。
- 插件是代码不是数据：导出 `.mnproj` 不会带上 `plugins/`，需要单独复制。
- 静态在线版没有服务端进程，跑不了插件。见[二次开发总览](/zh/development/#只有本地版才有的能力)。
