import { defineConfig } from 'vitepress'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const docsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Production origin and path prefix for GitHub Pages.
 * `DOCS_BASE=/` is set by `scripts/dev.mjs` so local development works at the
 * server root, while builds default to the repository subpath.
 */
const BASE = process.env.DOCS_BASE === '/' ? '/' : '/KomaYomi-docs/'
const SITE_URL = 'https://payayakamo.github.io/KomaYomi-docs'
const SITE_NAME = 'KomaYomi'
const SITE_SUBTITLE = 'Manga Learner'
const AUTHOR = 'PayayaKamo'
const SOCIAL_IMAGE = `${SITE_URL}/social-card.png`
const MAIL_ADDRESS = 'PayayaKamo@gmail.com'

/**
 * Social icons in the top navigation. The mail icon is inlined so the site
 * does not depend on an external icon CDN, and its tooltip follows the locale.
 */
function socialLinks(mailLabel: string) {
  return [
    { icon: 'github', link: 'https://github.com/payayakamo', ariaLabel: 'GitHub: PayayaKamo' },
    {
      icon: {
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg>',
      },
      link: `mailto:${MAIL_ADDRESS}`,
      ariaLabel: mailLabel,
    },
  ]
}

/**
 * Build stamp rendered in the footer, so a reader can tell which build a page
 * came from. CI provides the commit in `GITHUB_SHA`; local builds show `local`.
 * The timestamp is formatted in the build machine's timezone, never relative.
 */
const BUILD_SHA = (process.env.GITHUB_SHA || '').trim()
const BUILD_SHA_SHORT = BUILD_SHA ? BUILD_SHA.slice(0, 7) : 'local'
const buildDate = new Date()
const pad = (value: number) => String(value).padStart(2, '0')
const BUILD_TIME = `${buildDate.getFullYear()}-${pad(buildDate.getMonth() + 1)}-${pad(
  buildDate.getDate(),
)} ${pad(buildDate.getHours())}:${pad(buildDate.getMinutes())}`

type LocaleCode = 'en' | 'zh' | 'ja'

const localeMeta: Record<
  LocaleCode,
  {
    lang: string
    ogLocale: string
    homePath: string
    homeLabel: string
    guideLabel: string
    tagline: string
    defaultDescription: string
    keywords: string
    docFooter: { prev: string; next: string }
    outlineLabel: string
    lastUpdatedText: string
    returnToTopLabel: string
    sidebarMenuLabel: string
    darkModeSwitchLabel: string
    langMenuLabel: string
  }
> = {
  en: {
    lang: 'en-US',
    ogLocale: 'en_US',
    homePath: '/',
    homeLabel: 'Home',
    guideLabel: 'Guide',
    tagline: 'A local-first manga panel reader for language study.',
    defaultDescription:
      'KomaYomi (Koma = manga panel, Yomi = reading) documentation — a local-first manga panel reader for language study: compare Japanese, Chinese and English editions, detect panels, align artwork and take notes.',
    keywords:
      'KomaYomi, Koma Yomi, 格读, manga panel reader, manga reader, language learning, multilingual manga, Japanese, Chinese, English, panel detection, annotation, notes, compare manga translations, local-first',
    docFooter: { prev: 'Previous', next: 'Next' },
    outlineLabel: 'On this page',
    lastUpdatedText: 'Last updated',
    returnToTopLabel: 'Back to top',
    sidebarMenuLabel: 'Menu',
    darkModeSwitchLabel: 'Theme',
    langMenuLabel: 'Languages',
  },
  zh: {
    lang: 'zh-CN',
    ogLocale: 'zh_CN',
    homePath: '/zh/',
    homeLabel: '首页',
    guideLabel: '使用指南',
    tagline: '本地优先的漫画分格精读工具。',
    defaultDescription:
      'KomaYomi（Koma＝漫画分格，Yomi＝读，中文也称“格读”）文档：本地优先的漫画分格精读工具，支持日/中/英对照阅读、分格检测、对齐、批注与导出。',
    keywords:
      'KomaYomi, Koma Yomi, 格读, 漫画分格, 漫画阅读器, 语言学习, 多语言漫画, 日语, 中文, 英语, 日语学习, 分格检测, 批注, 笔记, 对照阅读',
    docFooter: { prev: '上一篇', next: '下一篇' },
    outlineLabel: '本页目录',
    lastUpdatedText: '最后更新',
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '目录',
    darkModeSwitchLabel: '主题',
    langMenuLabel: '选择语言',
  },
  ja: {
    lang: 'ja-JP',
    ogLocale: 'ja_JP',
    homePath: '/ja/',
    homeLabel: 'ホーム',
    guideLabel: 'ガイド',
    tagline: 'ローカル優先のコマ読みツール。言語学習のための漫画精読アプリ。',
    defaultDescription:
      'KomaYomi（Koma＝コマ、Yomi＝読み）ドキュメント：ローカル優先のコマ読みツール。日中英の比較リーディング、コマ検出、位置合わせ、注釈、エクスポートに対応。',
    keywords:
      'KomaYomi, Koma Yomi, コマ読み, 漫画, 漫画リーダー, 言語学習, 多言語漫画, 日本語, 中国語, 英語, コマ検出, 注釈, ノート, 比較リーディング',
    docFooter: { prev: '前へ', next: '次へ' },
    outlineLabel: 'このページ',
    lastUpdatedText: '最終更新',
    returnToTopLabel: 'トップへ戻る',
    sidebarMenuLabel: 'メニュー',
    darkModeSwitchLabel: 'テーマ',
    langMenuLabel: '言語',
  },
}

