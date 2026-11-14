import { useEffect, useMemo, useRef, useState } from 'react';
import type { DirPreview, DirRule, Lang, Library } from '../types';
import { LANG_SHORT } from '../types';
import { api } from '../api';

type Props = {
  onClose: () => void;
  onSaved: (library: Library) => void;
};

const EXAMPLE_RULE: DirRule = {
  id: 'series-volume-chapter-language-page',
  name: '系列 / 卷 / 话 / 语言 / 页',
  pattern: '{series}/{volume}/{chapter}/{language}/{page}',
  ignore: ['_extras'],
};

const pretty = (rules: DirRule[]) => JSON.stringify(rules, null, 2);

/**
 * 目录识别：用声明式规则描述「页文件」在磁盘上的层级，实时预览解析结果。
 * 设计上把规则当作纯文本 JSON 编辑，避免为每种结构做一套表单，
 * 同时用实时预览 + 未识别清单把「为什么没扫出来」讲清楚。
 */
export function DirRulesDialog({ onClose, onSaved }: Props) {
  const [text, setText] = useState('');
  const [original, setOriginal] = useState('');
  const [defaults, setDefaults] = useState<DirRule[]>([]);
  const [customized, setCustomized] = useState(false);
  const [warning, setWarning] = useState<string | undefined>();
  const [dir, setDir] = useState('');
  const [preview, setPreview] = useState<DirPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    api
      .dirRules()
      .then((res) => {
        setText(pretty(res.rules));
        setOriginal(pretty(res.rules));
        setDefaults(res.defaults);
        setCustomized(res.customized);
        setWarning(res.warning);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const parsed = useMemo<{ rules?: DirRule[]; error?: string }>(() => {
    if (!text.trim()) return { error: '规则不能为空' };
    try {
      const value = JSON.parse(text) as unknown;
      if (!Array.isArray(value) || !value.length) return { error: '规则需要是非空数组' };
      return { rules: value as DirRule[] };
    } catch (err) {
      return { error: `JSON 语法错误：${err instanceof Error ? err.message : String(err)}` };
    }
  }, [text]);

  // 规则或目录一变就重新预览（防抖），改完无需保存即可看到效果。
  useEffect(() => {
    if (!parsed.rules) {
      setPreviewError(parsed.error ?? null);
      return;
    }
    const id = ++seq.current;
    const timer = setTimeout(() => {
      api
        .previewLibrary({ dir: dir.trim(), rules: parsed.rules })
        .then((res) => {
          if (id !== seq.current) return;
          setPreview(res);
          setPreviewError(null);
        })
        .catch((err) => {
          if (id !== seq.current) return;
          setPreview(null);
          setPreviewError(err instanceof Error ? err.message : String(err));
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [parsed.rules, parsed.error, dir]);

  const save = async () => {
    if (!parsed.rules) {
      setError(parsed.error ?? '规则无效');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.saveDirRules(parsed.rules);
      setText(pretty(res.rules));
      setOriginal(pretty(res.rules));
      setCustomized(true);
      onSaved(res.library);
      setMessage('规则已保存，图库已按新规则重新扫描');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.saveDirRules([]);
      setText(pretty(res.rules));
      setOriginal(pretty(res.rules));
      setCustomized(false);
      onSaved(res.library);
      setMessage('已恢复默认规则');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const dirty = text !== original;

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <header className="modal-head">
          <div>
            <h2>目录识别规则</h2>
            <p>
              用占位符描述页文件路径：{'{series}'} {'{volume}'} {'{chapter}'} {'{language}'} {'{page}'}
              ；按顺序尝试，第一个命中的规则生效
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="dirrules-body">
          <section className="dirrules-col">
            <div className="field">
              <span>规则（JSON 数组，可加 {'{chapter}?'} 表示可选段）</span>
              <textarea
                className="dirrules-editor"
                spellCheck={false}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
            {parsed.error && <div className="banner error">{parsed.error}</div>}
            {warning && <div className="banner warn">{warning}</div>}
            <div className="row-inline dirrules-actions">
              <button type="button" className="btn tiny" onClick={() => setText(pretty([...(parsed.rules ?? []), EXAMPLE_RULE]))}>
                ＋ 插入示例规则
              </button>
              <button type="button" className="btn tiny" onClick={() => setText(pretty(defaults))} disabled={!defaults.length}>
                填入默认规则
              </button>
              <button type="button" className="btn tiny" onClick={() => void reset()} disabled={busy || !customized}>
                恢复默认
              </button>
            </div>
            <p className="muted tiny">
              可用占位符：series / volume / chapter / language / page；<code>*</code> 匹配任意一段；
              ignore 里的目录名会被跳过；extensions 可自定义扩展名。语言目录仍按 ja/jp/日、zh/cn/tw、en/us 等自动识别，
              认不出的在「卷设置」里手动指定。
            </p>
          </section>

          <section className="dirrules-col">
            <div className="row-inline">
              <input
                value={dir}
                placeholder="只预览某个子目录（留空 = 整个 raw）"
                onChange={(e) => setDir(e.target.value)}
              />
            </div>
            {previewError && <div className="banner error">{previewError}</div>}
            {preview && (
              <>
                <div className="dirrules-summary">
                  命中 {preview.matched} 个文件 · {preview.tree.length} 卷
                  {preview.unmatchedCount > 0 && ` · ${preview.unmatchedCount} 个未识别`}
                  {preview.truncated && ' · 文件过多，结果已截断'}
                </div>
                <div className="dirrules-tree">
                  {preview.tree.length === 0 && <div className="muted tiny">没有匹配到任何页文件</div>}
                  {preview.tree.map((volume) => (
                    <div className="dirrules-volume" key={volume.id}>
                      <div className="dirrules-volume-head">
                        <strong>{volume.id}</strong>
                        <span className="muted tiny">{volume.dir ? `raw/${volume.dir}` : 'raw'}</span>
                        <span className="dirrules-langs">
                          {volume.languages.map((l: Lang) => (
                            <span className="chip-mini ok" key={l}>
                              {LANG_SHORT[l]}
                            </span>
                          ))}
                        </span>
                      </div>
                      {volume.chapters.map((chapter) => (
                        <div className="dirrules-chapter" key={chapter.chapter}>
                          <span>{chapter.chapter}</span>
                          <span className="muted tiny">
                            {chapter.pages} 页 ·{' '}
                            {volume.languages
                              .map((l) => `${LANG_SHORT[l]} ${chapter.langs[l] ?? 0}`)
                              .join(' / ')}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                {preview.unmatched.length > 0 && (
                  <div className="dirrules-unmatched">
                    <div className="dirrules-unmatched-head">未识别文件（前 {preview.unmatched.length} 条）</div>
                    {preview.unmatched.map((item) => (
                      <div className="dirrules-unmatched-row" key={item.file}>
                        <code>{item.file}</code>
                        <span>{item.reason}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        </div>

        <footer className="modal-foot">
          <span className="muted tiny">
            {dirty ? '有未保存的规则修改（预览已生效）' : '规则与应用配置一致'}
          </span>
          <span className="spacer" />
          {error && <span className="dirrules-error">{error}</span>}
          {message && <span className="muted tiny">{message}</span>}
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
          <button type="button" className="btn primary" disabled={busy || !parsed.rules} onClick={() => void save()}>
            {busy ? '保存中…' : '保存规则'}
          </button>
        </footer>
      </div>
    </div>
  );
}
