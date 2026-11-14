export const LANGUAGES = ['ja', 'zh', 'en'] as const;
export type Lang = (typeof LANGUAGES)[number];

/** 规则没有 {chapter} 占位符时使用的章节名（单话结构） */
export const SINGLE_CHAPTER = '全一话';

export const LANG_LABEL: Record<Lang, string> = {
  ja: '日本語',
  zh: '中文',
  en: 'English',
};

export const LANG_SHORT: Record<Lang, string> = {
  ja: 'JA',
  zh: 'ZH',
  en: 'EN',
};

/** 归一化到 0..1 的矩形（相对整页） */
export type PanelRect = { x: number; y: number; w: number; h: number };

export type Panel = {
  id: string;
  rect: PanelRect;
  /** 自动检测 / 手动绘制 */
  source?: 'auto' | 'manual' | 'merged';
  /** 手动指定的格子编号；缺省按阅读顺序自动编号 */
  number?: number;
};

export type NoteSource = {
  /** 网页标题（可选） */
  title?: string;
  url?: string;
  /** 自由文本来源，例如「大模型对话 2026-05-01」 */
  text?: string;
};

export type Note = {
  id: string;
  /** page = 整页批注；panel = 某个格子 */
  scope: 'page' | 'panel';
  panelId: string | null;
  text: string;
  tags: string[];
  /** 资料出处：链接、标题或自由文本 */
  source?: NoteSource;
  /** 笔记内贴图（截图），以 data URL 存在页 JSON 里 */
  images?: NoteImage[];
  createdAt: string;
  updatedAt: string;
};

/** rtl = 行从上到下、行内从右到左（默认）；ltr = 行内从左到右；ttb = 列从右到左、列内从上到下 */
export type ReadingDirection = 'rtl' | 'ltr' | 'ttb';

export const READING_LABEL: Record<ReadingDirection, string> = {
  rtl: '从右到左 · 从上到下',
  ltr: '从左到右 · 从上到下',
  ttb: '从右到左 · 竖排',
};

/**
 * 每种语言的对齐偏移，x/y 为相对容器宽高的比例，scale 为缩放倍数。
 * 用于在对比视图中把同一格对齐。
 */
export type AlignOffset = { x: number; y: number; scale: number };

export const DEFAULT_OFFSET: AlignOffset = { x: 0, y: 0, scale: 1 };

/** 对齐模式：整页统一偏移 / 逐格独立偏移 / 锚点取点对齐 / 网格吸附 */
export type AlignMode = 'page' | 'panel' | 'anchors' | 'grid';

export const ALIGN_MODE_LABEL: Record<AlignMode, string> = {
  page: '整页偏移',
  panel: '逐格偏移',
  anchors: '锚点对齐',
  grid: '网格吸附',
};

export const ALIGN_MODE_HINT: Record<AlignMode, string> = {
  page: '拖动任一格都会平移整页，适合同一版本扫描件整体错位',
  panel: '每一格单独拖动对齐，适合电子版与纸质版版面有差异',
  anchors: '先在参考语言上点一个特征点，再在目标语言上点同一位置，自动算偏移',
  grid: '拖动时按网格步长吸附，适合需要整齐数值的场景',
};

/* ---------------- 声明式版式模板 ---------------- */

export type LayoutScope = 'volume' | 'chapter' | 'page';

export type LayoutMargin = { top: number; right: number; bottom: number; left: number };

/** 一行里的格子；span 为横向跨列数，默认为 1 */
export type LayoutCell = { span?: number };

export type LayoutRow = { height?: number; cells: LayoutCell[] };

/**
 * 用「行 + 每行格子跨度」描述版式，比记坐标更适合固定版式的漫画。
 * 例：两列三行 = { cols: 2, rows: [{cells:[{},{ }]}, ...] }
 */
export type LayoutGrid = { cols: number; rows: LayoutRow[] };

export type LayoutTemplate = {
  id: string;
  name: string;
  /** 绑定层级：单页 > 话 > 卷 */
  scope: LayoutScope;
  volume: string;
  chapter?: string;
  /** 0 起的页序，仅 scope=page 时使用 */
  pageIndex?: number;
  readingDirection?: ReadingDirection;
  margin?: Partial<LayoutMargin>;
  /** 格间距，相对页宽/高的比例 */
  gap?: number;
  /** 每列宽度权重，缺省等宽 */
  colWeights?: number[];
  grid: LayoutGrid;
  /** 对个别页覆盖 grid/margin/gap（键为 1 起的页码） */
  pageOverrides?: Record<string, Partial<Pick<LayoutTemplate, 'grid' | 'margin' | 'gap' | 'colWeights'>>>;
  createdAt?: string;
  notes?: string;
};

/** 切格插件命中后的来源信息 */
export type DetectSource = 'auto' | 'template' | 'plugin' | 'manual';

/* ---------------- 标注层与分组 ---------------- */

export type PanelGroup = {
  id: string;
  name: string;
  panelIds: string[];
  /** 组单独编号（可选） */
  number?: number;
};

export type AnnotationKind =
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'highlight'
  | 'text'
  | 'badge'
  | 'mosaic'
  | 'pen';