function localeOf(relativePath: string): LocaleCode {
  if (relativePath.startsWith('zh/')) return 'zh'
  if (relativePath.startsWith('ja/')) return 'ja'
  return 'en'
}

/** Locale-independent route, e.g. `/guide/panels`, or `/` for a home page. */
function routeOf(relativePath: string): string {
  const stripped = relativePath.replace(/^(zh|ja)\//, '')
  const withoutExt = stripped.replace(/\.md$/, '')
  const withoutIndex = withoutExt.replace(/(^|\/)index$/, '$1')
  const withSlash = `/${withoutIndex}`.replace(/\/+/g, '/').replace(/\/$/, '')
  return withSlash || '/'
}

function isHome(relativePath: string): boolean {
  return routeOf(relativePath) === '/'
}

function pageUrl(relativePath: string): string {
  const locale = localeOf(relativePath)
  const route = routeOf(relativePath)
  const meta = localeMeta[locale]
  if (route === '/') return `${SITE_URL}${meta.homePath}`
  return `${SITE_URL}${locale === 'en' ? '' : `/${locale}`}${route}`
}

function alternateUrls(relativePath: string): Record<LocaleCode, string> {
  const route = routeOf(relativePath)
  const make = (locale: LocaleCode) => {
    const meta = localeMeta[locale]
    if (route === '/') return `${SITE_URL}${meta.homePath}`
    return `${SITE_URL}${locale === 'en' ? '' : `/${locale}`}${route}`
  }
  return { en: make('en'), zh: make('zh'), ja: make('ja') }
}

const sourceCache = new Map<string, string>()

function sourceOf(relativePath: string): string {
  const cached = sourceCache.get(relativePath)
  if (cached !== undefined) return cached
  let text = ''
  try {
    text = fs.readFileSync(path.join(docsRoot, relativePath), 'utf8')
  } catch {
    text = ''
  }
  sourceCache.set(relativePath, text)
  return text
}

function stripFrontmatter(text: string): string {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
}

/** Remove inline Markdown so the value is safe inside a meta description. */
function plain(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<Badge[^>]*\/>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[*_`~]/g, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function headingOf(relativePath: string): string {
  const match = stripFrontmatter(sourceOf(relativePath)).match(/^#\s+(.+)$/m)
  return match ? plain(match[1]) : ''
}

function firstParagraphOf(relativePath: string): string {
  const lines = stripFrontmatter(sourceOf(relativePath)).split(/\r?\n/)
  let inFence = false
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const text = line.trim()
    if (!text) continue
    if (
      text.startsWith('#') ||
      text.startsWith('<') ||
      text.startsWith(':::') ||
      text.startsWith('|') ||
      text.startsWith('>') ||
      /^[-*+]\s/.test(text) ||
      /^\d+\.\s/.test(text) ||
      text.startsWith('---')
    ) {
      continue
    }
    return plain(text)
  }
  return ''
}

function clamp(text: string, max = 155): string {
  const chars = Array.from(text)
  if (chars.length <= max) return text
  const cut = chars.slice(0, max - 1).join('')
  return `${cut.replace(/[\s,;:.!?，；：、。！？]+[^\s,;:.!?，；：、。！？]*$/, '')}…`
}

function sectionInfo(relativePath: string) {
  const locale = localeOf(relativePath)
  const meta = localeMeta[locale]
  const route = routeOf(relativePath)
  if (!route.startsWith('/guide/')) return null
  return {
    label: meta.guideLabel,
    url: `${SITE_URL}${meta.homePath}guide/introduction`,
  }
}

function jsonLd(relativePath: string, title: string, description: string) {
  const locale = localeOf(relativePath)
  const meta = localeMeta[locale]
  const canonical = pageUrl(relativePath)

  if (isHome(relativePath)) {
    return {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebSite',
          '@id': `${SITE_URL}/#website`,
          name: SITE_NAME,
          alternateName: SITE_SUBTITLE,
          url: canonical,
          description: meta.defaultDescription,
          inLanguage: meta.lang,
          author: { '@type': 'Person', name: AUTHOR },
          publisher: { '@type': 'Organization', name: SITE_NAME },
        },
        {
          '@type': 'SoftwareApplication',
          name: SITE_NAME,
          alternateName: SITE_SUBTITLE,
          applicationCategory: 'MultimediaApplication',
          applicationSubCategory: 'Manga-based language learning and annotation tool',
          operatingSystem: 'Windows, macOS, Linux',
          url: canonical,
          description: meta.defaultDescription,
          inLanguage: meta.lang,
          author: { '@type': 'Person', name: AUTHOR },
          creator: { '@type': 'Person', name: AUTHOR },
          publisher: { '@type': 'Organization', name: SITE_NAME },
          isAccessibleForFree: true,
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        },
      ],
    }
  }

  const items: Array<Record<string, unknown>> = [
    {
      '@type': 'ListItem',
      position: 1,
      name: meta.homeLabel,
      item: `${SITE_URL}${meta.homePath}`,
    },
  ]

  const section = sectionInfo(relativePath)
  if (section) {
    items.push({
      '@type': 'ListItem',
      position: 2,
      name: section.label,
      item: section.url,
    })
  }

  items.push({
    '@type': 'ListItem',
    position: items.length + 1,
    name: title,
    item: canonical,
  })

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'TechArticle',
        headline: title,
        description,
        url: canonical,
        mainEntityOfPage: canonical,
        inLanguage: meta.lang,
        author: { '@type': 'Person', name: AUTHOR },
        publisher: { '@type': 'Organization', name: SITE_NAME },
        isPartOf: { '@id': `${SITE_URL}/#website` },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: items,
      },
    ],
  }
}

