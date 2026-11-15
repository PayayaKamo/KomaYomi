# 服务端与 CLI 消息码

KomaYomi 把 `server/` 与 `scripts/` 里所有面向用户的句子都收在一份三语消息表（`server/messages/catalog.ts`）里。领域代码只抛出**稳定的错误码和参数**，文本则在边界处按请求（HTTP）或调用（CLI）协商好的语言渲染。

`ERR_*` / `WARN_*` / `STATUS_*` 属于公开 API——客户端和脚本可能拿它们做判断，所以改码名是破坏性变更，新增码不是。

- 消息表：`server/messages/catalog.ts`
- 语言协商：`server/messages/index.ts`
- 错误类型：`server/errors.ts`

## HTTP 响应约定

每个错误响应都保留旧的 `error` 字符串（当前客户端还在读它），并附加结构化字段：

```json
{
  "error": "页面不存在：点兔第14卷 / 172 第 99 页",
  "message": "页面不存在：点兔第14卷 / 172 第 99 页",
  "code": "ERR_PAGE_NOT_FOUND",
  "params": { "volume": "点兔第14卷", "chapter": "172", "page": 99 },
  "lang": "zh"
}
```

| 字段      | 含义                                       |
| --------- | ------------------------------------------ |
| `error`   | 本地化文本（为向后兼容而保留）。           |
| `message` | 与 `error` 相同，供按新约定编写的客户端。  |
| `code`    | 本文档中的稳定机器可读错误码。             |
| `params`  | 插进文本里的值；本身不翻译。               |
| `lang`    | `error` / `message` 实际使用的语言。       |

`sendJson` 还会设置 `Content-Language: <lang>` 和 `Vary: Accept-Language`。

成功响应里内嵌的警告仍然是 `string[]`（按本次请求的语言本地化），现有界面代码不用改。`POST /api/detect` 还会额外返回 `warningCodes: [{ "code": "WARN_…", "params": { … } }]`，只包含它自己产生的警告。

### 语言协商

优先级从高到低：

1. `?lang=zh` 查询参数（`en` / `zh` / `ja`，也接受 `zh-CN` 这类区域标签）。
2. `Accept-Language` 请求头，尊重 q 值（`ja;q=0.9, en;q=0.4`）。
3. 环境变量：先看 `KOMAYOMI_LANG`，再看 `MANGA_LOCALE`，最后看 `LC_ALL` / `LANG`。
4. 英语。

```bash
curl -s 'http://127.0.0.1:5173/api/page?volume=V&chapter=1&index=999' \
  -H 'Accept-Language: zh-CN,zh;q=0.9'
# → {"error":"页面不存在：V / 1 第 999 页","code":"ERR_PAGE_NOT_FOUND",…}
```

## CLI

`scripts/manga-cli.ts` 渲染同一份消息表。

```bash
node scripts/manga-cli.ts report --lang zh
KOMAYOMI_LANG=zh node scripts/manga-cli.ts layouts
LANG=ja_JP.UTF-8 node scripts/manga-cli.ts report
```

- `--lang en|zh|ja` 优先，区域标签会被归一化（`zh-CN`、`ja_JP`）。
- 不带该参数时，CLI 依次跟随 `KOMAYOMI_LANG` → `MANGA_LOCALE` → `LC_ALL`/`LANG`，最后回落到英语。
- `--content-lang ja` 选择读取哪种语言的图片文件（以前由职责过载的 `--lang` 兼任）；也接受 `--image-lang` 作为别名。
- 出错时在 stderr 打印 `Error: <本地化消息>`，退出码为 1。

## 错误码

### 请求、路由与文件

