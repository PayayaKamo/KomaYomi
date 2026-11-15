# 贡献指南

欢迎参与改进。本页写给已经克隆仓库的人；完整清单以仓库根目录的 `CONTRIBUTING.md` 为准。

## 分支模型

| 分支 | 用途 |
| --- | --- |
| `main` | 已发布代码，只通过发布合并更新。 |
| `dev` | 集成分支，所有功能先落到这里。 |
| `feat/<slug>`、`fix/<slug>`、`chore/<slug>`、`docs/<slug>` | 从 `dev` 切出的短期分支。 |

请向 `dev` 提 PR。请求评审前先 rebase 到最新的 `dev`。

## 提交信息

仓库用 [Conventional Commits](https://www.conventionalcommits.org/)，`commit-msg` 钩子会跑 `commitlint`：

```text
<type>(<scope>): <subject>
```

常用类型有 `feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`build`、`ci`、`chore`、`revert`。主题用祈使句、小写、结尾不加句号：

- `feat(reader): add side-by-side gutter control`
- `fix(export): keep panel notes when image mode is embed`
- `docs(guide): document .mnproj storage modes`

Husky 会在提交时跑 `lint-staged`：TS/TSX 走 ESLint `--fix`，JS/CJS/MJS/JSON/Markdown/YAML/CSS/HTML 走 Prettier。只有在提交临时进度时才用 `git commit --no-verify`，并在提 PR 前清理干净。

## 代码风格

- TypeScript 严格模式。模块边界上尽量写明类型。
- ESLint 扁平配置（`eslint.config.js`）管正确性，Prettier 管格式。不要再加和 Prettier 重叠的风格规则。
- 服务端是 ESM TypeScript，import 要带 `.ts` 后缀。`server/`、`shared/`、`src/` 里都不要写 CommonJS。
- `shared/` 不能 import `node:` 模块，也不能碰 DOM，前后端都依赖它。
- 所有面向用户的文案放在 `src/i18n/`（`en`、`zh`、`ja`）。组件里写死中文会被 `npm run i18n:scan:strict` 拦下。
- 服务端错误与警告文案放在 `server/messages/catalog.ts`，按错误码组织。
- 文档页要三语齐全，并在 `docs/.vitepress/config.mts` 里补对应的导航与侧栏条目。

## 检查

推送前跑：

```bash:no-line-numbers
npm run lint
npm run typecheck
npm test
npm run i18n:scan
npm run docs:build
```

测试在 `tests/unit/`。改格式、检测或图库时最相关的是 `formats.test.ts`、`project.test.ts`、`detect.test.ts`、`dirRules.test.ts` 和 `library.test.ts`。纯界面改动没有单测，请在浏览器里按 1440px 和 390px 宽度各看一遍。

`npm run docs:build` 遇到死链会失败，所以页面改名时必须在同一次改动里更新三种语言和 `config.mts`。

## 一个最小功能改动

假设要让检测器在每个分格上记录 `confidence`（置信度）。

**1. 类型。** 在 `shared/types.ts` 的 `Panel` 上加可选字段：

```ts
export type Panel = {
  id: string
  rect: { x: number; y: number; w: number; h: number }
  source: 'auto' | 'manual' | 'merged'
  number?: number
  /** 检测器置信度，0..1。手动画的格没有这个值。 */
  confidence?: number
}
```

**2. 校验。** 在 `shared/format.ts` 的 `panelSpec` 里加字段。可选字段不要放进 `required`：

```ts
const panelSpec = object(
  {
    id: str({ minLength: 1 }),
    rect: rectSpec,
    source: str({ enum: ['auto', 'manual', 'merged'] }),
    number: int({ min: 1 }),
    confidence: num({ min: 0, max: 1 }),
  },
  ['id', 'rect'],
)
```

**3. 规范化。** `server/storage.ts` 的 `normalizeDoc` 会逐字段重建分格。少了这一步，值在写盘前就丢了：

```ts
.map((p, i) => ({
  id: typeof p.id === 'string' && p.id ? p.id : `p${i + 1}`,
  source: p.source === 'auto' || p.source === 'merged' ? p.source : ('manual' as const),
  number: Number.isFinite(p.number) ? Math.max(1, Math.round(Number(p.number))) : undefined,
  confidence: Number.isFinite(p.confidence) ? clamp(Number(p.confidence), 0, 1) : undefined,
  rect: { /* 不变 */ },
}))
```

**4. 产生值。** 在生成分格的地方赋值，例如 `server/detect.ts`；想让插件也能报，就改 `server/plugins.ts`。当前插件协议没有逐格元数据，需要把字段加在每个矩形上。

**5. 测试。** 在 `tests/unit/formats.test.ts` 里断言：带 `confidence` 的 v1 页面能通过校验，同一分格上的未知字段写入后仍然存在。

**6. 界面与文档。** 在分格属性面板里显示它，并在 `src/i18n/en.ts`、`zh.ts`、`ja.ts` 补标签。用户能看到的话，把它写进[数据格式](/zh/development/data-formats)。

这里最值得记住的一点：只改 TypeScript 类型永远不够。类型、校验、规范化、测试四处必须一致，否则值会在第一次保存时消失。

## 提 PR 之前

- 目标分支是 `dev`，并已 rebase 到最新。
- `lint`、`typecheck`、`test`、`docs:build` 全部通过。
- 新行为在对应区域的测试里有覆盖；没有的话，简短说明原因。
- 面向用户的改动在三语页面里都更新了。
- 值得记录的变更写进 `CHANGELOG.md` 的 `[Unreleased]`。
- 不提交漫画页面、个人数据或密钥。README 截图只能使用示例卷，并保留 README 里已有的版权声明。