const enSidebar = [
  {
    text: 'Guide',
    items: [
      { text: 'Introduction', link: '/guide/introduction' },
      { text: 'Install & Run', link: '/guide/installation' },
      { text: 'Library & Import', link: '/guide/gallery' },
      { text: 'Prepare & Rename', link: '/guide/preprocess' },
      { text: 'Folder Rules', link: '/guide/folder-rules' },
      { text: 'Panel Workbench', link: '/guide/panels' },
      { text: 'Compare Reader', link: '/guide/compare' },
      { text: 'Notes', link: '/guide/notes' },
      { text: 'Export', link: '/guide/export' },
      { text: 'Remote & Backup', link: '/guide/remote' },
      { text: 'Project Files & Formats', link: '/guide/project-files' },
      { text: 'Shortcuts', link: '/guide/shortcuts' },
      { text: 'On Different Devices', link: '/guide/devices' },
    ],
  },
  {
    text: 'Reference',
    items: [
      { text: 'Core Concepts', link: '/concepts' },
      { text: 'Terminology', link: '/terminology' },
      { text: 'Data Formats', link: '/data-format' },
      { text: 'Layout Templates & Plugins', link: '/extending' },
      { text: 'Remote Storage & Backup', link: '/remote-backup' },
      { text: 'Server & CLI Message Codes', link: '/server/error-codes' },
    ],
  },
  {
    text: 'Development',
    items: [
      { text: 'Overview & Architecture', link: '/development/' },
      { text: 'Data Formats', link: '/development/data-formats' },
      { text: 'Panel Plugins', link: '/development/plugins' },
      { text: 'Folder Rules', link: '/development/folder-rules' },
      { text: 'Export Templates', link: '/development/export-templates' },
      { text: 'Build & Packaging', link: '/development/build' },
      { text: 'Contributing', link: '/development/contributing' },
    ],
  },
  { text: 'Help', items: [{ text: 'FAQ & Troubleshooting', link: '/faq' }] },
]