| 错误码                      | HTTP | 含义                                 | 常见原因                                 | 处理建议                                     |
| --------------------------- | ---- | ------------------------------------ | ---------------------------------------- | -------------------------------------------- |
| `ERR_INTERNAL`              | 500  | 服务器内部错误：{detail}             | 程序缺陷、数据目录不可读、未捕获的异常   | 查看 `detail` 参数和服务端日志。             |
| `ERR_INVALID_JSON`          | 400  | 请求内容不是有效的 JSON：{detail}    | 手工改过文件、`Content-Type` 不对        | 发送 JSON 请求体；上传前先校验。             |
| `ERR_BODY_TOO_LARGE`        | 413  | 请求体过大（上限 {limit} MB）        | 导入了非常大的 `.mnproj`                 | 改用流式写入磁盘的文件接口导入。             |
| `ERR_UNTRUSTED_HOST`        | 403  | 请求的主机不是本机回环地址：{host}   | DNS 重绑定、未显式放开就对外暴露         | 用 `127.0.0.1`/`localhost` 访问；确需局域网访问时再显式开启。 |
| `ERR_UNTRUSTED_ORIGIN`      | 403  | 已拦截跨站写入请求：{origin}         | 其他网站向本地 API 发请求                | 只允许应用自身来源写入，不要把它嵌进第三方页面。 |
| `ERR_UNSUPPORTED_CONTENT_TYPE` | 415 | 不支持的内容类型：{type}          | 发送了 `text/plain` 或表单提交           | 使用 `Content-Type: application/json`。      |
| `ERR_UNKNOWN_ENDPOINT`      | 404  | 未知接口：{path}                     | 旧客户端、拼写错误、base URL 不对        | 对照本仓库的 `server/app.ts` 检查路径。      |
| `ERR_FILE_NOT_FOUND`        | 404  | 文件不存在：{path}                   | 文件被移动或清理                         | 重新导出。                                   |
| `ERR_EXPORT_FILE_NOT_FOUND` | 404  | 导出文件不存在：{path}               | 导出目录被清空                           | 重新导出这一话。                             |

### 图片与缩略图

| 错误码                        | HTTP | 含义                                             | 常见原因                     | 处理建议                                 |
| ----------------------------- | ---- | ------------------------------------------------ | ---------------------------- | ---------------------------------------- |
| `ERR_IMAGE_NOT_FOUND`         | 404  | 图片不存在：{path}                               | `raw/` 结构不对、文件被改名  | 检查 `raw/<卷>/<语言>/<话>/`。           |
| `ERR_THUMB_SOURCE_MISSING`    | 404  | 缩略图源不存在：{src}                            | 图库加载后页面图片被删       | 刷新图库。                               |
| `ERR_THUMB_FETCH_FAILED`      | 502  | 缩略图获取失败：{detail}                         | 远端来源离线、URL 有误       | 到「设置 → 存储」核对远端来源。          |
| `ERR_THUMB_UNSUPPORTED`       | 415  | 缩略图暂不支持该格式                             | AVIF/HEIC 或冷门格式         | 转成 JPEG/PNG/WEBP。                     |
| `ERR_UNSUPPORTED_IMAGE_FORMAT`| 415  | 暂不支持该图片格式（{format} / {ext}）           | 不是图片文件，或编码不受支持 | 换成受支持的图片。                       |
| `ERR_REMOTE_UNAVAILABLE`      | 503  | 远端素材暂不可用（{detail}），已缓存的页仍可阅读 | 网络共享离线、WebDAV 挂了    | 缓存页还能看；恢复在线后重试。           |

### 图库、页面与卷

