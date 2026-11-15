# コントリビュート

改善への参加を歓迎します。このページは、すでにリポジトリを clone した人向けの短い版です。正式なチェックリストはリポジトリ直下の `CONTRIBUTING.md` にあります。

## ブランチ

| ブランチ | 用途 |
| --- | --- |
| `main` | リリース済みのコード。リリースのマージだけで更新。 |
| `dev` | 統合ブランチ。機能はまずここへ。 |
| `feat/<slug>`、`fix/<slug>`、`chore/<slug>`、`docs/<slug>` | `dev` から切る短期ブランチ。 |

プルリクエストは `dev` 宛てに出します。レビューを依頼する前に最新の `dev` へ rebase してください。

## コミットメッセージ

[Conventional Commits](https://www.conventionalcommits.org/) を採用し、`commit-msg` フックで `commitlint` が検証します。

```text
<type>(<scope>): <subject>
```

よく使う type は `feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`build`、`ci`、`chore`、`revert`。命令形・小文字・末尾ピリオドなしで書きます。

- `feat(reader): add side-by-side gutter control`
- `fix(export): keep panel notes when image mode is embed`
- `docs(guide): document .mnproj storage modes`

Husky がコミット時に `lint-staged` を実行します。TS/TSX は ESLint `--fix`、JS/CJS/MJS/JSON/Markdown/YAML/CSS/HTML は Prettier です。作業途中のコミットだけ `git commit --no-verify` を使い、PR 前に片付けてください。

## コードスタイル

- TypeScript の strict モード。モジュール境界では型を明示する。
- ESLint のフラット設定（`eslint.config.js`）が正しさ、Prettier が整形を担当。Prettier と重複するスタイル規則は追加しない。
- サーバーは ESM TypeScript で、import に `.ts` 拡張子を付けます。`server/`、`shared/`、`src/` に CommonJS は書きません。
- `shared/` は `node:` モジュールを import せず、DOM にも触れません。両側が依存しています。
- 画面の文言はすべて `src/i18n/`（`en`、`zh`、`ja`）。コンポーネントへの中国語の直書きは `npm run i18n:scan:strict` で止まります。
- サーバーのエラーと警告の文言は `server/messages/catalog.ts` にコード単位で置きます。
- ドキュメントは三言語そろえ、`docs/.vitepress/config.mts` のナビとサイドバーにも追加します。

## 検査

プッシュ前に実行します。

```bash:no-line-numbers
npm run lint
npm run typecheck
npm test
npm run i18n:scan
npm run docs:build
```

テストは `tests/unit/` にあります。形式、検出、ライブラリを触るときに関係が深いのは `formats.test.ts`、`project.test.ts`、`detect.test.ts`、`dirRules.test.ts`、`library.test.ts` です。画面だけの変更に単体テストはないので、ブラウザーで 1440px と 390px の両方を確認します。

`npm run docs:build` はリンク切れで失敗するため、ページ名を変えるときは三言語と `config.mts` を同じ変更で更新します。

## 最小の機能追加

各コマに `confidence`（検出の確信度）を記録したいとします。

**1. 型。** `shared/types.ts` の `Panel` に任意フィールドを足します。

```ts
export type Panel = {
  id: string
  rect: { x: number; y: number; w: number; h: number }
  source: 'auto' | 'manual' | 'merged'
  number?: number
  /** 検出器の確信度 0..1。手動のコマにはありません。 */
  confidence?: number
}
```

**2. スキーマ。** `shared/format.ts` の `panelSpec` に追加します。任意フィールドは `required` に入れません。

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

**3. 正規化。** `server/storage.ts` の `normalizeDoc` はコマをフィールド単位で作り直します。この段階がないと、値はディスクに届く前に消えます。

```ts
.map((p, i) => ({
  id: typeof p.id === 'string' && p.id ? p.id : `p${i + 1}`,
  source: p.source === 'auto' || p.source === 'merged' ? p.source : ('manual' as const),
  number: Number.isFinite(p.number) ? Math.max(1, Math.round(Number(p.number))) : undefined,
  confidence: Number.isFinite(p.confidence) ? clamp(Number(p.confidence), 0, 1) : undefined,
  rect: { /* 変更なし */ },
}))
```

**4. 値を入れる。** コマを生成する場所で設定します。たとえば `server/detect.ts`。プラグインからも報告したいなら `server/plugins.ts` を変えます。現在のプラグイン契約にコマ単位のメタデータはないので、各矩形にフィールドを足すことになります。

**5. テスト。** `tests/unit/formats.test.ts` に、`confidence` 付きの v1 ページが検証を通ること、同じコマの未知フィールドが書き込み後も残ることを追加します。

**6. 画面と文書。** コマのインスペクターに表示し、`src/i18n/en.ts`、`zh.ts`、`ja.ts` にラベルを足します。利用者に見えるなら[データ形式](/ja/development/data-formats)にも書きます。

ここで覚えておきたいのは、TypeScript の型を足すだけでは足りないということです。型、スキーマ、正規化、テストの四つがそろわないと、最初の保存で値が消えます。

## プルリクエストの前

- 宛先は `dev` で、最新に rebase 済み。
- `lint`、`typecheck`、`test`、`docs:build` が通る。
- 新しい挙動はその領域のテストで押さえられている。ない場合は理由を短く書く。
- 利用者に見える変更は三言語のページすべてに反映されている。
- 記録に値する変更は `CHANGELOG.md` の `[Unreleased]` に書く。
- 漫画のページ、個人情報、秘密情報を入れない。README 用のスクリーンショットはサンプル巻のみを使い、README にある権利表記を残す。