const zhSidebar = [
  {
    text: '使用指南',
    items: [
      { text: '项目介绍', link: '/zh/guide/introduction' },
      { text: '安装与运行', link: '/zh/guide/installation' },
      { text: '图库与导入', link: '/zh/guide/gallery' },
      { text: '预处理与重命名', link: '/zh/guide/preprocess' },
      { text: '目录识别规则', link: '/zh/guide/folder-rules' },
      { text: '切格工作台', link: '/zh/guide/panels' },
      { text: '对照阅读', link: '/zh/guide/compare' },
      { text: '笔记', link: '/zh/guide/notes' },
      { text: '导出', link: '/zh/guide/export' },
      { text: '备份与远端', link: '/zh/guide/remote' },
      { text: '工程文件与格式', link: '/zh/guide/project-files' },
      { text: '快捷键总表', link: '/zh/guide/shortcuts' },
      { text: '不同设备上的样子', link: '/zh/guide/devices' },
    ],
  },
  {
    text: '参考',
    items: [
      { text: '核心概念', link: '/zh/concepts' },
      { text: '术语表', link: '/zh/terminology' },
      { text: '数据格式', link: '/zh/data-format' },
      { text: '版式模板与插件', link: '/zh/extending' },
      { text: '远端存储与备份', link: '/zh/remote-backup' },
      { text: '错误码参考', link: '/zh/server/error-codes' },
    ],
  },
  {
    text: '二次开发',
    items: [
      { text: '总览与架构', link: '/zh/development/' },
      { text: '数据格式', link: '/zh/development/data-formats' },
      { text: '分格插件', link: '/zh/development/plugins' },
      { text: '目录规则', link: '/zh/development/folder-rules' },
      { text: '导出模板', link: '/zh/development/export-templates' },
      { text: '构建与打包', link: '/zh/development/build' },
      { text: '贡献指南', link: '/zh/development/contributing' },
    ],
  },
  { text: '帮助', items: [{ text: '常见问题与故障排查', link: '/zh/faq' }] },
]

const jaSidebar = [
  {
    text: 'ガイド',
    items: [
      { text: 'はじめに', link: '/ja/guide/introduction' },
      { text: 'インストールと起動', link: '/ja/guide/installation' },
      { text: 'ライブラリと取り込み', link: '/ja/guide/gallery' },
      { text: '画像の前処理と名前変更', link: '/ja/guide/preprocess' },
      { text: 'フォルダ検出の規則', link: '/ja/guide/folder-rules' },
      { text: 'コマ分割ワークベンチ', link: '/ja/guide/panels' },
      { text: '比較リーダー', link: '/ja/guide/compare' },
      { text: 'ノート', link: '/ja/guide/notes' },
      { text: 'エクスポート', link: '/ja/guide/export' },
      { text: 'バックアップとリモート', link: '/ja/guide/remote' },
      { text: 'プロジェクトファイルと形式', link: '/ja/guide/project-files' },
      { text: 'ショートカット一覧', link: '/ja/guide/shortcuts' },
      { text: 'デバイスごとの表示', link: '/ja/guide/devices' },
    ],
  },
  {
    text: 'リファレンス',
    items: [
      { text: '基本概念', link: '/ja/concepts' },
      { text: '用語集', link: '/ja/terminology' },
      { text: 'データ形式', link: '/ja/data-format' },
      { text: 'レイアウトテンプレートとプラグイン', link: '/ja/extending' },
      { text: 'リモート保存とバックアップ', link: '/ja/remote-backup' },
      { text: 'エラーコード', link: '/ja/server/error-codes' },
    ],
  },
  {
    text: 'カスタマイズ開発',
    items: [
      { text: '概要とアーキテクチャ', link: '/ja/development/' },
      { text: 'データ形式', link: '/ja/development/data-formats' },
      { text: 'コマ分割プラグイン', link: '/ja/development/plugins' },
      { text: 'フォルダー判定ルール', link: '/ja/development/folder-rules' },
      { text: 'エクスポートテンプレート', link: '/ja/development/export-templates' },
      { text: 'ビルドとパッケージング', link: '/ja/development/build' },
      { text: 'コントリビュート', link: '/ja/development/contributing' },
    ],
  },
  { text: 'ヘルプ', items: [{ text: 'FAQ とトラブルシューティング', link: '/ja/faq' }] },
]