| 错误码                        | HTTP | 含义                                                       | 常见原因                           | 处理建议                                              |
| ----------------------------- | ---- | ---------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------- |
| `ERR_VOLUME_NOT_FOUND`        | 404  | 找不到卷：{volume}                                         | 文件夹改名、URL 过期               | 刷新图库，核对卷 id。                                 |
| `ERR_CHAPTER_NOT_FOUND`       | 404  | 找不到章节：{volume} / {chapter}                           | 话号写错、卷是空的                 | 查看 `/api/library` 里的 `chapters`。                 |
| `ERR_PAGE_NOT_FOUND`          | 404  | 页面不存在：{volume} / {chapter} 第 {page} 页              | 序号从 0 起；页面列表过期          | 改用图库返回的 `page.index`。                         |
| `ERR_PAGE_CORRUPT`            | 422  | 页面保存数据已损坏                                         | 写入中断、手改 JSON                | 页面变为只读；请从备份恢复或删除该文件。下次写入前会保留 `.corrupt.bak` 副本。 |
| `ERR_HISTORY_CORRUPT`         | 422  | 版本历史已损坏                                             | 写入中断、手改 JSON                | 从备份恢复历史；页面本身仍可打开。下次保存前会保留 `.corrupt.bak` 副本。 |
| `ERR_LIBRARY_CONFIG_CORRUPT`  | 500  | `library.json` 无法解析                                    | 写入中断、手改 JSON                | 先从备份恢复该文件再改设置；不会被自动重置。           |
| `ERR_MISSING_VOLUME_CHAPTER`  | 400  | 缺少卷/话信息                                              | 客户端漏传字段                     | `volume` 和 `chapter` 都要传。                        |
| `ERR_MISSING_VOLUME`          | 400  | 缺少卷名                                                   | 破坏性操作没有指定目标             | 传 `volume`。                                         |
| `ERR_MISSING_VOLUME_DIRS`     | 400  | 缺少卷名或语言目录配置                                     | 建卷时没给目录                     | 传 `{ volume, dirs }`。                               |
| `ERR_UNKNOWN_DIRECTION`       | 400  | 不支持的阅读方向                                           | 传了已删除或拼错的取值             | 使用界面上仍提供的 7 个阅读方向之一。                 |
| `ERR_PREPROCESS_NO_BACKUP`    | 404  | 没有可回滚的上一次预处理结果                               | 还没跑过预处理，或已经回滚过       | 先运行一次预处理，再回滚。                            |
| `ERR_URL_NOT_HTTP`            | 400  | 只支持 http(s) 链接                                        | 用了 `file://` 或相对地址          | 换成 `http(s)` 链接。                                 |
| `ERR_PAGE_NO_IMAGES`          | 400  | 该页没有任何语言的图片                                     | 话目录为空、命名对不上             | 检查这一页序号对应的文件。                            |
| `ERR_PAGE_NO_PANELS`          | 400  | 这一页还没有分格可抓取                                     | 在没切格的页上抓取版式             | 先给这一页切格，再重试。                              |
| `ERR_PAGE_SHAPE`              | 400  | 页面 JSON 应为对象                                         | 选错了导入文件                     | 导入 KomaYomi 生成的 `.mnpage.json`。                 |
| `ERR_PAGE_TARGET_MISSING`     | 400  | 页面 JSON 缺少卷 / 话，或未指定导入目标                    | 没选目标就往视图里导入             | 先选好卷 / 话再导入。                                 |
| `ERR_PAGE_INDEX_INVALID`      | 400  | 页面 JSON 缺少有效的 pageIndex                             | 手工改过文件                       | 补上从 0 起的 `pageIndex`。                           |
| `ERR_PAGE_NOT_SAVED`          | 400  | 这一页还没有保存的批注数据，请先按保存再导出               | 没保存就导出                       | 先保存页面。                                          |
| `ERR_UNSAFE_SEGMENT`          | 400  | 卷名或话号包含不安全字符                                   | `/`、`..`、控制字符                | 用普通的、能作文件夹名的名字。                        |
| `ERR_DIR_UNSAFE`              | 400  | 目录不能包含 ..                                            | 规则输入有问题                     | 用不含 `..` 的相对路径。                              |
| `ERR_DIR_NAME_EMPTY`          | 400  | 目录名不能为空                                             | 表单空着就提交                     | 填一个名字。                                          |
| `ERR_DIR_NAME_INVALID`        | 400  | 目录名「{name}」包含非法字符（不能有 \ / : * ? " < > \|）  | 粘贴了 Windows 路径                | 去掉非法字符。                                        |
| `ERR_DIR_NOT_FOUND`           | 400  | 目录不存在：{path}                                         | 选完后文件夹被移动                 | 重新选目录。                                          |
| `ERR_DIR_NOT_IN_VOLUME`       | 400  | 「{dir}」不是 {volume} 下的子目录                          | 目录列表过期                       | 刷新卷设置。                                          |
| `ERR_VOLUME_EXISTS`           | 409  | raw 下已存在同名目录「{name}」，请换个名字或先移除         | 同一个来源加了两次                 | 删掉旧条目或换个名字。                                |
| `ERR_LINK_CREATE_FAILED`      | 500  | 创建目录链接失败：{detail}                                 | 没有权限、文件系统不支持链接       | 换支持链接的文件系统，或直接复制文件。                |
| `ERR_REAL_DIRECTORY`          | 409  | 这是一个真实目录，为避免误删图片，请手动在 raw 下删除     | 卷目录不是链接                     | 确实要删就在 `raw/` 下手动删除。                      |
| `ERR_HISTORY_VERSION_NOT_FOUND`| 404 | 该页面版本已不存在（可能已按保留条数淘汰）                 | 历史版本被清理、链接过期           | 刷新页面历史；需要留存就重新保存一版。                |

### 模板与预设

| 错误码                              | HTTP | 含义                         | 常见原因                     | 处理建议                                  |
| ----------------------------------- | ---- | ---------------------------- | ---------------------------- | ----------------------------------------- |
| `ERR_PANEL_TEMPLATE_EMPTY`          | 400  | 模板没有格子                 | 从空页面抓的                 | 先检测分格再存模板。                      |
| `ERR_LAYOUT_NOT_FOUND`              | 404  | 版式模板不存在：{layoutId}   | 模板被改名或删除             | 重新拉 `/api/layouts`。                   |
| `ERR_LAYOUT_SAVE_INVALID`           | 400  | 版式模板缺少 grid.rows，无法保存 | 手工改过版式 JSON        | 保留 `grid.rows` / `grid.cols`。          |
| `ERR_ALIGN_PRESET_MISSING_FIELDS`   | 400  | 预设缺少名称/卷/话           | 表单只提交了一部分           | 传 `name`、`volume`、`chapter`。          |
| `ERR_ALIGN_PRESET_NOT_FOUND`        | 404  | 找不到对齐预设：{presetId}   | 预设被删                     | 重新拉 `/api/align-presets`。             |
| `ERR_EXPORT_TEMPLATE_NOT_FOUND`     | 404  | 导出模板不存在：{templateId} | 模板被删或 id 不对           | 重新拉 `/api/export-templates`。          |

