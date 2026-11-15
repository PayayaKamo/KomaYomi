# コマ分割プラグイン

コマ分割プラグインは、自分が対象とするページで内蔵検出器の代わりに動きます。プラグインはごく普通の JavaScript モジュールで、**サーバープロセスの中**で読み込まれます。子プロセスでもシェルスクリプトでもありません。stdin/stdout のプロトコル、外側のランナーによるタイムアウト、読むべき終了コードはありません。契約は矩形を返す関数だけです。

このページは `server/plugins.ts` の実際の挙動を書いたものです。プラグインを外部プログラムとして説明していた古いメモの訂正でもあります。

## 置き場所

| 場所 | 用途 |
| --- | --- |
| `plugins/`（リポジトリ直下） | プロジェクトと一緒に管理するプラグイン。 |
| `data/plugins/` | ライブラリのデータと一緒に置くプラグイン。 |

どちらも呼び出しのたびに走査されます。`.mjs`、`.cjs`、`.js` が対象で、ドットで始まるファイルは除外されます。一覧は `fs.readdirSync` の順なので、**アルファベット順の優先度を当てにしないでください**。重なるプラグインを積むのではなく、`match` を正確に書きます。

ファイルを編集しても再起動は不要です。import のたびに mtime をクエリ文字列として付け、キャッシュを避けています。

## 契約

プラグインは関数かオブジェクトを default export します。

```ts
type PanelRect = { x: number; y: number; w: number; h: number } // 0..1 に正規化

type PluginPanelInfo = {
  width: number        // 検出した画像の幅（ピクセル）
  height: number
  volume: string
  chapter: string
  pageIndex: number    // 0 始まり
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

関数を export した場合は `panels()` として扱われ、プラグイン名は拡張子込みのファイル名になります。

### マッチング

- 文字列は大文字小文字を区別しない部分一致です。
- `RegExp` は `.test()` で判定します。
- 書いたフィールドはすべて一致する必要があります。`match` を省くと全ページに一致し、開発中は便利ですが残すと危険です。
- `file` は拡張子込みの画像ファイル名です。

### 結果と失敗

- 矩形の配列、または `panels` と任意の `warnings` を持つオブジェクトを返します。
- 空配列は失敗です。例外を投げた場合や、**2500 ミリ秒**を超える実行も失敗です。
- 失敗すると内蔵検出器に戻り、警告が表示されます。壊れたプラグインでページが空白になることはありません。
- `x`、`y`、`w`、`h` は `0..1` に丸められ、幅と高さの最小値は `0.005` です。
- `warnings` は検出結果と CLI 出力に出ますが、処理全体を失敗させません。

プラグインは Node の権限をそのまま持ちます。ファイル、ネットワーク、環境変数に触れます。信頼できるものだけを入れてください。

## 例 1: 固定の 2×2 グリッド

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

この正規表現は名前に "example" を含む巻に一致します。実際のライブラリでは `match: { volume: '点兔第14卷', chapter: '172' }` のように巻フォルダー名に置き換えてください。

## 例 2: `.cjs` で横三段

CommonJS でも書き方は同じで、default export は `module.exports` です。

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

`chapter: /^\d+$/` により、数字だけの章フォルダーに限定されます。

## 例 3: 警告を返す

ページの寸法が想定外でも、使えそうな推測があるなら配列ではなくオブジェクトを返します。

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

## 有効化と試運転

1. ファイルを `plugins/` または `data/plugins/` に置きます。
2. アプリで **プラグイン** ダイアログを開きます（サイドバーでフォルダールールや交換ファイルの隣）。このダイアログは読み取り専用で、各ファイル、宣言された名前、`match` の要約、読み込みエラーとエラーコードを表示します。編集後は**更新**を押します。
3. 対象ページを開き、コマ調整ワークベンチで**分割**を実行します。次の書き込みでページ JSON に `detectSource: "plugin"` と `detectorVersion: "plugin:<名前>"` が記録されます。
4. ブラウザーを開かずに試すこともできます。

```bash:no-line-numbers
node scripts/manga-cli.ts plugins
node scripts/manga-cli.ts detect --volume <巻> --chapter <章> --pages 1 --plugin example-2x2-grid --apply
```

`plugins` はダイアログと同じ一覧を出します。`detect` は `--apply` を付けなければ試運転です。`--auto` はプラグインが一致しても内蔵検出器を強制します。

優先順位は常に **レイアウトテンプレート → プラグイン → 内蔵検出器** です。ページにレイアウトテンプレートが結びついている場合、プラグインは呼ばれません。

## 困ったとき

| 症状 | エラーコード | 原因と対処 |
| --- | --- | --- |
| ダイアログの行が赤い | `ERR_PLUGIN_NO_EXPORT` | 関数も `panels()` を持つオブジェクトも export されていません。default export を確認。 |
| 構文・読み込みエラーが出る | — | Node がファイルを読めていません。メッセージは生の例外です。拡張子と import 先を確認。 |
| 自動検出に戻る | `ERR_PLUGIN_TIMEOUT` | `panels()` が 2500 ミリ秒を超えました。重い処理はモジュール読み込み時に一度だけ。 |
| 自動検出に戻る | `ERR_PLUGIN_NO_PANELS` | `[]` を返しています。空を返すのは設計上「失敗」で、「コマなし」ではありません。 |
| プラグインが呼ばれない | `ERR_PLUGIN_NONE` | 一致するファイルがないか、レイアウトテンプレートが先に適用されています。実際の巻・章・ファイル名で `match` を確認。 |
| 後ろのプラグインが動かない | — | 読み込みに失敗したファイルがあると、その時点で探索が止まります。壊れたファイルを直すか削除。 |
| 編集が反映されない | — | ダイアログの一覧は**更新**まで保持されます。ページも保存済みのコマを保持するので、もう一度分割が必要です。 |

## セキュリティと可搬性

- プラグインは信頼済みコードです。ファイルを読み、ネットワークへ出られます。
- プラグインはデータではなくコードです。`.mnproj` を書き出しても `plugins/` は含まれません。別にコピーしてください。
- 静的オンライン版はサーバープロセスを持たないため、プラグインは動きません。[カスタマイズ開発の概要](/ja/development/#ローカル版だけの機能)を参照してください。