const enTheme = {
  selectText: 'Languages',
  siteTitle: 'KomaYomi Docs',
  nav: [
    {
      text: 'Guide',
      items: [
        { text: 'Introduction', link: '/guide/introduction' },
        { text: 'Install & Run', link: '/guide/installation' },
        { text: 'Library & Import', link: '/guide/gallery' },
        { text: 'Prepare & Rename', link: '/guide/preprocess' },
        { text: 'Folder Rules', link: '/guide/folder-rules' },
        { text: 'Panel Workbench', link: '/guide/panels' },
        { text: 'Compare Reader', link: '/guide/compare' },
        { text: 'Notes', link: '/guide/notes' },
        { text: 'Export', link: '/guide/export' },
        { text: 'Remote & Backup', link: '/guide/remote' },
        { text: 'Project Files & Formats', link: '/guide/project-files' },
        { text: 'Shortcuts', link: '/guide/shortcuts' },
        { text: 'On Different Devices', link: '/guide/devices' },
      ],
    },
    {
      text: 'Reference',
      items: [
        { text: 'Core Concepts', link: '/concepts' },
        { text: 'Terminology', link: '/terminology' },
        { text: 'Data Formats', link: '/data-format' },
        { text: 'Layout Templates & Plugins', link: '/extending' },
        { text: 'Remote Storage & Backup', link: '/remote-backup' },
        { text: 'Server & CLI Message Codes', link: '/server/error-codes' },
      ],
    },
    {
      text: 'Development',
      items: [
        { text: 'Overview & Architecture', link: '/development/' },
        { text: 'Data Formats', link: '/development/data-formats' },
        { text: 'Panel Plugins', link: '/development/plugins' },
        { text: 'Folder Rules', link: '/development/folder-rules' },
        { text: 'Export Templates', link: '/development/export-templates' },
        { text: 'Build & Packaging', link: '/development/build' },
        { text: 'Contributing', link: '/development/contributing' },
      ],
    },
    { text: 'FAQ', link: '/faq' },
  ],
  search: {
    provider: 'local',
    options: {
      detailedView: true,
      translations: {
        button: { buttonText: 'Search', buttonAriaLabel: 'Search' },
        modal: {
          displayDetails: 'Display detailed list',
          resetButtonTitle: 'Reset search',
          backButtonTitle: 'Close search',
          noResultsText: 'No results for',
          footer: {
            selectText: 'to select',
            selectKeyAriaLabel: 'enter',
            navigateText: 'to navigate',
            navigateUpKeyAriaLabel: 'up arrow',
            navigateDownKeyAriaLabel: 'down arrow',
            closeText: 'to close',
            closeKeyAriaLabel: 'escape',
          },
        },
      },
    },
  },
  sidebar: enSidebar,
  socialLinks: socialLinks('Email'),
  outline: { level: [2, 3], label: localeMeta.en.outlineLabel },
  docFooter: localeMeta.en.docFooter,
  lastUpdated: { text: localeMeta.en.lastUpdatedText },
  returnToTopLabel: localeMeta.en.returnToTopLabel,
  sidebarMenuLabel: localeMeta.en.sidebarMenuLabel,
  darkModeSwitchLabel: localeMeta.en.darkModeSwitchLabel,
  langMenuLabel: localeMeta.en.langMenuLabel,
}