### 导入 / 导出文件

| 错误码                              | HTTP | 含义                                                     | 常见原因                   | 处理建议                                                   |
| ----------------------------------- | ---- | -------------------------------------------------------- | -------------------------- | ---------------------------------------------------------- |
| `ERR_EXCHANGE_EMPTY_FILE`           | 400  | 没有收到{label}文件内容                                  | 文件输入为空               | 选一个非空文件。                                           |
| `ERR_EXCHANGE_INVALID_JSON`         | 400  | {label}不是有效的 JSON，可能选错了文件                   | 选错文件                   | 换成 `.mntpl` / `.mnexp` / `.mnpage.json`。                 |
| `ERR_EXCHANGE_VALIDATION`           | 400  | {label}格式不正确：{errors}                              | 结构过旧或手工改过         | 按列出的字段路径修正，或重新导出。                         |
| `ERR_EXCHANGE_VOLUME_REQUIRED`      | 400  | 请先选择要绑定的卷                                       | 没选卷就套模板             | 先选卷。                                                   |
| `ERR_EXCHANGE_CHAPTER_REQUIRED`     | 400  | 绑定到话 / 页时必须提供有效的话号                        | `scope=chapter/page` 却没给 chapter | 传 `chapter`。                                    |
| `ERR_EXCHANGE_PAGE_INDEX_REQUIRED`  | 400  | 绑定到单页时必须提供 0 起的页序                          | `scope=page` 却没给 `pageIndex` | 传 `pageIndex`。                                      |
| `ERR_EXPORT_TEMPLATE_SHAPE`         | 400  | 导出模板应为 JSON 对象（或 data/templates/export.json 的数组） | JSON 结构不对         | 用对象（或 `data/templates/export.json` 里的数组）。       |
| `ERR_EXPORT_EMPTY`                  | 400  | 没有可导出的页面（请先给页面分格或写批注）               | 范围内既无分格也无笔记     | 补分格/笔记，或放宽页范围。                                |
| `ERR_PROJECT_EMPTY`                 | 400  | 没有收到工程文件内容                                     | `.mnproj` 是空的           | 重新导出工程。                                             |
| `ERR_PROJECT_IMAGE_ENTRY`           | 400  | 工程文件里的图片条目缺少卷 / 话 / 文件名                 | manifest 损坏              | 重新导出工程。                                             |
| `ERR_MANIFEST_INVALID_JSON`         | 400  | manifest.json 不是有效的 JSON，可能不是 .mnproj 工程文件  | 不是 `.mnproj`，或已损坏   | 检查压缩包内容。                                           |
| `ERR_MANIFEST_NOT_OBJECT`           | 400  | manifest.json 结构不正确（应为 JSON 对象）               | manifest 损坏              | 重新导出工程。                                             |
| `ERR_MANIFEST_NO_INVENTORY`         | 400  | 工程文件缺少 inventory（卷话清单）                       | 导出太旧或损坏             | 用当前版本重新导出。                                       |
| `ERR_MANIFEST_INCOMPLETE`           | 400  | 工程 manifest 数据不完整：{errors}                       | 缺必填字段                 | 按列出的路径修正，或重新导出。                             |
| `ERR_MANIFEST_MISSING`              | 400  | 压缩包里没有 manifest.json，可能不是 .mnproj 工程文件    | 不是 `.mnproj`             | 选对压缩包。                                               |
| `ERR_LIBRARY_NOT_OBJECT`            | 400  | library.json 不是 JSON 对象                              | 手工改过配置               | 恢复有效配置，或从空库开始。                               |
| `ERR_SCHEMA_TOO_NEW`                | 409  | 该文件来自更高版本（schema v{found}，当前支持 v{supported}），升级前保持只读 | 用过更新版本的 KomaYomi | 升级应用后再写；也可以先只读打开。                    |
| `ERR_SCHEMA_MIGRATION`              | 500  | 无法把 {file} 从 schema v{from} 迁移：{detail}           | 文件损坏、旧版本无法识别   | 从备份恢复；把 `detail` 和文件一起反馈。                   |
| `ERR_BACKUP_NOT_KOMAYOMI`           | 400  | 压缩包里没有 data/ 目录，可能不是本工具的备份            | 不是 KomaYomi 的备份       | 选本应用生成的备份。                                       |

