/**
 * Server-side message catalog (English / Chinese / Japanese).
 *
 * Every user-visible sentence produced by `server/` and `scripts/` lives here so a
 * response only carries a code plus its interpolation parameters. The message text is
 * rendered at the boundary (HTTP handler or CLI) in the negotiated language, which
 * keeps stored data and domain logic language-neutral.
 *
 * Codes are public API: see `docs/server/error-codes.md` before renaming one.
 */
export const MESSAGE_LANGS = ['en', 'zh', 'ja'] as const;
export type MessageLang = (typeof MESSAGE_LANGS)[number];

export type MessageParams = Record<string, string | number | undefined>;

type Catalogue = Record<string, Record<MessageLang, string>>;

export const MESSAGES = {
  /* ---------------------------------- generic --------------------------------- */
  ERR_INTERNAL: {
    en: 'Unexpected server error: {detail}',
    zh: '服务器内部错误：{detail}',
    ja: 'サーバー内部エラー：{detail}',
  },
  ERR_INVALID_JSON: {
    en: 'Request body is not valid JSON: {detail}',
    zh: '请求内容不是有效的 JSON：{detail}',
    ja: 'リクエスト本文が有効な JSON ではありません：{detail}',
  },
  ERR_BODY_TOO_LARGE: {
    en: 'Request body is too large (limit {limit} MB)',
    zh: '请求体过大（上限 {limit} MB）',
    ja: 'リクエストボディが大きすぎます（上限 {limit} MB）',
  },
  ERR_UNTRUSTED_HOST: {
    en: 'Request host is not trusted: {host}. This server only accepts loopback hostnames.',
    zh: '请求的主机不受信任：{host}。本服务只接受本机回环地址。',
    ja: '信頼できないホストからのリクエストです：{host}。このサーバーはローカル（ループバック）のみ受け付けます。',
  },
  ERR_UNTRUSTED_ORIGIN: {
    en: 'Cross-site request blocked (origin: {origin})',
    zh: '已拦截跨站请求（来源：{origin}）',
    ja: 'クロスサイトリクエストをブロックしました（オリジン：{origin}）',
  },
  ERR_UNSUPPORTED_CONTENT_TYPE: {
    en: 'Unsupported content type: {type}. Send application/json.',
    zh: '不支持的内容类型：{type}，请使用 application/json。',
    ja: '未対応の Content-Type です：{type}。application/json を使用してください。',
  },
  ERR_UNKNOWN_ENDPOINT: {
    en: 'Unknown API endpoint: {path}',
    zh: '未知接口：{path}',
    ja: '不明な API エンドポイント：{path}',
  },
  ERR_FILE_NOT_FOUND: {
    en: 'File not found: {path}',
    zh: '文件不存在：{path}',
    ja: 'ファイルが見つかりません：{path}',
  },
  ERR_EXPORT_FILE_NOT_FOUND: {
    en: 'Export file not found: {path}',
    zh: '导出文件不存在：{path}',
    ja: 'エクスポートファイルが見つかりません：{path}',
  },

  /* ---------------------------------- images ---------------------------------- */
  ERR_IMAGE_NOT_FOUND: {
    en: 'Image not found: {path}',
    zh: '图片不存在：{path}',
    ja: '画像が見つかりません：{path}',
  },
  ERR_THUMB_SOURCE_MISSING: {
    en: 'Thumbnail source not found: {src}',
    zh: '缩略图源不存在：{src}',
    ja: 'サムネイルの元画像が見つかりません：{src}',
  },
  ERR_THUMB_FETCH_FAILED: {
    en: 'Failed to fetch the thumbnail source: {detail}',
    zh: '缩略图获取失败：{detail}',
    ja: 'サムネイルの取得に失敗しました：{detail}',
  },
  ERR_THUMB_UNSUPPORTED: {
    en: 'This image format cannot be thumbnailed yet',
    zh: '缩略图暂不支持该格式',
    ja: 'この画像形式のサムネイルはまだ作成できません',
  },
  ERR_UNSUPPORTED_IMAGE_FORMAT: {
    en: 'Unsupported image format ({format} / {ext})',
    zh: '暂不支持该图片格式（{format} / {ext}）',
    ja: '未対応の画像形式です（{format} / {ext}）',
  },
  ERR_REMOTE_UNAVAILABLE: {
    en: 'Remote source is temporarily unavailable ({detail}); cached pages can still be read',
    zh: '远端素材暂不可用（{detail}），已缓存的页仍可阅读',
    ja: 'リモート素材が一時的に利用できません（{detail}）。キャッシュ済みのページは閲覧できます',
  },
  ERR_ANNOTATION_IMAGE_INVALID: {
    en: 'Annotation image upload is invalid: {reason}',
    zh: '标注合成图上传无效：{reason}',
    ja: '注釈合成画像のアップロードが無効です：{reason}',
  },
  ERR_SHARE_IMAGE_INVALID: {
    en: 'Share image upload is invalid: {reason}',
    zh: '分享图上传无效：{reason}',
    ja: '共有画像のアップロードが無効です：{reason}',
  },

  /* ------------------------------ library & pages ----------------------------- */
  ERR_VOLUME_NOT_FOUND: {
    en: 'Volume not found: {volume}',
    zh: '找不到卷：{volume}',
    ja: '巻が見つかりません：{volume}',
  },
  ERR_CHAPTER_NOT_FOUND: {
    en: 'Chapter not found: {volume} / {chapter}',
    zh: '找不到章节：{volume} / {chapter}',
    ja: '話が見つかりません：{volume} / {chapter}',
  },
  ERR_PAGE_NOT_FOUND: {
    en: 'Page not found: {volume} / {chapter} page {page}',
    zh: '页面不存在：{volume} / {chapter} 第 {page} 页',
    ja: 'ページが見つかりません：{volume} / {chapter} {page} ページ',
  },
  ERR_MISSING_VOLUME_CHAPTER: {
    en: 'Volume and chapter are both required',
    zh: '缺少卷/话信息',
    ja: '巻と話の指定が不足しています',
  },
  ERR_MISSING_VOLUME: {
    en: 'Volume name is required',
    zh: '缺少卷名',
    ja: '巻名が指定されていません',
  },
  ERR_MISSING_VOLUME_DIRS: {
    en: 'Volume name and language directory configuration are required',
    zh: '缺少卷名或语言目录配置',
    ja: '巻名または言語ディレクトリ設定が不足しています',
  },
  ERR_CACHE_TARGET_INVALID: {
    en: 'Unknown cache target',
    zh: '未知的缓存类型',
    ja: '不明なキャッシュ種別です',
  },
  ERR_UNKNOWN_DIRECTION: {
    en: 'Unsupported reading direction',
    zh: '不支持的阅读方向',
    ja: '未対応の読む方向です',
  },
  ERR_PREPROCESS_NO_BACKUP: {
    en: 'There is no previous preprocessing result to restore',
    zh: '没有可回滚的上一次预处理结果',
    ja: '復元できる前回の前処理結果がありません',
  },
  ERR_RENAME_ORDER: {
    en: 'Page order must list every page exactly once',
    zh: '页序必须且只能包含每一页一次',
    ja: 'ページ順は各ページをちょうど 1 回ずつ指定してください',
  },
  ERR_RENAME_CONFLICT: {
    en: 'Cannot rename: "{name}" already exists in this folder',
    zh: '无法改名：该目录下已存在「{name}」',
    ja: '名前を変更できません：このフォルダに「{name}」が既に存在します',
  },
  ERR_RENAME_FAILED: {
    en: 'Batch rename failed and was rolled back: {detail}',
    zh: '批量改名失败，已回滚：{detail}',
    ja: '一括リネームに失敗したため元に戻しました：{detail}',
  },
  ERR_SPLIT_FAILED: {
    en: 'Page split failed and was rolled back: {detail}',
    zh: '跨页拆分失败，已回滚：{detail}',
    ja: 'ページ分割に失敗したため元に戻しました：{detail}',
  },
  ERR_URL_NOT_HTTP: {
    en: 'Only http(s) links are supported',
    zh: '只支持 http(s) 链接',
    ja: 'http(s) のリンクのみ対応しています',
  },
  ERR_PAGE_NO_IMAGES: {
    en: 'This page has no image in any language',
    zh: '该页没有任何语言的图片',
    ja: 'このページにはどの言語の画像もありません',
  },
  ERR_PAGE_NO_PANELS: {
    en: 'This page has no panels to capture yet',
    zh: '这一页还没有分格可抓取',
    ja: 'このページにはまだ切り出せるコマがありません',
  },
  ERR_PAGE_SHAPE: {
    en: 'Page JSON must be an object',
    zh: '页面 JSON 应为对象',
    ja: 'ページ JSON はオブジェクトである必要があります',
  },
  ERR_PAGE_TARGET_MISSING: {
    en: 'Page JSON has no volume / chapter, and no import target was given',
    zh: '页面 JSON 缺少卷 / 话，或未指定导入目标',
    ja: 'ページ JSON に巻 / 話がなく、読み込み先も指定されていません',
  },
  ERR_PAGE_INDEX_INVALID: {
    en: 'Page JSON needs a valid zero-based pageIndex',
    zh: '页面 JSON 缺少有效的 pageIndex',
    ja: 'ページ JSON に有効な pageIndex（0 始まり）がありません',
  },
  ERR_PAGE_NOT_SAVED: {
    en: 'This page has no saved annotation data yet — save it first, then export',
    zh: '这一页还没有保存的批注数据，请先按保存再导出',
    ja: 'このページには保存された注釈がまだありません。先に保存してから書き出してください',
  },
  ERR_UNSAFE_SEGMENT: {
    en: 'Volume or chapter name contains unsafe characters',
    zh: '卷名或话号包含不安全字符',
    ja: '巻名または話番号に安全でない文字が含まれています',
  },
  ERR_DIR_UNSAFE: {
    en: 'Directory name must not contain ".."',
    zh: '目录不能包含 ..',
    ja: 'ディレクトリ名に .. は使用できません',
  },
  ERR_DIR_NAME_EMPTY: {
    en: 'Directory name is required',
    zh: '目录名不能为空',
    ja: 'ディレクトリ名を入力してください',
  },
  ERR_DIR_NAME_INVALID: {
    en: 'Directory name "{name}" contains illegal characters (no \\ / : * ? " < > |)',
    zh: '目录名「{name}」包含非法字符（不能有 \\ / : * ? " < > |）',
    ja: 'ディレクトリ名「{name}」に使用できない文字が含まれています（\\ / : * ? " < > | は不可）',
  },
  ERR_DIR_NOT_FOUND: {
    en: 'Directory not found: {path}',
    zh: '目录不存在：{path}',
    ja: 'ディレクトリが見つかりません：{path}',
  },
  ERR_DIR_NOT_IN_VOLUME: {
    en: '"{dir}" is not a subdirectory of {volume}',
    zh: '「{dir}」不是 {volume} 下的子目录',
    ja: '「{dir}」は {volume} のサブディレクトリではありません',
  },
  ERR_VOLUME_EXISTS: {
    en: 'A directory named "{name}" already exists under raw/ — pick another name or remove it first',
    zh: 'raw 下已存在同名目录「{name}」，请换个名字或先移除',
    ja: 'raw/ に同名のディレクトリ「{name}」が既にあります。別の名前を指定するか、先に削除してください',
  },
  ERR_PAGE_OFFSET_INVALID: {
    en: 'Invalid page offset for {lang}: "from" must be at least 1 and "to" cannot be smaller than "from"',
    zh: '{lang} 的页偏移无效：「从第 N 页」至少为 1，且「对齐到第 M 页」不能小于 N',
    ja: '{lang} のページオフセットが不正です。「開始ページ」は 1 以上、「対応先ページ」は開始ページ以上にしてください',
  },
  ERR_VOLUME_LAYOUT_UNRECOGNIZED: {
    en: 'No language directory was found here. This looks like a series or multi-volume folder — point to one concrete volume, or assign a language directory in Volume settings.',
    zh: '这里没有识别到语言目录。看起来是系列/多卷结构，请指向具体某一卷，或在「卷设置」中手动指定语言目录。',
    ja: 'ここに言語ディレクトリが見つかりません。シリーズ／複数巻の構造に見えます。特定の巻を指定するか、「巻設定」で言語ディレクトリを手動指定してください。',
  },
  ERR_LINK_CREATE_FAILED: {
    en: 'Failed to create the directory link: {detail}',
    zh: '创建目录链接失败：{detail}',
    ja: 'ディレクトリリンクの作成に失敗しました：{detail}',
  },

  /* --------------------------------- templates -------------------------------- */
  ERR_PANEL_TEMPLATE_EMPTY: {
    en: 'The template has no panels',
    zh: '模板没有格子',
    ja: 'テンプレートにコマがありません',
  },
  ERR_LAYOUT_NOT_FOUND: {
    en: 'Layout template not found: {layoutId}',
    zh: '版式模板不存在：{layoutId}',
    ja: 'レイアウトテンプレートが見つかりません：{layoutId}',
  },
  ERR_LAYOUT_SAVE_INVALID: {
    en: 'Layout template is missing grid.rows and cannot be saved',
    zh: '版式模板缺少 grid.rows，无法保存',
    ja: 'レイアウトテンプレートに grid.rows がないため保存できません',
  },
  ERR_ALIGN_PRESET_MISSING_FIELDS: {
    en: 'Alignment preset needs a name, volume and chapter',
    zh: '预设缺少名称/卷/话',
    ja: '整列プリセットに名前・巻・話が必要です',
  },
  ERR_ALIGN_PRESET_NOT_FOUND: {
    en: 'Alignment preset not found: {presetId}',
    zh: '找不到对齐预设：{presetId}',
    ja: '整列プリセットが見つかりません：{presetId}',
  },
  ERR_HISTORY_VERSION_NOT_FOUND: {
    en: 'That page version no longer exists (it may have been pruned)',
    zh: '该页面版本已不存在（可能已按保留条数淘汰）',
    ja: 'そのページ版は存在しません（保持件数により削除された可能性があります）',
  },
  ERR_EXPORT_TEMPLATE_NOT_FOUND: {
    en: 'Export template not found: {templateId}',
    zh: '导出模板不存在：{templateId}',
    ja: 'エクスポートテンプレートが見つかりません：{templateId}',
  },
  DEFAULT_NAME_LAYOUT: {
    en: 'Untitled layout',
    zh: '未命名版式',
    ja: '無題のレイアウト',
  },
  DEFAULT_NAME_PANEL_TEMPLATE: {
    en: 'Untitled panel template',
    zh: '未命名分格模板',
    ja: '無題のコマテンプレート',
  },
  DEFAULT_NAME_ALIGN_PRESET: {
    en: 'Untitled alignment preset',
    zh: '未命名对齐预设',
    ja: '無題の整列プリセット',
  },
  DEFAULT_NAME_EXPORT_TEMPLATE: {
    en: 'Untitled export template',
    zh: '未命名导出模板',
    ja: '無題のエクスポートテンプレート',
  },
  DEFAULT_NAME_LAYOUT_PAGE: {
    en: '{chapter} page {page} layout',
    zh: '{chapter} 第 {page} 页版式',
    ja: '{chapter} {page} ページのレイアウト',
  },
  DEFAULT_NAME_IMPORTED_LAYOUT: {
    en: 'Imported layout template',
    zh: '导入的版式模板',
    ja: '読み込んだレイアウトテンプレート',
  },
  DEFAULT_NAME_IMPORTED_EXPORT_TEMPLATE: {
    en: 'Imported export template',
    zh: '导入的导出模板',
    ja: '読み込んだエクスポートテンプレート',
  },

  /* --------------------------------- exchange --------------------------------- */
  LABEL_LAYOUT_TEMPLATE: {
    en: 'layout template',
    zh: '版式模板',
    ja: 'レイアウトテンプレート',
  },
  LABEL_EXPORT_TEMPLATE: {
    en: 'export template',
    zh: '导出模板',
    ja: 'エクスポートテンプレート',
  },
  LABEL_PAGE_JSON: {
    en: 'page JSON',
    zh: '页面 JSON',
    ja: 'ページ JSON',
  },
  ERR_EXCHANGE_EMPTY_FILE: {
    en: 'No {label} file content received',
    zh: '没有收到{label}文件内容',
    ja: '{label}ファイルの内容を受信できませんでした',
  },
  ERR_EXCHANGE_INVALID_JSON: {
    en: 'The {label} is not valid JSON — the wrong file may have been chosen',
    zh: '{label}不是有效的 JSON，可能选错了文件',
    ja: '{label}が有効な JSON ではありません。別のファイルを選んだ可能性があります',
  },
  ERR_EXCHANGE_VALIDATION: {
    en: 'The {label} is malformed: {errors}',
    zh: '{label}格式不正确：{errors}',
    ja: '{label}の形式が正しくありません：{errors}',
  },
  ERR_EXCHANGE_VOLUME_REQUIRED: {
    en: 'Choose the volume to bind this file to first',
    zh: '请先选择要绑定的卷',
    ja: '先に紐付ける巻を選択してください',
  },
  ERR_EXCHANGE_CHAPTER_REQUIRED: {
    en: 'Binding to a chapter or page requires a valid chapter number',
    zh: '绑定到话 / 页时必须提供有效的话号',
    ja: '話 / ページに紐付けるには有効な話番号が必要です',
  },
  ERR_EXCHANGE_PAGE_INDEX_REQUIRED: {
    en: 'Binding to a single page requires a zero-based page index',
    zh: '绑定到单页时必须提供 0 起的页序',
    ja: '単一ページに紐付けるには 0 始まりのページ番号が必要です',
  },
  ERR_EXPORT_TEMPLATE_SHAPE: {
    en: 'The export template must be a JSON object (or an array in data/templates/export.json)',
    zh: '导出模板应为 JSON 对象（或 data/templates/export.json 的数组）',
    ja: 'エクスポートテンプレートは JSON オブジェクト（または data/templates/export.json の配列）である必要があります',
  },

  /* ---------------------------------- export ---------------------------------- */
  ERR_EXPORT_EMPTY: {
    en: 'Nothing to export — add panels or notes to a page first',
    zh: '没有可导出的页面（请先给页面分格或写批注）',
    ja: '書き出せるページがありません（先にコマ分割かノートを追加してください）',
  },

  /* ----------------------------- project / backup ----------------------------- */
  ERR_PROJECT_EMPTY: {
    en: 'No project file content received',
    zh: '没有收到工程文件内容',
    ja: 'プロジェクトファイルの内容を受信できませんでした',
  },
  ERR_PROJECT_IMAGE_ENTRY: {
    en: 'An image entry in the project file is missing its volume / chapter / filename',
    zh: '工程文件里的图片条目缺少卷 / 话 / 文件名',
    ja: 'プロジェクトファイル内の画像項目に巻 / 話 / ファイル名がありません',
  },
  ERR_MANIFEST_INVALID_JSON: {
    en: 'manifest.json is not valid JSON — this may not be a .mnproj project file',
    zh: 'manifest.json 不是有效的 JSON，可能不是 .mnproj 工程文件',
    ja: 'manifest.json が有効な JSON ではありません。.mnproj プロジェクトファイルではない可能性があります',
  },
  ERR_MANIFEST_NOT_OBJECT: {
    en: 'manifest.json has the wrong shape (a JSON object is expected)',
    zh: 'manifest.json 结构不正确（应为 JSON 对象）',
    ja: 'manifest.json の構造が正しくありません（JSON オブジェクトが必要です）',
  },
  ERR_MANIFEST_NO_INVENTORY: {
    en: 'The project file has no inventory (volume/chapter list)',
    zh: '工程文件缺少 inventory（卷话清单）',
    ja: 'プロジェクトファイルに inventory（巻・話の一覧）がありません',
  },
  ERR_MANIFEST_INCOMPLETE: {
    en: 'The project manifest is incomplete: {errors}',
    zh: '工程 manifest 数据不完整：{errors}',
    ja: 'プロジェクト manifest のデータが不完全です：{errors}',
  },
  ERR_MANIFEST_MISSING: {
    en: 'The archive has no manifest.json — this may not be a .mnproj project file',
    zh: '压缩包里没有 manifest.json，可能不是 .mnproj 工程文件',
    ja: 'アーカイブに manifest.json がありません。.mnproj プロジェクトファイルではない可能性があります',
  },
  ERR_PROJECT_NOT_LINKED: {
    en: 'No project file is open — open a .mnproj first, saves are written back to it',
    zh: '当前没有打开工程文件，请先打开 .mnproj，之后的保存会写回该文件',
    ja: 'プロジェクトファイルを開いていません。先に .mnproj を開くと、保存内容がそのファイルに書き戻されます',
  },
  ERR_PROJECT_PATH_INVALID: {
    en: 'The project path must be an absolute path to a .mnproj (or .zip) file',
    zh: '工程路径无效：需要指向 .mnproj（或 .zip）文件的绝对路径',
    ja: 'プロジェクトのパスが無効です。.mnproj（または .zip）ファイルへの絶対パスが必要です',
  },
  ERR_PROJECT_FILE_MISSING: {
    en: 'Project file not found: {path} — it may have been moved or deleted',
    zh: '找不到工程文件：{path}，可能已被移动或删除',
    ja: 'プロジェクトファイルが見つかりません：{path}。移動または削除された可能性があります',
  },
  ERR_PROJECT_WRITE_FAILED: {
    en: 'Could not write the project file: {detail}. The previous file is kept.',
    zh: '写回工程文件失败：{detail}。原文件保持未改动。',
    ja: 'プロジェクトファイルへの書き戻しに失敗しました：{detail}。元のファイルはそのまま残っています',
  },
  ERR_PROJECT_SAVE_AS_LINKED: {
    en: 'This is the project file you opened — use Save to write back to it, or choose another name',
    zh: '这是当前打开的工程文件，请用「保存」写回，或另选文件名',
    ja: 'これは開いているプロジェクトファイルです。「保存」で書き戻すか、別の名前を選んでください',
  },
  ERR_LIBRARY_NOT_OBJECT: {
    en: 'library.json is not a JSON object',
    zh: 'library.json 不是 JSON 对象',
    ja: 'library.json が JSON オブジェクトではありません',
  },
  ERR_SCHEMA_TOO_NEW: {
    en: 'This file was written by a newer KomaYomi (schema v{found}, this build supports v{supported}); it stays read-only until you upgrade',
    zh: '该文件来自更高版本（schema v{found}，当前支持 v{supported}），升级前保持只读',
    ja: 'このファイルは新しいバージョンの KomaYomi で作成されています（schema v{found}、対応 v{supported}）。更新するまで読み取り専用です',
  },
  ERR_SCHEMA_MIGRATION: {
    en: 'Could not migrate {file} from schema v{from}: {detail}',
    zh: '无法把 {file} 从 schema v{from} 迁移：{detail}',
    ja: '{file} を schema v{from} から移行できません：{detail}',
  },
  ERR_BACKUP_NOT_KOMAYOMI: {
    en: 'The archive has no data/ directory — this may not be a KomaYomi backup',
    zh: '压缩包里没有 data/ 目录，可能不是本工具的备份',
    ja: 'アーカイブに data/ ディレクトリがありません。KomaYomi のバックアップではない可能性があります',
  },
  ERR_SECRETS_DECRYPT_FAILED: {
    en: 'Stored storage credentials could not be decrypted; the secrets file was left unchanged. Restore the matching .secret.key, or delete the secrets file and re-enter the passwords.',
    zh: '无法解密已保存的存储凭据；密钥与凭据文件均已原样保留。请恢复匹配的 .secret.key，或删除凭据文件后重新输入密码。',
    ja: '保存された認証情報を復号できませんでした。ファイルは変更していません。対応する .secret.key を復元するか、認証情報ファイルを削除してパスワードを再入力してください。',
  },
  ERR_PAGE_CORRUPT: {
    en: 'The saved data for page {page} of {volume}/{chapter} is damaged. Failed check: {detail}. File: {file}. Damaged file archived as: {archived}. Available backup: {backup}.',
    zh: '第 {page} 页（{volume}/{chapter}）的保存数据已损坏。校验失败：{detail}。文件：{file}。损坏文件已自动留档：{archived}。可用备份：{backup}。',
    ja: '{volume}/{chapter} の {page} ページの保存データが破損しています。失敗した検証：{detail}。ファイル：{file}。破損ファイルの退避先：{archived}。利用可能なバックアップ：{backup}。',
  },
  PAGE_CORRUPT_SYNTAX: {
    en: 'JSON parse failed ({detail})',
    zh: 'JSON 解析失败（{detail}）',
    ja: 'JSON 解析に失敗しました（{detail}）',
  },
  PAGE_CORRUPT_SHAPE: {
    en: 'top-level JSON is not an object',
    zh: '顶层 JSON 不是对象',
    ja: '最上位の JSON がオブジェクトではありません',
  },
  PAGE_CORRUPT_IO: {
    en: 'the file could not be read ({detail})',
    zh: '文件无法读取（{detail}）',
    ja: 'ファイルを読み込めません（{detail}）',
  },
  PAGE_CORRUPT_MISSING: {
    en: 'the file disappeared while being read',
    zh: '读取时文件已不存在',
    ja: '読み込み中にファイルが消えました',
  },
  PAGE_BACKUP_NONE: {
    en: 'none found',
    zh: '未找到可用备份',
    ja: '利用可能なバックアップはありません',
  },
  PAGE_ARCHIVE_FAILED: {
    en: 'could not archive (file may be locked)',
    zh: '无法自动留档（文件可能被占用）',
    ja: '自動退避できませんでした（ファイルが使用中の可能性）',
  },
  ERR_PAGE_SAVE_INVALID: {
    en: 'Page {page} failed schema validation and was not saved; the previous file is unchanged. Details: {detail}',
    zh: '第 {page} 页未通过 schema 校验，已放弃保存，上一份文件保持不变。详情：{detail}',
    ja: '{page} ページがスキーマ検証に通らず、保存を中止しました。既存ファイルは変更していません。詳細：{detail}',
  },
  ERR_PAGE_BUSY: {
    en: 'Page data file {file} is being written by another process. Nothing was changed; retry in a moment.',
    zh: '页面数据文件 {file} 正在被另一个进程写入，本次未做任何修改，请稍后重试。',
    ja: 'ページデータファイル {file} は別のプロセスが書き込み中です。今回は何も変更していません。しばらくしてから再試行してください。',
  },
  ERR_HISTORY_CORRUPT: {
    en: 'The version history for page {page} of {volume}/{chapter} is damaged and was left untouched. The page itself can still be opened; restore history from a backup.',
    zh: '第 {page} 页（{volume}/{chapter}）的版本历史已损坏，文件保持原样。页面本身仍可打开；请从备份恢复历史。',
    ja: '{volume}/{chapter} の {page} ページの版履歴が破損しています。ファイルは変更していません。ページ自体は開けます。バックアップから履歴を復元してください。',
  },
  ERR_LIBRARY_CONFIG_CORRUPT: {
    en: 'Library configuration (library.json) is damaged and was left untouched. Restore it from a backup before changing settings.',
    zh: '库配置（library.json）已损坏，文件保持原样。请先从备份恢复，再修改设置。',
    ja: 'ライブラリ設定（library.json）が破損しています。ファイルは変更していません。バックアップから復元してから設定を変更してください。',
  },
  ERR_AUTO_BACKUP_FAILED: {
    en: 'Scheduled backup failed: {detail}',
    zh: '定时备份失败：{detail}',
    ja: '定期バックアップに失敗しました：{detail}',
  },

  /* ---------------------------------- storage --------------------------------- */
  ERR_UNSAFE_PATH: {
    en: 'Illegal path: {path}',
    zh: '非法路径：{path}',
    ja: '不正なパスです：{path}',
  },
  ERR_PATH_ESCAPE: {
    en: 'Path escapes the storage root: {path}',
    zh: '路径越界：{path}',
    ja: 'パスがストレージのルート外を指しています：{path}',
  },
  ERR_STORAGE_READONLY: {
    en: 'This storage target is read-only: {name}',
    zh: '该存储为只读：{name}',
    ja: 'このストレージは読み取り専用です：{name}',
  },
  ERR_READ_ONLY: {
    en: 'Read mode is on: this change was not written to the project.',
    zh: '当前处于阅读模式：该改动不会写入项目。',
    ja: '閲覧モードのため、この変更はプロジェクトに書き込まれません。',
  },
  ERR_NOT_A_DIRECTORY: {
    en: 'Not a directory: {path}',
    zh: '不是目录：{path}',
    ja: 'ディレクトリではありません：{path}',
  },
  ERR_STORAGE_CONFIG_MISSING: {
    en: 'Storage configuration is required',
    zh: '缺少存储配置',
    ja: 'ストレージ設定が不足しています',
  },
  ERR_REMOTE_SOURCE_MISSING: {
    en: 'No remote image source has been configured yet',
    zh: '尚未配置远端素材目录',
    ja: 'リモート素材ディレクトリがまだ設定されていません',
  },
  ERR_STORAGE_TARGET_NOT_FOUND: {
    en: 'Storage target not found: {targetId}',
    zh: '存储目标不存在：{targetId}',
    ja: 'ストレージターゲットが見つかりません：{targetId}',
  },
  ERR_STORAGE_LIST_FAILED: {
    en: 'Cannot list the directory: {detail}',
    zh: '无法列出目录：{detail}',
    ja: 'ディレクトリを一覧できません：{detail}',
  },
  ERR_BACKUP_UPLOAD_FAILED: {
    en: 'Backup upload failed: {detail}',
    zh: '备份上传失败：{detail}',
    ja: 'バックアップのアップロードに失敗しました：{detail}',
  },

  /* ---------------------------------- plugins --------------------------------- */
  ERR_PLUGIN_NO_EXPORT: {
    en: 'The module does not export a panels function',
    zh: '没有导出 panels 函数',
    ja: 'panels 関数がエクスポートされていません',
  },
  ERR_PLUGIN_LOAD: {
    en: 'The plugin could not be loaded',
    zh: '插件加载失败',
    ja: 'プラグインを読み込めませんでした',
  },
  ERR_PLUGIN_RUN_FAILED: {
    en: 'The plugin threw an error',
    zh: '插件执行时抛出异常',
    ja: 'プラグインの実行中にエラーが発生しました',
  },
  ERR_PLUGIN_BAD_RESULT: {
    en: 'The plugin returned an unsupported value (expected an array or { panels })',
    zh: '插件返回了不受支持的结果（应为数组或 { panels }）',
    ja: 'プラグインが未対応の値を返しました（配列または { panels } が必要です）',
  },
  ERR_PLUGIN_TIMEOUT: {
    en: 'The plugin timed out after {ms}ms',
    zh: '插件执行超时（{ms}ms）',
    ja: 'プラグインが {ms}ms でタイムアウトしました',
  },
  ERR_PLUGIN_NO_PANELS: {
    en: 'The plugin returned no panels',
    zh: '插件没有返回任何格子',
    ja: 'プラグインがコマを返しませんでした',
  },
  ERR_PLUGIN_NONE: {
    en: 'No matching plugin',
    zh: '没有匹配的插件',
    ja: '一致するプラグインがありません',
  },

  /* ----------------------------------- zip ------------------------------------ */
  ERR_ZIP_TOO_SMALL: {
    en: 'Not a valid archive (file is too small)',
    zh: '不是有效的压缩包（文件太小）',
    ja: '有効なアーカイブではありません（ファイルが小さすぎます）',
  },
  ERR_ZIP_NO_EOCD: {
    en: 'Not a valid archive (central directory not found)',
    zh: '不是有效的压缩包（找不到目录区）',
    ja: '有効なアーカイブではありません（セントラルディレクトリが見つかりません）',
  },
  ERR_ZIP_CORRUPT_DIR: {
    en: 'The archive directory is corrupted',
    zh: '压缩包目录损坏',
    ja: 'アーカイブのディレクトリが破損しています',
  },
  ERR_ZIP_ENTRY_CORRUPT: {
    en: 'Corrupted archive entry: {name}',
    zh: '压缩包条目损坏：{name}',
    ja: 'アーカイブ内の項目が破損しています：{name}',
  },
  ERR_ZIP_UNSUPPORTED_METHOD: {
    en: 'Unsupported compression method {method} ({name})',
    zh: '不支持的压缩方式 {method}（{name}）',
    ja: '未対応の圧縮方式 {method}（{name}）',
  },
  ERR_ZIP_ENTRY_SIZE: {
    en: 'Archive entry size mismatch: {name}',
    zh: '压缩包条目大小不符：{name}',
    ja: 'アーカイブ内の項目サイズが一致しません：{name}',
  },

  /* ------------------------------ directory rules ----------------------------- */
  ERR_RULE_EMPTY: {
    en: 'Pattern is empty',
    zh: '规则不能为空',
    ja: 'パターンが空です',
  },
  ERR_RULE_UNKNOWN_PLACEHOLDER: {
    en: 'Unknown placeholder {{{name}}}',
    zh: '未知的占位符 {{{name}}}',
    ja: '不明なプレースホルダー {{{name}}}',
  },
  ERR_RULES_NOT_ARRAY: {
    en: 'Rules must be a non-empty array',
    zh: '规则必须是非空数组',
    ja: 'ルールは空でない配列である必要があります',
  },
  ERR_RULE_NOT_OBJECT: {
    en: 'Rule #{index} is not an object',
    zh: '第 {index} 条规则不是对象',
    ja: '{index} 番目のルールがオブジェクトではありません',
  },
  ERR_RULE_PATTERN_MISSING: {
    en: 'Rule #{index} is missing "pattern"',
    zh: '第 {index} 条规则缺少 pattern',
    ja: '{index} 番目のルールに pattern がありません',
  },
  ERR_RULE_PATTERN_ABSOLUTE: {
    en: 'Rule #{index} must be a relative pattern without ".."',
    zh: '第 {index} 条规则必须是相对路径且不能包含 ..',
    ja: '{index} 番目のルールは相対パスで、.. を含められません',
  },
  ERR_RULE_PAGE_MISSING: {
    en: 'Rule #{index} needs a {page} placeholder',
    zh: '第 {index} 条规则需要 {page} 占位符',
    ja: '{index} 番目のルールには {page} プレースホルダーが必要です',
  },
  ERR_RULE_LANGUAGE_INVALID: {
    en: 'Rule #{index} has an invalid "language" value "{value}" (path separators are not allowed)',
    zh: '第 {index} 条规则的 language 值「{value}」无效（不能包含路径分隔符）',
    ja: '{index} 番目のルールの language 値「{value}」が無効です（パス区切り文字は使用できません）',
  },
  ERR_RULE_LANGUAGE_MISSING: {
    en: 'Rule #{index} needs a {language} placeholder or a "language" fallback',
    zh: '第 {index} 条规则需要 {language} 占位符或 language 默认值',
    ja: '{index} 番目のルールには {language} プレースホルダーか language の既定値が必要です',
  },
  ERR_RULE_DUPLICATE_ID: {
    en: 'Duplicate rule id "{id}"',
    zh: '规则 id 重复：「{id}」',
    ja: 'ルール id が重複しています：「{id}」',
  },

  /* --------------------------------- warnings --------------------------------- */
  LANG_NAME_JA: {
    en: 'Japanese',
    zh: '日文',
    ja: '日本語',
  },
  LANG_NAME_ZH: {
    en: 'Chinese',
    zh: '中文',
    ja: '中国語',
  },
  LANG_NAME_EN: {
    en: 'English',
    zh: '英文',
    ja: '英語',
  },
  WARN_DETECT_FROM_LAYOUT: {
    en: 'Panels taken from layout template "{name}"',
    zh: '按版式模板「{name}」切格',
    ja: 'レイアウトテンプレート「{name}」でコマ分割しました',
  },
  WARN_DETECT_FROM_PLUGIN: {
    en: 'Panels detected by plugin {plugin}',
    zh: '插件 {plugin} 切格',
    ja: 'プラグイン {plugin} でコマ分割しました',
  },
  WARN_PLUGIN_FAILED_FALLBACK: {
    en: 'Plugin {plugin} failed ({detail}); fell back to automatic detection',
    zh: '插件 {plugin} 失败（{detail}），已回退自动检测',
    ja: 'プラグイン {plugin} が失敗しました（{detail}）。自動検出に切り替えました',
  },
  WARN_TITLE_FETCH_FAILED: {
    en: 'Could not fetch the page title (network may be restricted) — you can type it manually',
    zh: '抓取标题失败（可能被网络限制），可以手动填写',
    ja: 'タイトルを取得できませんでした（ネットワーク制限の可能性）。手動で入力できます',
  },
  EXPORT_SOURCE: {
    en: 'Source: ',
    zh: '来源：',
    ja: '出典：',
  },
  WARN_PAGE_SKIPPED_NO_PANELS: {
    en: 'Page {page} has no panel data yet — skipped',
    zh: '第 {page} 页还没有分格数据，已跳过',
    ja: '{page} ページにはまだコマデータがありません。スキップしました',
  },
  WARN_EXPORT_AUTODETECTED: {
    en: 'Detected panels on {count} pages that had no layout yet',
    zh: '{count} 页此前没有分格数据，导出前已自动检测',
    ja: 'コマデータが無かった {count} ページを自動検出しました',
  },
  WARN_EXPORT_ANNOTATIONS_UNBAKED: {
    en: 'Page {page} has annotations, but Word received no composited image for it — exported without annotations',
    zh: '第 {page} 页有标注，但没有收到合成图，Word 中该页不含标注',
    ja: '{page} ページに注釈がありますが、合成画像を受け取れなかったため注釈なしで書き出しました',
  },
  WARN_EXPORT_STAGING_CLEANUP: {
    en: 'Could not remove temporary annotation images: {detail}',
    zh: '临时标注合成图清理失败：{detail}',
    ja: '一時的な注釈合成画像を削除できませんでした：{detail}',
  },
  WARN_PAGE_SKIPPED_NO_CONTENT: {
    en: 'Page {page} has no panels or notes yet — skipped',
    zh: '第 {page} 页还没有分格或笔记，已跳过',
    ja: '{page} ページにはまだコマもノートもありません。スキップしました',
  },
  WARN_PAGE_IMAGE_UNREADABLE: {
    en: 'Page {page}: the {lang} image cannot be decoded',
    zh: '第 {page} 页 {lang} 图片无法解析',
    ja: '{page} ページの {lang} 画像を読み込めません',
  },
  WARN_DIR_RULES_FALLBACK: {
    en: 'Directory rules are invalid ({detail}); fell back to the defaults',
    zh: '目录识别规则无效（{detail}），已回退默认规则',
    ja: 'ディレクトリ判定ルールが無効です（{detail}）。既定のルールに戻しました',
  },
  WARN_UNRECOGNIZED_DIRS: {
    en: 'Unrecognized directories: {dirs} (assign their language in Volume settings)',
    zh: '未识别的目录：{dirs}（可在「卷设置」里指定语言）',
    ja: '認識できないディレクトリ：{dirs}（「巻の設定」で言語を指定できます）',
  },
  WARN_LANGUAGE_PAGE_COUNT: {
    en: 'Language page counts differ: {counts} (pages are paired by page number; missing pages are flagged)',
    zh: '各语言页数不一致：{counts}（按页号配对，缺页会在页面上标注）',
    ja: '言語ごとのページ数が異なります：{counts}（ページ番号で対応付け、欠けたページは表示時に示します）',
  },
  WARN_MIXED_EXTENSIONS: {
    en: '{lang}: mixed file extensions in this chapter: {exts}',
    zh: '{lang} 本话内扩展名不统一：{exts}',
    ja: '{lang}：この話の中で拡張子が統一されていません：{exts}',
  },
  WARN_MISSING_PAGE: {
    en: '{lang}: page {page} is missing',
    zh: '{lang} 缺第 {page} 页',
    ja: '{lang}：{page} ページがありません',
  },
  WARN_FILENAME_MISMATCH: {
    en: '{lang}: file {name} does not match page {page}',
    zh: '{lang} 文件名 {name} 与第 {page} 页序号不符',
    ja: '{lang}：ファイル名 {name} が {page} ページの番号と一致しません',
  },
  WARN_NO_LANGUAGE_DIRS: {
    en: 'No language directories were recognized; check the directory rules or assign languages here',
    zh: '未识别到语言目录或目录结构不符合任何识别规则，请检查「目录识别」规则或在此指定语言目录',
    ja: '言語ディレクトリを認識できませんでした。「ディレクトリ判定」ルールを確認するか、ここで言語ディレクトリを指定してください',
  },
  WARN_SAME_NAME_VOLUME: {
    en: 'A directory with the same name already exists and was picked up automatically',
    zh: '同名目录已存在，已自动识别',
    ja: '同名のディレクトリが既にあり、自動的に認識しました',
  },
  WARN_EMPTY_VOLUME_CREATED: {
    en: 'Empty directory created — add images as raw/<volume>/<language>/<chapter>/01.jpg',
    zh: '已创建空目录，请把图片按 raw/卷名/语言/话号/01.jpg 放进去',
    ja: '空のディレクトリを作成しました。raw/巻名/言語/話番号/01.jpg の形で画像を追加してください',
  },
  WARN_NO_LANGUAGE_DIR_DETECTED: {
    en: 'No language directory was detected, so it was added as a single volume — assign directories in Volume settings',
    zh: '没有识别到语言目录，已按单卷添加，可在「卷设置」里指定语言目录',
    ja: '言語ディレクトリを認識できなかったため単一巻として追加しました。「巻の設定」で指定できます',
  },
  WARN_VOLUME_ALREADY_IN_LIBRARY: {
    en: '"{name}" is already in the library and was picked up automatically',
    zh: '「{name}」已在图库中，已自动识别',
    ja: '「{name}」は既にライブラリにあるため自動的に認識しました',
  },
  WARN_VOLUME_DIR_REMOVED: {
    en: 'The directory no longer exists and was removed from the library configuration',
    zh: '目录不存在，已从图库配置中移除',
    ja: 'ディレクトリが存在しないため、ライブラリ設定から削除しました',
  },
  WARN_REAL_DIRECTORY_KEPT: {
    en: 'Removed from the library. The folder under raw/ was kept: {path} — delete it by hand only if you no longer need it.',
    zh: '已从图库移除。raw 下的文件夹已保留：{path}，如不再需要请自行手动删除。',
    ja: 'ライブラリから削除しました。raw/ のフォルダは残しています：{path}。不要な場合のみ手動で削除してください。',
  },
  WARN_IMAGE_PATH_INVALID: {
    en: 'Cannot resolve the image path: {path}',
    zh: '图片路径无法解析：{path}',
    ja: '画像パスを解決できません：{path}',
  },
  WARN_IMAGE_MISSING: {
    en: 'Image not found — skipped: {path}',
    zh: '图片不存在，已跳过：{path}',
    ja: '画像が存在しないためスキップしました：{path}',
  },
  WARN_PAGE_JSON_INVALID: {
    en: 'Page JSON cannot be parsed: {path}',
    zh: '页面 JSON 无法解析：{path}',
    ja: 'ページ JSON を解析できません：{path}',
  },
  WARN_ENTRY_JSON_INVALID: {
    en: 'Cannot parse JSON — skipped: {name}',
    zh: 'JSON 无法解析，已跳过：{name}',
    ja: 'JSON を解析できないためスキップしました：{name}',
  },
  WARN_SUSPICIOUS_PATH: {
    en: 'Skipped a suspicious path: {name}',
    zh: '跳过可疑路径：{name}',
    ja: '疑わしいパスをスキップしました：{name}',
  },
  WARN_UNKNOWN_ENTRY: {
    en: 'Ignored an unknown entry: {name}',
    zh: '忽略未知条目：{name}',
    ja: '不明な項目を無視しました：{name}',
  },
  WARN_SNAPSHOT_FAILED: {
    en: 'Pre-restore snapshot failed: {detail}',
    zh: '恢复前快照失败：{detail}',
    ja: '復元前のスナップショットに失敗しました：{detail}',
  },
  WARN_PROJECT_COPY_FAILED: {
    en: 'Could not store the original project file: {detail}',
    zh: '保存原始工程文件失败：{detail}',
    ja: '元のプロジェクトファイルを保存できませんでした：{detail}',
  },
  WARN_JSON_MERGE_FALLBACK: {
    en: 'Cannot merge {name} (invalid JSON); existing content kept',
    zh: '无法合并 {name}（JSON 解析失败），已保留现有内容',
    ja: '{name} を結合できません（JSON 解析に失敗）。既存の内容を保持しました',
  },
  WARN_LIBRARY_MERGE_FALLBACK: {
    en: 'Cannot merge config/library.json; existing settings kept',
    zh: 'config/library.json 无法合并，已保留现有设置',
    ja: 'config/library.json を結合できません。既存の設定を保持しました',
  },
  WARN_RELINK_DIR_MISSING: {
    en: 'Relink directory does not exist or is not a folder: {dir}',
    zh: '补链目录不存在或不是文件夹：{dir}',
    ja: '再リンク先のディレクトリが存在しないか、フォルダではありません：{dir}',
  },
  WARN_UNSAFE_IMAGE_PATH: {
    en: 'Unsafe image path — skipped: {volume}/{chapter}/{name}',
    zh: '图片路径不安全，已跳过：{volume}/{chapter}/{name}',
    ja: '安全でない画像パスのためスキップしました：{volume}/{chapter}/{name}',
  },
  WARN_IMAGE_OVERWRITE_SKIPPED: {
    en: 'An image with the same name but different content already exists in raw/ — not overwritten: {volume}/{chapter}/{name}',
    zh: 'raw 里已存在同名但内容不同的图片，未覆盖：{volume}/{chapter}/{name}',
    ja: 'raw/ に同名で内容の異なる画像が既にあるため上書きしませんでした：{volume}/{chapter}/{name}',
  },
  ERR_RULE_PARSE: {
    en: 'Rule "{rule}" cannot be parsed: {detail}',
    zh: '规则「{rule}」无法解析：{detail}',
    ja: 'ルール「{rule}」を解析できません：{detail}',
  },
  WARN_RULE_LEVEL_MISMATCH: {
    en: 'Segments do not match the depth of rule "{rule}"',
    zh: '与规则「{rule}」的层级不匹配',
    ja: 'ルール「{rule}」の階層と一致しません',
  },
  WARN_RULE_NO_LANGUAGE: {
    en: 'The rule has no {language} segment and no language default',
    zh: '规则没有 {language} 段，也没有 language 默认值',
    ja: 'ルールに {language} セグメントも language の既定値もありません',
  },
  WARN_UNKNOWN_LANGUAGE_DIR: {
    en: 'Language directory "{dir}" is not recognized (assign it manually in Volume settings)',
    zh: '语言目录「{dir}」无法识别（可在卷设置里手动指定）',
    ja: '言語ディレクトリ「{dir}」を認識できません（巻の設定で手動指定できます）',
  },
  WARN_NO_RULE_MATCHED: {
    en: 'No rule matched',
    zh: '没有任何规则匹配',
    ja: 'どのルールにも一致しませんでした',
  },

  /* ------------------------------ storage status ------------------------------ */
  STATUS_STORAGE_LOCAL_OK: {
    en: 'Local directory is reachable',
    zh: '本地目录可访问',
    ja: 'ローカルディレクトリにアクセスできます',
  },
  STATUS_STORAGE_NETWORK_OK: {
    en: 'Network share is reachable',
    zh: '网络共享可访问',
    ja: 'ネットワーク共有にアクセスできます',
  },
  STATUS_STORAGE_DIR_NOT_CREATED: {
    en: 'The target directory does not exist yet and will be created on first write',
    zh: '目标目录尚未创建，首次写入时自动建立',
    ja: '対象ディレクトリはまだ存在しません。最初の書き込み時に作成します',
  },
  STATUS_STORAGE_ACCESS_FAILED: {
    en: 'Cannot access it: {detail}',
    zh: '无法访问：{detail}',
    ja: 'アクセスできません：{detail}',
  },
  STATUS_STORAGE_WEBDAV_OK: {
    en: 'WebDAV is reachable',
    zh: 'WebDAV 可访问',
    ja: 'WebDAV にアクセスできます',
  },
  STATUS_STORAGE_TIMEOUT: {
    en: 'Connection timed out',
    zh: '连接超时',
    ja: '接続がタイムアウトしました',
  },
  STATUS_STORAGE_UNREACHABLE: {
    en: 'Cannot connect',
    zh: '无法连接',
    ja: '接続できません',
  },

  /* -------------------------------- page history ------------------------------- */
  HISTORY_CREATED: {
    en: 'page data created',
    zh: '创建页面数据',
    ja: 'ページデータを作成',
  },
  HISTORY_PANELS: {
    en: 'panels {from}→{to}',
    zh: '格数 {from}→{to}',
    ja: 'コマ数 {from}→{to}',
  },
  HISTORY_PANEL_RECTS: {
    en: 'panel boxes adjusted',
    zh: '调整格框',
    ja: 'コマ枠を調整',
  },
  HISTORY_NOTES: {
    en: 'notes {from}→{to}',
    zh: '批注 {from}→{to}',
    ja: '注釈 {from}→{to}',
  },
  HISTORY_NOTE_EDIT: {
    en: 'notes edited',
    zh: '修改批注',
    ja: '注釈を編集',
  },
  HISTORY_DIRECTION: {
    en: 'reading direction',
    zh: '阅读方向',
    ja: '読み方向',
  },
  HISTORY_GROUPS: {
    en: 'groups',
    zh: '分组',
    ja: 'グループ',
  },
  HISTORY_ANNOTATIONS: {
    en: 'image annotations',
    zh: '图片标注',
    ja: '画像注釈',
  },
  HISTORY_ALIGN_MODE: {
    en: 'alignment mode',
    zh: '对齐模式',
    ja: '整列モード',
  },
  HISTORY_OFFSETS: {
    en: 'alignment offsets',
    zh: '对齐偏移',
    ja: '整列オフセット',
  },
  HISTORY_SAVE: {
    en: 'saved',
    zh: '保存',
    ja: '保存',
  },
  HISTORY_DETECTED: {
    en: 'panels detected by {version}',
    zh: '按 {version} 切格',
    ja: '{version} でコマ分割',
  },
  HISTORY_DETECT_RESET: {
    en: 'cleared {count} auto-detected panel(s)',
    zh: '已清除 {count} 个自动分格',
    ja: '自動検出のコマを {count} 件削除',
  },
  HISTORY_BEFORE_RESTORE: {
    en: 'state before restore',
    zh: '恢复前状态',
    ja: '復元前の状態',
  },
  HISTORY_RESTORED: {
    en: 'restored an earlier version',
    zh: '恢复到较早版本',
    ja: '以前の版に復元',
  },

  /* ----------------------------------- export ---------------------------------- */
  EXPORT_DIRECTION_RTL: {
    en: 'Reading direction: right to left · top to bottom',
    zh: '阅读方向：从右到左 · 从上到下',
    ja: '読み方向：右から左 · 上から下',
  },
  EXPORT_DIRECTION_LTR: {
    en: 'Reading direction: left to right · top to bottom',
    zh: '阅读方向：从左到右 · 从上到下',
    ja: '読み方向：左から右 · 上から下',
  },
  EXPORT_DIRECTION_TTB: {
    en: 'Reading direction: right to left · vertical',
    zh: '阅读方向：从右到左 · 竖排',
    ja: '読み方向：右から左 · 縦書き',
  },
  EXPORT_DIRECTION_HORIZONTAL_RL: {
    en: 'Reading direction: right to left · horizontal',
    zh: '阅读方向：从右到左 · 横排',
    ja: '読み方向：右から左 · 横書き',
  },
  EXPORT_DIRECTION_HORIZONTAL_LR: {
    en: 'Reading direction: left to right · horizontal',
    zh: '阅读方向：从左到右 · 横排',
    ja: '読み方向：左から右 · 横書き',
  },
  EXPORT_DIRECTION_VERTICAL_RL: {
    en: 'Reading direction: right to left · vertical',
    zh: '阅读方向：从右到左 · 竖排',
    ja: '読み方向：右から左 · 縦書き',
  },
  EXPORT_DIRECTION_VERTICAL_LR: {
    en: 'Reading direction: left to right · vertical',
    zh: '阅读方向：从左到右 · 竖排',
    ja: '読み方向：左から右 · 縦書き',
  },
  EXPORT_PAGE_NOTES: {
    en: 'Page notes',
    zh: '整页批注',
    ja: 'ページ全体の注釈',
  },
  EXPORT_PANEL_NO: {
    en: 'Panel {n}',
    zh: '第 {n} 格',
    ja: '{n} コマ目',
  },
  EXPORT_EMPTY_PANELS: {
    en: 'No panels on this page',
    zh: '本页暂无分格',
    ja: 'このページにコマはありません',
  },
  EXPORT_EMPTY_IMAGE: {
    en: 'No image available for this page',
    zh: '本页没有可用图片',
    ja: 'このページに利用できる画像がありません',
  },
  EXPORT_EMPTY_NOTES: {
    en: 'No notes yet',
    zh: '暂无批注',
    ja: '注釈はまだありません',
  },
  EXPORT_PAGE_ALT: {
    en: 'Page {n}',
    zh: '第 {n} 页',
    ja: '{n} ページ',
  },
  EXPORT_CHAPTER_LINE: {
    en: '{volume} · chapter {chapter}',
    zh: '{volume} · 第 {chapter} 话',
    ja: '{volume} · 第 {chapter} 話',
  },
  EXPORT_AT: {
    en: 'Exported at {time}',
    zh: '导出时间：{time}',
    ja: '書き出し日時：{time}',
  },
  EXPORT_FOOTER: {
    en: 'Exported by KomaYomi · {pages} page(s)',
    zh: '由 KomaYomi 导出 · 共 {pages} 页',
    ja: 'KomaYomi による書き出し · 全 {pages} ページ',
  },

  /* ------------------------------------ CLI ------------------------------------ */
  CLI_USAGE: {
    en: [
      'Usage: node scripts/manga-cli.ts <command> [options]',
      '  report [--narrow]                  scan all pages and print the panel-count distribution (--narrow lists edge slivers)',
      '  regress [--update]                 compare panel counts against scripts/detect-baseline.json',
      '  detect --volume V [--chapter C] [--pages 1,2] [--content-lang ja] [--plugin NAME] [--auto] [--apply] [--overwrite]',
      '  apply-layout --layout ID --volume V [--chapter C] [--pages 1,2]',
      '  apply-template --template ID --volume V --chapter C [--pages 1,2]',
      '  apply-align --preset ID --volume V --chapter C [--pages 1,2]',
      '  templates | layouts | plugins | align-presets',
      '  --lang en|zh|ja                    message language (default: $KOMAYOMI_LANG, $LANG, then English)',
    ].join('\n'),
    zh: [
      '用法：node scripts/manga-cli.ts <命令> [参数]',
      '  report [--narrow]                 扫描全部页面，输出格子数分布（--narrow 列出贴边窄条）',
      '  regress [--update]                与 scripts/detect-baseline.json 对比格子数',
      '  detect --volume V [--chapter C] [--pages 1,2] [--content-lang ja] [--plugin 名称] [--auto] [--apply] [--overwrite]',
      '  apply-layout --layout ID --volume V [--chapter C] [--pages 1,2]',
      '  apply-template --template ID --volume V --chapter C [--pages 1,2]',
      '  apply-align --preset ID --volume V --chapter C [--pages 1,2]',
      '  templates | layouts | plugins | align-presets',
      '  --lang en|zh|ja                    输出语言（默认取 $KOMAYOMI_LANG、$LANG，否则英文）',
    ].join('\n'),
    ja: [
      '使い方：node scripts/manga-cli.ts <コマンド> [オプション]',
      '  report [--narrow]                 全ページを走査してコマ数の分布を出力（--narrow で端の細いコマを一覧）',
      '  regress [--update]                scripts/detect-baseline.json とコマ数を比較',
      '  detect --volume V [--chapter C] [--pages 1,2] [--content-lang ja] [--plugin 名前] [--auto] [--apply] [--overwrite]',
      '  apply-layout --layout ID --volume V [--chapter C] [--pages 1,2]',
      '  apply-template --template ID --volume V --chapter C [--pages 1,2]',
      '  apply-align --preset ID --volume V --chapter C [--pages 1,2]',
      '  templates | layouts | plugins | align-presets',
      '  --lang en|zh|ja                    出力言語（既定：$KOMAYOMI_LANG、$LANG、なければ英語）',
    ].join('\n'),
  },
  CLI_ERROR: {
    en: 'Error: {detail}',
    zh: '出错了：{detail}',
    ja: 'エラー：{detail}',
  },
  CLI_REPORT_SUMMARY: {
    en: '{pages} page(s), {panels} panels in total, {avg} panels/page on average',
    zh: '页面 {pages} 页，格子合计 {panels}，平均 {avg} 格/页',
    ja: '{pages} ページ、コマ合計 {panels}、平均 {avg} コマ/ページ',
  },
  CLI_REPORT_HISTOGRAM: {
    en: 'Panel-count distribution: {dist}',
    zh: '格子数分布：{dist}',
    ja: 'コマ数の分布：{dist}',
  },
  CLI_REPORT_HISTOGRAM_ITEM: {
    en: '{panels}×{pages}p',
    zh: '{panels}格×{pages}页',
    ja: '{panels}コマ×{pages}ページ',
  },
  CLI_REPORT_NARROW: {
    en: 'Edge slivers found: {count}',
    zh: '贴边窄条共 {count} 个：',
    ja: '端の細いコマ：{count} 件',
  },
  CLI_REGRESS_BASELINE: {
    en: 'Wrote baseline {file} ({pages} pages)',
    zh: '已写入基线 {file}（{pages} 页）',
    ja: 'ベースライン {file} を書き込みました（{pages} ページ）',
  },
  CLI_REGRESS_RESULT: {
    en: 'Regression check done: {pages} pages, {diffs} differ',
    zh: '回归完成：{pages} 页，差异 {diffs} 页',
    ja: '回帰チェック完了：{pages} ページ、差分 {diffs} ページ',
  },
  CLI_DETECT_SKIPPED: {
    en: 'Skipped {page}: {reason}',
    zh: '跳过 {page}：{reason}',
    ja: '{page} をスキップ：{reason}',
  },
  CLI_DETECT_SKIPPED_EXISTING: {
    en: 'Skipped {page} (already has {panels} panels; add --overwrite to replace)',
    zh: '跳过 {page}（已有 {panels} 格，加 --overwrite 覆盖）',
    ja: '{page} をスキップ（既に {panels} コマあります。--overwrite で上書き）',
  },
  CLI_DETECT_PAGE: {
    en: '{page}: {panels} panels ({source}){state}{warn}',
    zh: '{page}: {panels} 格（{source}）{state}{warn}',
    ja: '{page}: {panels} コマ（{source}）{state}{warn}',
  },
  CLI_DETECT_WRITTEN: {
    en: ' — written',
    zh: '（已写入）',
    ja: '（書き込み済み）',
  },
  CLI_DETECT_PREVIEW: {
    en: ' — preview, add --apply to write',
    zh: '（预览，加 --apply 写入）',
    ja: '（プレビュー。--apply で書き込み）',
  },
  CLI_DETECT_WARNING_SUFFIX: {
    en: '  ⚠ {warnings}',
    zh: '  ⚠ {warnings}',
    ja: '  ⚠ {warnings}',
  },
  CLI_DETECT_DONE: {
    en: '{pages} page(s) processed',
    zh: '共处理 {pages} 页',
    ja: '{pages} ページを処理しました',
  },
  CLI_LAYOUT_APPLIED: {
    en: 'Applied layout "{name}" to {pages} page(s)',
    zh: '已把版式「{name}」套用到 {pages} 页',
    ja: 'レイアウト「{name}」を {pages} ページに適用しました',
  },
  CLI_LAYOUT_NONE: {
    en: 'No layout templates yet (data/layouts/*.json)',
    zh: '还没有版式模板（data/layouts/*.json）',
    ja: 'レイアウトテンプレートはまだありません（data/layouts/*.json）',
  },
  CLI_LAYOUT_ROW: {
    en: '{id}\t{name}\t{scope}\t{volume}\t{rows} rows × {cols} columns',
    zh: '{id}\t{name}\t{scope}\t{volume}\t{rows} 行 × {cols} 列',
    ja: '{id}\t{name}\t{scope}\t{volume}\t{rows} 行 × {cols} 列',
  },
  CLI_PLUGIN_NONE: {
    en: 'No panel plugins yet (plugins/*.mjs)',
    zh: '还没有切格插件（plugins/*.mjs）',
    ja: 'コマ分割プラグインはまだありません（plugins/*.mjs）',
  },
  CLI_PLUGIN_ROW: {
    en: '{file}\t{name}',
    zh: '{file}\t{name}',
    ja: '{file}\t{name}',
  },
  CLI_PLUGIN_ROW_ERROR: {
    en: '{file}\t{name}\terror: {error}',
    zh: '{file}\t{name}\t错误：{error}',
    ja: '{file}\t{name}\tエラー：{error}',
  },
  CLI_PLUGIN_FAILED: {
    en: 'Plugin {plugin} failed: {detail}',
    zh: '插件 {plugin} 失败：{detail}',
    ja: 'プラグイン {plugin} が失敗しました：{detail}',
  },
  CLI_TEMPLATE_APPLIED: {
    en: 'Applied template {id} to {pages} page(s)',
    zh: '已套用模板 {id} 到 {pages} 页',
    ja: 'テンプレート {id} を {pages} ページに適用しました',
  },
  CLI_TEMPLATE_NONE: {
    en: 'No panel templates yet',
    zh: '还没有分格模板',
    ja: 'コマテンプレートはまだありません',
  },
  CLI_TEMPLATE_ROW: {
    en: '{id}\t{name}\t{panels} panels\t{volume}/{chapter}',
    zh: '{id}\t{name}\t{panels} 格\t{volume}/{chapter}',
    ja: '{id}\t{name}\t{panels} コマ\t{volume}/{chapter}',
  },
  CLI_ALIGN_APPLIED: {
    en: 'Applied alignment preset "{name}" to {pages} page(s)',
    zh: '已套用对齐预设 {name} 到 {pages} 页',
    ja: '整列プリセット {name} を {pages} ページに適用しました',
  },
  CLI_ALIGN_NONE: {
    en: 'No alignment presets yet',
    zh: '还没有对齐预设',
    ja: '整列プリセットはまだありません',
  },
  CLI_ALIGN_ROW: {
    en: '{id}\t{name}\t{mode}\t{scope}\t{volume}/{chapter}',
    zh: '{id}\t{name}\t{mode}\t{scope}\t{volume}/{chapter}',
    ja: '{id}\t{name}\t{mode}\t{scope}\t{volume}/{chapter}',
  },
  CLI_NO_RESULT: {
    en: 'no result',
    zh: '没有结果',
    ja: '結果なし',
  },
  CLI_TEMPLATE_ARGS_REQUIRED: {
    en: '--template, --volume and --chapter are required',
    zh: '需要 --template、--volume、--chapter',
    ja: '--template、--volume、--chapter が必要です',
  },
  CLI_TARGET_CHAPTER_MISSING: {
    en: 'Target chapter not found',
    zh: '找不到目标章节',
    ja: '対象の話が見つかりません',
  },
  CLI_MISSING_STATIC_DIR: {
    en: 'Static directory does not exist: {dir} — run `npm run build` first',
    zh: '静态目录不存在：{dir}，请先执行 npm run build',
    ja: '静的ディレクトリが存在しません：{dir}。先に `npm run build` を実行してください',
  },
} satisfies Catalogue;

export type MessageCode = keyof typeof MESSAGES;

/** Replace `{name}` placeholders; unknown or missing values become an empty string. */
export function formatMessage(template: string, params: MessageParams = {}): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = params[key];
    return value === undefined ? '' : String(value);
  });
}