const zhTheme = {
  selectText: '选择语言',
  siteTitle: 'KomaYomi 文档',
  nav: [
    {
      text: '使用指南',
      items: [
        { text: '项目介绍', link: '/zh/guide/introduction' },
        { text: '安装与运行', link: '/zh/guide/installation' },
        { text: '图库与导入', link: '/zh/guide/gallery' },
        { text: '预处理与重命名', link: '/zh/guide/preprocess' },
        { text: '目录识别规则', link: '/zh/guide/folder-rules' },
        { text: '切格工作台', link: '/zh/guide/panels' },
        { text: '对照阅读', link: '/zh/guide/compare' },
        { text: '笔记', link: '/zh/guide/notes' },
        { text: '导出', link: '/zh/guide/export' },
        { text: '备份与远端', link: '/zh/guide/remote' },
        { text: '工程文件与格式', link: '/zh/guide/project-files' },
        { text: '快捷键总表', link: '/zh/guide/shortcuts' },
        { text: '不同设备上的样子', link: '/zh/guide/devices' },
      ],
    },
    {
      text: '参考',
      items: [
        { text: '核心概念', link: '/zh/concepts' },
        { text: '术语表', link: '/zh/terminology' },
        { text: '数据格式', link: '/zh/data-format' },
        { text: '版式模板与插件', link: '/zh/extending' },
        { text: '远端存储与备份', link: '/zh/remote-backup' },
        { text: '错误码参考', link: '/zh/server/error-codes' },
      ],
    },
    {
      text: '二次开发',
      items: [
        { text: '总览与架构', link: '/zh/development/' },
        { text: '数据格式', link: '/zh/development/data-formats' },
        { text: '分格插件', link: '/zh/development/plugins' },
        { text: '目录规则', link: '/zh/development/folder-rules' },
        { text: '导出模板', link: '/zh/development/export-templates' },
        { text: '构建与打包', link: '/zh/development/build' },
        { text: '贡献指南', link: '/zh/development/contributing' },
      ],
    },
    { text: '常见问题', link: '/zh/faq' },
  ],
  search: {
    provider: 'local',
    options: {
      detailedView: true,
      translations: {
        button: { buttonText: '搜索', buttonAriaLabel: '搜索' },
        modal: {
          displayDetails: '显示详细列表',
          resetButtonTitle: '重置搜索',
          backButtonTitle: '关闭搜索',
          noResultsText: '没有找到结果：',
          footer: {
            selectText: '选择',
            selectKeyAriaLabel: '回车',
            navigateText: '切换',
            navigateUpKeyAriaLabel: '上箭头',
            navigateDownKeyAriaLabel: '下箭头',
            closeText: '关闭',
            closeKeyAriaLabel: 'Esc',
          },
        },
      },
    },
  },
  sidebar: zhSidebar,
  socialLinks: socialLinks('邮件'),
  outline: { level: [2, 3], label: localeMeta.zh.outlineLabel },
  docFooter: localeMeta.zh.docFooter,
  lastUpdated: { text: localeMeta.zh.lastUpdatedText },
  returnToTopLabel: localeMeta.zh.returnToTopLabel,
  sidebarMenuLabel: localeMeta.zh.sidebarMenuLabel,
  darkModeSwitchLabel: localeMeta.zh.darkModeSwitchLabel,
  langMenuLabel: localeMeta.zh.langMenuLabel,
}