### 存储与远端备份

| 错误码                         | HTTP | 含义                         | 常见原因                 | 处理建议                                    |
| ------------------------------ | ---- | ---------------------------- | ------------------------ | ------------------------------------------- |
| `ERR_UNSAFE_PATH`              | 400  | 非法路径：{path}             | 构造的请求、配置有误     | 只用干净的相对路径。                        |
| `ERR_PATH_ESCAPE`              | 400  | 路径越界：{path}             | 符号链接逃逸、构造请求   | 让路径留在配置的目标目录里。                |
| `ERR_STORAGE_READONLY`         | 403  | 该存储为只读：{name}         | 往只读备份目标写入       | 换可写目标，或去掉只读标记。                |
| `ERR_NOT_A_DIRECTORY`          | 400  | 不是目录：{path}             | 本该是文件夹的位置放了文件 | 把文件移走。                              |
| `ERR_STORAGE_CONFIG_MISSING`   | 400  | 缺少存储配置                 | 设置表单是空的           | 传存储配置对象。                            |
| `ERR_REMOTE_SOURCE_MISSING`    | 400  | 尚未配置远端素材目录         | 没配置就请求同步         | 到「设置 → 存储」配置来源。                 |
| `ERR_STORAGE_TARGET_NOT_FOUND` | 404  | 存储目标不存在：{targetId}   | 目标被删、标签页过期     | 重新加载存储设置。                          |
| `ERR_STORAGE_LIST_FAILED`      | 503  | 无法列出目录：{detail}       | 共享离线、权限不足       | 检查连通性和凭据。                          |
| `ERR_SECRETS_DECRYPT_FAILED`   | 500  | 无法解密已保存的凭据         | `.secret.key` 被替换或丢失、凭据文件被改 | 恢复匹配的 `.secret.key` 后重新输入密码；文件不会被改动。 |
| `ERR_BACKUP_UPLOAD_FAILED`     | 503  | 备份上传失败：{detail}       | WebDAV 出错、磁盘满      | 查看 `detail` 参数和目标设置。              |
| `ERR_AUTO_BACKUP_FAILED`       | 500  | 定时备份失败：{detail}       | 触发时目标不可写、磁盘满 | 查看 `detail`；备份目标列表会保留失败信息。 |

### 插件

| 错误码                 | HTTP | 含义                     | 常见原因                   | 处理建议                                         |
| ---------------------- | ---- | ------------------------ | -------------------------- | ------------------------------------------------ |
| `ERR_PLUGIN_NO_EXPORT` | 200* | 没有导出 panels 函数     | 插件文件写坏了             | 从 `plugins/*.mjs` 导出 `panels`。               |
| `ERR_PLUGIN_LOAD`      | 200* | 插件模块加载失败         | 语法错误、缺少依赖、加载时就抛错 | 修正模块；警告里会带原始错误信息。         |
| `ERR_PLUGIN_RUN_FAILED` | 200* | 插件执行时抛出异常      | 没处理输入、运行时 bug     | 在插件内捕获异常；检测会回退到自动检测。    |
| `ERR_PLUGIN_BAD_RESULT` | 200* | 插件返回的不是数组，也不是 `{ panels }` | 返回值写错或形状不对 | 返回矩形数组或 `{ panels: [...] }`。 |
| `ERR_PLUGIN_TIMEOUT`   | 504* | 插件执行超时（{ms}ms）   | 大页面上算法太慢           | 优化插件；服务端会回退到自动检测。               |
| `ERR_PLUGIN_NO_PANELS` | 200* | 插件没有返回任何格子     | 阈值太严                   | 至少返回一个分格，或回退自动检测。               |
| `ERR_PLUGIN_NONE`      | 200* | 没有匹配的插件           | 没有插件，或 `match` 不匹配 | 添加插件，或在 CLI 里加 `--auto`。              |

\* 插件失败通常以 `warnings`（及 `warningCodes`）返回，同时检测回退到自动检测，所以 HTTP 调用仍然成功。

### 压缩包（`.mnproj`、备份）