/** 矢量标注：坐标相对所属 scope 的框（页或格），0..1 */
export type Annotation = {
  id: string;
  kind: AnnotationKind;
  scope: 'page' | 'panel';
  panelId?: string | null;
  /** 起点/终点；自由笔迹为整条折线 */
  points: { x: number; y: number }[];
  color?: string;
  width?: number;
  opacity?: number;
  text?: string;
  fontSize?: number;
  createdAt: string;
  updatedAt: string;
};

export type NoteImage = {
  id: string;
  name: string;
  /** data:image/...;base64,... */
  dataUrl: string;
};

export type PageDoc = {
  version: 1;
  volume: string;
  chapter: string;
  pageIndex: number;
  panels: Panel[];
  notes: Note[];
  /** 整页统一偏移（page / grid 模式） */
  offsets: Partial<Record<Lang, AlignOffset>>;
  alignMode: AlignMode;
  /** 逐格独立偏移（panel / anchors 模式）：panelId -> lang -> offset */
  panelOffsets: Record<string, Partial<Record<Lang, AlignOffset>>>;
  /** 网格吸附步长（百分比，例如 1 表示 1%） */
  gridStep?: number;
  readingDirection: ReadingDirection;
  updatedAt: string;
  /** 切格来源与算法版本：用于识别旧结果、提示是否被手动改过 */
  detectorVersion?: string;
  detectedAt?: string;
  detectSource?: 'auto' | 'template' | 'plugin' | 'manual';
  /** 轻量编辑历史（不是审计日志）：只记次数、最后一次时间与变更摘要 */
  editCount?: number;
  lastEditedAt?: string;
  lastEditSummary?: string;
  /** 分组：跨格大图等成组内容，落盘保存而不是仅界面标记 */
  groups?: PanelGroup[];
  /** 独立标注图层（与文字笔记分离） */
  annotations?: Annotation[];
  /** 标注图层总开关；关闭时保留数据但界面与导出都隐藏 */
  annotationsVisible?: boolean;
};

export type PanelTemplate = {
  id: string;
  name: string;
  volume: string;
  chapter: string;
  panels: PanelRect[];
  readingDirection: ReadingDirection;
  createdAt: string;
};

export type AlignPreset = {
  id: string;
  name: string;
  scope: 'page' | 'chapter';
  volume: string;
  chapter: string;
  mode: AlignMode;
  offsets: Partial<Record<Lang, AlignOffset>>;
  panelOffsets: Record<string, Partial<Record<Lang, AlignOffset>>>;
  gridStep?: number;
  createdAt: string;
};

export type PageEntry = {
  index: number;
  files: Partial<Record<Lang, string>>;
  filenames: Partial<Record<Lang, string>>;
  warnings: string[];
  annotated: boolean;
};

export type ChapterEntry = {
  id: string;
  volume: string;
  chapter: string;
  pages: PageEntry[];
  warnings: string[];
};

export type VolumeEntry = {
  id: string;
  title: string;
  chapters: ChapterEntry[];
  warnings: string[];
  /** 语言 → raw 下的实际目录名（一部漫画可以只有 1–3 种语言） */
  langDirs: Partial<Record<Lang, string>>;
  /** 该卷实际可用的语言 */
  languages: Lang[];
  /** raw/<卷> 下的全部子目录，供用户在卷设置里重新指定语言目录 */
  dirs: string[];
};

export type Library = {
  root: string;
  languages: Lang[];
  volumes: VolumeEntry[];
};

export type DetectResult = {
  width: number;
  height: number;
  panels: PanelRect[];
  meta: { scale: number; threshold: number; ms: number };
  /** 算法版本与来源（模板/插件/自动） */
  version?: string;
  source?: 'auto' | 'template' | 'plugin';
  lang?: string;
  warnings?: string[];
};

export type PageResponse = {
  doc: PageDoc;
  page: PageEntry;
  chapterId: string;
  volume: string;
  chapter: string;
  exists: boolean;
};

export type ExportBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string };

export type ExportConfig = {
  template: 'two-column' | 'stack' | 'compare-wide';
  title: string;
  volume: string;
  chapter: string;
  pageIndices: number[];
  languages: Lang[];
  embedImages: boolean;
  /** 每种语言的平移（相对图片宽高比例），用于导出时对齐 */
  offsets: Partial<Record<Lang, AlignOffset>>;
  showPanelBoxes: boolean;
  includeNotes: boolean;
  /** 只导出有笔记的页 */
  onlyWithNotes?: boolean;
  noteFilterTags: string[];
  pageWidthRatio: number;
  columnGap: number;
  fontScale: number;
  /** 分格对照模板下每行放几个格子 */
  columns: number;
};

export const DEFAULT_EXPORT_CONFIG: Omit<ExportConfig, 'volume' | 'chapter' | 'pageIndices' | 'offsets'> = {
  template: 'two-column',
  title: '漫画对照批注',
  languages: ['ja', 'zh', 'en'],
  embedImages: false,
  showPanelBoxes: false,
  includeNotes: true,
  onlyWithNotes: false,
  noteFilterTags: [],
  pageWidthRatio: 46,
  columnGap: 28,
  fontScale: 1,
  columns: 1,
};

/** 用户保存的导出模板（只存版式设置，范围/卷话在导出时决定） */
export type ExportTemplate = {
  id: string;
  name: string;
  createdAt: string;
  config: Partial<ExportConfig>;
};