const jaTheme = {
  selectText: '言語',
  siteTitle: 'KomaYomi ドキュメント',
  nav: [
    {
      text: 'ガイド',
      items: [
        { text: 'はじめに', link: '/ja/guide/introduction' },
        { text: 'インストールと起動', link: '/ja/guide/installation' },
        { text: 'ライブラリと取り込み', link: '/ja/guide/gallery' },
        { text: '画像の前処理と名前変更', link: '/ja/guide/preprocess' },
        { text: 'フォルダ検出の規則', link: '/ja/guide/folder-rules' },
        { text: 'コマ分割ワークベンチ', link: '/ja/guide/panels' },
        { text: '比較リーダー', link: '/ja/guide/compare' },
        { text: 'ノート', link: '/ja/guide/notes' },
        { text: 'エクスポート', link: '/ja/guide/export' },
        { text: 'バックアップとリモート', link: '/ja/guide/remote' },
        { text: 'プロジェクトファイルと形式', link: '/ja/guide/project-files' },
        { text: 'ショートカット一覧', link: '/ja/guide/shortcuts' },
        { text: 'デバイスごとの表示', link: '/ja/guide/devices' },
      ],
    },
    {
      text: 'リファレンス',
      items: [
        { text: '基本概念', link: '/ja/concepts' },
        { text: '用語集', link: '/ja/terminology' },
        { text: 'データ形式', link: '/ja/data-format' },
        { text: 'レイアウトテンプレートとプラグイン', link: '/ja/extending' },
        { text: 'リモート保存とバックアップ', link: '/ja/remote-backup' },
        { text: 'エラーコード', link: '/ja/server/error-codes' },
      ],
    },
    {
      text: 'カスタマイズ開発',
      items: [
        { text: '概要とアーキテクチャ', link: '/ja/development/' },
        { text: 'データ形式', link: '/ja/development/data-formats' },
        { text: 'コマ分割プラグイン', link: '/ja/development/plugins' },
        { text: 'フォルダー判定ルール', link: '/ja/development/folder-rules' },
        { text: 'エクスポートテンプレート', link: '/ja/development/export-templates' },
        { text: 'ビルドとパッケージング', link: '/ja/development/build' },
        { text: 'コントリビュート', link: '/ja/development/contributing' },
      ],
    },
    { text: 'FAQ', link: '/ja/faq' },
  ],
  search: {
    provider: 'local',
    options: {
      detailedView: true,
      translations: {
        button: { buttonText: '検索', buttonAriaLabel: '検索' },
        modal: {
          displayDetails: '詳細を表示',
          resetButtonTitle: '検索をリセット',
          backButtonTitle: '検索を閉じる',
          noResultsText: '結果が見つかりません：',
          footer: {
            selectText: '選択',
            selectKeyAriaLabel: 'Enter',
            navigateText: '移動',
            navigateUpKeyAriaLabel: '上矢印',
            navigateDownKeyAriaLabel: '下矢印',
            closeText: '閉じる',
            closeKeyAriaLabel: 'Esc',
          },
        },
      },
    },
  },
  sidebar: jaSidebar,
  socialLinks: socialLinks('メール'),
  outline: { level: [2, 3], label: localeMeta.ja.outlineLabel },
  docFooter: localeMeta.ja.docFooter,
  lastUpdated: { text: localeMeta.ja.lastUpdatedText },
  returnToTopLabel: localeMeta.ja.returnToTopLabel,
  sidebarMenuLabel: localeMeta.ja.sidebarMenuLabel,
  darkModeSwitchLabel: localeMeta.ja.darkModeSwitchLabel,
  langMenuLabel: localeMeta.ja.langMenuLabel,
}

