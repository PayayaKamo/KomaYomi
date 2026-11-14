import type { Lang } from '../shared/types';

export type { Lang } from '../shared/types';
export {
  LANGUAGES,
  LANG_LABEL,
  LANG_SHORT,
  READING_LABEL,
  DEFAULT_OFFSET,
  DEFAULT_EXPORT_CONFIG,
  ALIGN_MODE_LABEL,
  ALIGN_MODE_HINT,
  SINGLE_CHAPTER,
} from '../shared/types';
export type {
  AlignMode,
  AlignOffset,
  AlignPreset,
  Annotation,
  AnnotationKind,
  ChapterEntry,
  DetectResult,
  ExportConfig,
  ExportTemplate,
  LayoutCell,
  LayoutGrid,
  LayoutMargin,
  LayoutRow,
  LayoutScope,
  LayoutTemplate,
  Library,
  Note,
  NoteImage,
  NoteSource,
  PageDoc,
  PageEntry,
  PageResponse,
  Panel,
  PanelGroup,
  PanelRect,
  PanelTemplate,
  ReadingDirection,
  VolumeEntry,
} from '../shared/types';

/* ---- 目录识别规则（前端展示用，服务端同名类型是数据来源） ---- */

export type DirRule = {
  id: string;
  name?: string;
  pattern: string;
  ignore?: string[];
  extensions?: string[];
  /** Fallback language for flat structures without a {language} segment */
  language?: Lang;
  enabled?: boolean;
};

export type UnmatchedFile = { file: string; reason: string };

export type LibraryScanInfo = {
  rules: DirRule[];
  unmatchedCount: number;
  unmatched: UnmatchedFile[];
  truncated: boolean;
  warning?: string;
};

export type DirPreview = {
  dir: string;
  rules: DirRule[];
  hits: Record<string, number>;
  matched: number;
  unmatched: UnmatchedFile[];
  unmatchedCount: number;
  truncated: boolean;
  tree: {
    id: string;
    dir: string;
    languages: Lang[];
    chapters: { chapter: string; pages: number; langs: Partial<Record<Lang, number>> }[];
  }[];
};