| 错误码                       | HTTP | 含义                                 | 常见原因             | 处理建议                          |
| ---------------------------- | ---- | ------------------------------------ | -------------------- | --------------------------------- |
| `ERR_ZIP_TOO_SMALL`          | 400  | 不是有效的压缩包（文件太小）         | 上传被截断           | 重新上传压缩包。                  |
| `ERR_ZIP_NO_EOCD`            | 400  | 不是有效的压缩包（找不到目录区）     | 不是压缩包，或被截断 | 用完整的 `.mnproj` / 备份。       |
| `ERR_ZIP_CORRUPT_DIR`        | 400  | 压缩包目录损坏                       | 压缩包损坏           | 重新打包。                        |
| `ERR_ZIP_ENTRY_CORRUPT`      | 400  | 压缩包条目损坏：{name}               | 压缩包损坏           | 重新打包。                        |
| `ERR_ZIP_UNSUPPORTED_METHOD` | 400  | 不支持的压缩方式 {method}（{name}）  | 7-Zip 或旧式压缩     | 用 deflate 重新压缩。             |
| `ERR_ZIP_ENTRY_SIZE`         | 400  | 压缩包条目大小不符：{name}           | 压缩包损坏           | 重新打包。                        |

### 目录规则

| 错误码                          | HTTP | 含义                                                        | 常见原因                    | 处理建议                                    |
| ------------------------------- | ---- | ----------------------------------------------------------- | --------------------------- | ------------------------------------------- |
| `ERR_RULE_EMPTY`                | 400  | 规则不能为空                                                | 有空行                      | 填上 pattern，或删掉这一行。                |
| `ERR_RULE_UNKNOWN_PLACEHOLDER`  | 400  | 未知的占位符 {name}                                         | 把 `{volume}` 拼成了 `{vol}` | 只用 `{volume}`、`{language}`、`{chapter}`、`{page}`。 |
| `ERR_RULES_NOT_ARRAY`           | 400  | 规则必须是非空数组                                          | 把所有规则都清空了          | 至少保留一条规则。                          |
| `ERR_RULE_NOT_OBJECT`           | 400  | 第 {index} 条规则不是对象                                   | 手工改过 JSON               | 传对象数组。                                |
| `ERR_RULE_PATTERN_MISSING`      | 400  | 第 {index} 条规则缺少 pattern                               | 规则只写了一半              | 补 `pattern`。                              |
| `ERR_RULE_PATTERN_ABSOLUTE`     | 400  | 第 {index} 条规则必须是相对路径且不能包含 ..                | 粘贴了文件系统绝对路径      | 改成相对 pattern。                          |
| `ERR_RULE_PAGE_MISSING`         | 400  | 第 {index} 条规则需要 {page} 占位符                         | 忘了页号段                  | 加上 `{page}`。                             |
| `ERR_RULE_LANGUAGE_INVALID`     | 400  | 第 {index} 条规则的 language 值「{value}」无效（不能包含路径分隔符） | language 里带了 `/` 或 `\` | 写语言代码（如 `ja`），不要写路径。     |
| `ERR_RULE_LANGUAGE_MISSING`     | 400  | 第 {index} 条规则需要 {language} 占位符或 language 默认值    | 既没 `{language}` 也没默认值 | 补 `{language}` 或 `language`。            |
| `ERR_RULE_DUPLICATE_ID`         | 409  | 规则 id 重复：「{id}」                                      | 复制粘贴了同一条规则        | 给每条规则一个唯一 id。                     |
| `ERR_RULE_PARSE`                | 400  | 规则「{rule}」无法解析：{detail}                            | `config/dir-rules.json` 损坏 | 修正规则；否则图库会回退到默认规则。       |

## 警告码

警告随成功响应一起返回；由服务端自己产生的警告，响应里还会带 `warningCodes`。

| 错误码                            | 含义                                                                 | 常见原因                     |
| --------------------------------- | -------------------------------------------------------------------- | ---------------------------- |
| `WARN_DETECT_FROM_LAYOUT`         | 按版式模板「{name}」切格                                             | 该卷 / 话 / 页绑定了版式     |
| `WARN_DETECT_FROM_PLUGIN`         | 插件 {plugin} 切格                                                   | 有插件匹配这一页             |
| `WARN_PLUGIN_FAILED_FALLBACK`     | 插件 {plugin} 失败（{detail}），已回退自动检测                       | 插件报错或超时               |
| `WARN_TITLE_FETCH_FAILED`         | 抓取标题失败（可能被网络限制），可以手动填写                         | 网络受限、目标主机被挡       |
| `WARN_PAGE_SKIPPED_NO_PANELS`     | 第 {page} 页还没有分格数据，已跳过                                   | 检测过但没保存               |
| `WARN_EXPORT_AUTODETECTED`        | {count} 页此前没有分格数据，导出前已自动检测                         | 导出前这些页还没切格         |
| `WARN_PAGE_SKIPPED_NO_CONTENT`    | 第 {page} 页还没有分格或笔记，已跳过                                 | 这一页没有可导出的内容       |
| `WARN_PAGE_IMAGE_UNREADABLE`      | 第 {page} 页 {lang} 图片无法解析                                     | 图片损坏、编码不受支持       |
| `WARN_DIR_RULES_FALLBACK`         | 目录识别规则无效（{detail}），已回退默认规则                         | `config/dir-rules.json` 损坏 |
| `WARN_UNRECOGNIZED_DIRS`          | 未识别的目录：{dirs}（可在「卷设置」里指定语言）                     | 文件夹命名不常规             |
| `WARN_LANGUAGE_PAGE_COUNT`        | 各语言页数不一致：{counts}（按序号配对，缺页会在页面上标注）         | 某种语言缺页                 |
| `WARN_MIXED_EXTENSIONS`           | {lang} 本话内扩展名不统一：{exts}                                    | `.jpg` 和 `.png` 混用        |
| `WARN_MISSING_PAGE`               | {lang} 缺第 {page} 页                                                | 编号有断档                   |
| `WARN_FILENAME_MISMATCH`          | {lang} 文件名 {name} 与第 {page} 页序号不符                          | 第 9 页的文件叫 `page-010.jpg` |
| `WARN_NO_LANGUAGE_DIRS`           | 未识别到语言目录或目录结构不符合任何识别规则，请检查「目录识别」规则或在此指定语言目录 | 目录不符合任何规则 |
| `WARN_SAME_NAME_VOLUME`           | 同名目录已存在，已自动识别                                           | 重复添加同一个来源           |
| `WARN_EMPTY_VOLUME_CREATED`       | 已创建空目录，请把图片按 raw/卷名/语言/话号/01.jpg 放进去            | 新建卷还没放图               |
| `WARN_NO_LANGUAGE_DIR_DETECTED`   | 没有识别到语言目录，已按单卷添加，可在「卷设置」里指定语言目录       | 目录是平铺结构               |
| `WARN_VOLUME_ALREADY_IN_LIBRARY`  | 「{name}」已在图库中，已自动识别                                     | 重复添加                     |
| `WARN_VOLUME_DIR_REMOVED`         | 目录不存在，已从图库配置中移除                                       | 在应用外删了文件夹           |
| `WARN_IMAGE_PATH_INVALID`         | 图片路径无法解析：{path}                                             | manifest 里的 URL 写坏了     |
| `WARN_IMAGE_MISSING`              | 图片不存在，已跳过：{path}                                           | `.mnproj` 不完整             |
| `WARN_PAGE_JSON_INVALID`          | 页面 JSON 无法解析：{path}                                           | 页面文件损坏                 |
| `WARN_ENTRY_JSON_INVALID`         | JSON 无法解析，已跳过：{name}                                        | 压缩包里的配置损坏           |
| `WARN_SUSPICIOUS_PATH`            | 跳过可疑路径：{name}                                                 | 压缩包里有 `../` 条目        |
| `WARN_UNKNOWN_ENTRY`              | 忽略未知条目：{name}                                                 | 压缩包里有额外文件           |
| `WARN_SNAPSHOT_FAILED`            | 恢复前快照失败：{detail}                                             | 磁盘满、权限不足             |
| `WARN_PROJECT_COPY_FAILED`        | 保存原始工程文件失败：{detail}                                       | 磁盘满、权限不足             |
| `WARN_JSON_MERGE_FALLBACK`        | 无法合并 {name}（JSON 解析失败），已保留现有内容                     | 压缩包里的 JSON 不合法       |
| `WARN_LIBRARY_MERGE_FALLBACK`     | config/library.json 无法合并，已保留现有设置                         | 压缩包里的 JSON 不合法       |
| `WARN_RELINK_DIR_MISSING`         | 补链目录不存在或不是文件夹：{dir}                                    | 来源文件夹被移动             |
| `WARN_UNSAFE_IMAGE_PATH`          | 图片路径不安全，已跳过：{volume}/{chapter}/{name}                    | 构造出来的压缩包             |
| `WARN_IMAGE_OVERWRITE_SKIPPED`    | raw 里已存在同名但内容不同的图片，未覆盖：{volume}/{chapter}/{name}  | 资源冲突                     |
| `WARN_RULE_LEVEL_MISMATCH`        | 与规则「{rule}」的层级不匹配                                         | 多一层或少一层目录           |
| `WARN_RULE_NO_LANGUAGE`           | 规则没有 {language} 段，也没有 language 默认值                       | 规则不完整                   |
| `WARN_UNKNOWN_LANGUAGE_DIR`       | 语言目录「{dir}」无法识别（可在卷设置里手动指定）                    | `jp`、`cn` 或自定义名字      |
| `WARN_NO_RULE_MATCHED`            | 没有任何规则匹配                                                     | 目录结构不受支持             |

## 其余消息码

这些码同样本地化，但属于数据而非诊断信息：

- `STATUS_STORAGE_*` —— `GET /api/storage` 与 `POST /api/storage/test` 返回的存储探测结果（`online`、`message`）：

  | 错误码                           | 含义                                 |
  | -------------------------------- | ------------------------------------ |
  | `STATUS_STORAGE_LOCAL_OK`        | 本地目录可访问                       |
  | `STATUS_STORAGE_NETWORK_OK`      | 网络共享可访问                       |
  | `STATUS_STORAGE_WEBDAV_OK`       | WebDAV 可访问                        |
  | `STATUS_STORAGE_DIR_NOT_CREATED` | 目标目录尚未创建，首次写入时自动建立 |
  | `STATUS_STORAGE_ACCESS_FAILED`   | 无法访问：{detail}                   |
  | `STATUS_STORAGE_TIMEOUT`         | 连接超时                             |
  | `STATUS_STORAGE_UNREACHABLE`     | 无法连接                             |

- `HISTORY_*` —— 页面文档里保存的 `lastEditSummary` 值（按保存该页那次请求的语言写入）：`HISTORY_CREATED`、`HISTORY_PANELS`、`HISTORY_PANEL_RECTS`、`HISTORY_NOTES`、`HISTORY_NOTE_EDIT`、`HISTORY_DIRECTION`、`HISTORY_GROUPS`、`HISTORY_ANNOTATIONS`、`HISTORY_ALIGN_MODE`、`HISTORY_OFFSETS`、`HISTORY_SAVE`、`HISTORY_DETECTED`。

- `EXPORT_*` —— 导出 HTML 里的文案：`EXPORT_DIRECTION_RTL`、`EXPORT_DIRECTION_LTR`、`EXPORT_DIRECTION_TTB`、`EXPORT_PAGE_NOTES`、`EXPORT_PANEL_NO`、`EXPORT_EMPTY_PANELS`、`EXPORT_EMPTY_IMAGE`、`EXPORT_EMPTY_NOTES`、`EXPORT_PAGE_ALT`、`EXPORT_CHAPTER_LINE`、`EXPORT_AT`、`EXPORT_FOOTER`。

- `LANG_NAME_JA`、`LANG_NAME_ZH`、`LANG_NAME_EN`、`LABEL_*`、`DEFAULT_NAME_*` —— 显示名与默认标题。

- `CLI_*` —— 仅 CLI 使用的行：`CLI_USAGE`、`CLI_ERROR`、`CLI_REPORT_SUMMARY`、`CLI_REPORT_HISTOGRAM`、`CLI_REPORT_HISTOGRAM_ITEM`、`CLI_REPORT_NARROW`、`CLI_REGRESS_BASELINE`、`CLI_REGRESS_RESULT`、`CLI_DETECT_SKIPPED`、`CLI_DETECT_SKIPPED_EXISTING`、`CLI_DETECT_PAGE`、`CLI_DETECT_WRITTEN`、`CLI_DETECT_PREVIEW`、`CLI_DETECT_WARNING_SUFFIX`、`CLI_DETECT_DONE`、`CLI_LAYOUT_APPLIED`、`CLI_LAYOUT_NONE`、`CLI_LAYOUT_ROW`、`CLI_PLUGIN_NONE`、`CLI_PLUGIN_ROW`、`CLI_PLUGIN_ROW_ERROR`、`CLI_PLUGIN_FAILED`、`CLI_TEMPLATE_APPLIED`、`CLI_TEMPLATE_NONE`、`CLI_TEMPLATE_ROW`、`CLI_ALIGN_APPLIED`、`CLI_ALIGN_NONE`、`CLI_ALIGN_ROW`、`CLI_NO_RESULT`。

- 仅 CLI 使用的错误码：`CLI_TEMPLATE_ARGS_REQUIRED`（缺少 `--template/--volume/--chapter`）、`CLI_TARGET_CHAPTER_MISSING`、`CLI_MISSING_STATIC_DIR`。

## 新增或修改消息

1. 在 `server/messages/catalog.ts` 的 `MESSAGES` 里加码，**三种语言都要写**（`en` 是回退值，必须存在）。
2. 面向用户的文本用 `t('CODE', { param })`，失败用 `throw new AppError('CODE', { param }, status)`。不要把翻译好的片段拼起来——值一律走参数。
3. 在上面对应的表里加一行（`WARN_*` 加到警告表）。
4. 跑 `npm run typecheck`、`npm run lint` 和 `npm run format:check`——消息表的键类型由 `MESSAGES` 推导，拼错会直接编译报错。