export default defineConfig({
  lang: 'en-US',
  title: SITE_NAME,
  titleTemplate: ':title | KomaYomi',
  description: localeMeta.en.defaultDescription,
  base: BASE,
  cleanUrls: true,
  lastUpdated: true,
  // The contributor README is not part of the public documentation.
  srcExclude: ['README.md'],
  sitemap: {
    hostname: SITE_URL,
    /**
     * VitePress resolves every entry with `new URL(url, hostname)`, so an
     * absolute path would drop the `/KomaYomi-docs` prefix. Building absolute
     * URLs here keeps both `<loc>` and the `xhtml:link` alternates inside the
     * GitHub Pages subpath.
     */
    transformItems(items) {
      const absolute = (url: string) => `${SITE_URL}${url.startsWith('/') ? '' : '/'}${url}`
      return items
        .filter((item) => !/(^|\/)(404|README)(\.html)?$/.test(item.url))
        .map((item) => {
          const { links, ...rest } = item as { links?: Array<{ url: string }> }
          return {
            ...rest,
            url: absolute(item.url),
            ...(links?.length
              ? { links: links.map((link) => ({ ...link, url: absolute(link.url) })) }
              : {}),
          }
        })
    },
  },
  vite: {
    define: {
      __BUILD_SHA_SHORT__: JSON.stringify(BUILD_SHA_SHORT),
      __BUILD_SHA_FULL__: JSON.stringify(BUILD_SHA),
      __BUILD_TIME__: JSON.stringify(BUILD_TIME),
    },
  },
  head: [
    ['meta', { name: 'theme-color', content: '#c2410c' }],
    ['meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }],
    ['meta', { name: 'robots', content: 'index,follow,max-image-preview:large' }],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${BASE}logo.svg` }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
  ],
  locales: {
    root: {
      label: 'English',
      lang: 'en-US',
      title: SITE_NAME,
      description: localeMeta.en.defaultDescription,
      themeConfig: enTheme,
    },
    zh: {
      label: '简体中文',
      lang: 'zh-CN',
      title: SITE_NAME,
      description: localeMeta.zh.defaultDescription,
      themeConfig: zhTheme,
    },
    ja: {
      label: '日本語',
      lang: 'ja-JP',
      title: SITE_NAME,
      description: localeMeta.ja.defaultDescription,
      themeConfig: jaTheme,
    },
  },
  markdown: {
    // Line numbers are on by default; short one-off commands opt out with
    // `:no-line-numbers` so a lone "1" does not add noise.
    lineNumbers: true,
    // External links open in a new tab; a runtime handler in the theme also
    // covers links rendered inside Vue components.
    externalLinks: { target: '_blank', rel: 'noopener noreferrer' },
    image: { lazyLoading: true },
    toc: { level: [2, 3] },
    /**
     * Raw HTML inside Markdown is not rewritten by VitePress, so root-absolute
     * `href` values (the 404 page links) would lose the deploy subpath. Prefix
     * them with `base` while rendering. `<img src>` is left alone because Vite
     * already resolves public assets (`/assets/...`) and prepends `base`.
     */
    config(md) {
      const rewrite = (html: string) => html.replace(/\bhref="\/(?!\/)/g, `href="${BASE}`)

      const htmlBlock = md.renderer.rules.html_block
      md.renderer.rules.html_block = (tokens, idx, options, env, self) =>
        rewrite(htmlBlock ? htmlBlock(tokens, idx, options, env, self) : tokens[idx].content)

      const htmlInline = md.renderer.rules.html_inline
      md.renderer.rules.html_inline = (tokens, idx, options, env, self) =>
        rewrite(htmlInline ? htmlInline(tokens, idx, options, env, self) : tokens[idx].content)
    },
  },
  transformPageData(pageData) {
    const locale = localeOf(pageData.relativePath)
    const meta = localeMeta[locale]
    if (!pageData.frontmatter.description) {
      const derived = isHome(pageData.relativePath)
        ? meta.defaultDescription
        : firstParagraphOf(pageData.relativePath)
      const description = clamp(derived || meta.defaultDescription)
      pageData.description = description
      pageData.frontmatter.description = description
    }
  },
  transformHead({ pageData }) {
    const relativePath = pageData.relativePath
    const locale = localeOf(relativePath)
    const meta = localeMeta[locale]
    const home = isHome(relativePath)
    const title = home ? SITE_NAME : headingOf(relativePath) || pageData.title || SITE_NAME
    const description = pageData.frontmatter.description || meta.defaultDescription
    const canonical = pageUrl(relativePath)
    const alternates = alternateUrls(relativePath)
    const fullTitle = home ? `${SITE_NAME} — ${meta.tagline}` : `${title} | ${SITE_NAME}`

    const alternateLocales = (['en', 'zh', 'ja'] as LocaleCode[])
      .filter((code) => code !== locale)
      .map((code) => ['meta', { property: 'og:locale:alternate', content: localeMeta[code].ogLocale }])

    return [
      ['link', { rel: 'canonical', href: canonical }],
      ['meta', { name: 'keywords', content: meta.keywords }],
      ['meta', { name: 'author', content: AUTHOR }],
      ['link', { rel: 'alternate', hreflang: localeMeta.en.lang, href: alternates.en }],
      ['link', { rel: 'alternate', hreflang: localeMeta.zh.lang, href: alternates.zh }],
      ['link', { rel: 'alternate', hreflang: localeMeta.ja.lang, href: alternates.ja }],
      ['link', { rel: 'alternate', hreflang: 'x-default', href: alternates.en }],
      ['meta', { property: 'og:type', content: home ? 'website' : 'article' }],
      ['meta', { property: 'og:site_name', content: SITE_NAME }],
      ['meta', { property: 'og:title', content: fullTitle }],
      ['meta', { property: 'og:description', content: description }],
      ['meta', { property: 'og:url', content: canonical }],
      ['meta', { property: 'og:image', content: SOCIAL_IMAGE }],
      ['meta', { property: 'og:image:alt', content: `${SITE_NAME} — ${meta.tagline}` }],
      ['meta', { property: 'og:locale', content: meta.ogLocale }],
      ...alternateLocales,
      ['meta', { name: 'twitter:title', content: fullTitle }],
      ['meta', { name: 'twitter:description', content: description }],
      ['meta', { name: 'twitter:image', content: SOCIAL_IMAGE }],
      [
        'script',
        { type: 'application/ld+json' },
        JSON.stringify(jsonLd(relativePath, title, description)),
      ],
    ]
  },
  themeConfig: {
    logo: '/logo.svg',
    externalLinkIcon: true,
    // Social icons live on each locale theme so their tooltips match the
    // language; see `socialLinks()` above.
    ...enTheme,
  },
})
