import { useEffect, useMemo, useRef, useState } from 'react';
import type { DirPreview, DirRule, Lang, Library } from '../types';
import { LANG_SHORT } from '../types';
import { api } from '../api';
import { formatNumber, t, useI18n } from '../i18n';

type Props = {
  onClose: () => void;
  onSaved: (library: Library) => void;
};

const exampleRule = (): DirRule => ({
  id: 'series-volume-chapter-language-page',
  name: t('dirRules.exampleRuleName'),
  pattern: '{series}/{volume}/{chapter}/{language}/{page}',
  ignore: ['_extras'],
});

const pretty = (rules: DirRule[]) => JSON.stringify(rules, null, 2);

/**
 * 目录识别：用声明式规则描述「页文件」在磁盘上的层级，实时预览解析结果。
 * 设计上把规则当作纯文本 JSON 编辑，避免为每种结构做一套表单，
 * 同时用实时预览 + 未识别清单把「为什么没扫出来」讲清楚。
 */
export function DirRulesDialog({ onClose, onSaved }: Props) {
  const { t } = useI18n();
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
    if (!text.trim()) return { error: t('dirRules.empty') };
    try {
      const value = JSON.parse(text) as unknown;
      if (!Array.isArray(value) || !value.length) return { error: t('dirRules.notArray') };
      return { rules: value as DirRule[] };
    } catch (err) {
      return { error: t('dirRules.jsonError', { error: err instanceof Error ? err.message : String(err) }) };
    }
  }, [text, t]);

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
      setError(parsed.error ?? t('dirRules.invalid'));
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
      setMessage(t('dirRules.saved'));
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
      setMessage(t('dirRules.resetDone'));
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
            <h2>{t('dirRules.title')}</h2>
            <p>
              {t('dirRules.introBefore')}
              {'{series}'} {'{volume}'} {'{chapter}'} {'{language}'} {'{page}'}
              {t('dirRules.introAfter')}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="dirrules-body">
          <section className="dirrules-col">
            <div className="field">
              <span>
                {t('dirRules.rulesLabelBefore')}
                {'{chapter}?'}
                {t('dirRules.rulesLabelAfter')}
              </span>
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
              <button
                type="button"
                className="btn tiny"
                onClick={() => setText(pretty([...(parsed.rules ?? []), exampleRule()]))}
              >
                {t('dirRules.insertExample')}
              </button>
              <button
                type="button"
                className="btn tiny"
                onClick={() => setText(pretty(defaults))}
                disabled={!defaults.length}
              >
                {t('dirRules.fillDefaults')}
              </button>
              <button type="button" className="btn tiny" onClick={() => void reset()} disabled={busy || !customized}>
                {t('dirRules.restoreDefaults')}
              </button>
            </div>
            <p className="muted tiny">
              {t('dirRules.helpBefore')}
              <code>*</code>
              {t('dirRules.helpAfterStar')}
            </p>
          </section>

          <section className="dirrules-col">
            <div className="row-inline">
              <input
                value={dir}
                placeholder={t('dirRules.previewDirPlaceholder')}
                onChange={(e) => setDir(e.target.value)}
              />
            </div>
            {previewError && <div className="banner error">{previewError}</div>}
            {preview && (
              <>
                <div className="dirrules-summary">
                  {t('dirRules.summary', {
                    files: formatNumber(preview.matched),
                    volumes: formatNumber(preview.tree.length),
                  })}
                  {preview.unmatchedCount > 0 &&
                    t('dirRules.summaryUnmatched', { count: formatNumber(preview.unmatchedCount) })}
                  {preview.truncated && t('dirRules.summaryTruncated')}
                </div>
                <div className="dirrules-tree">
                  {preview.tree.length === 0 && <div className="muted tiny">{t('dirRules.noPages')}</div>}
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
                            {t('dirRules.chapterPages', { count: formatNumber(chapter.pages) })} ·{' '}
                            {volume.languages.map((l) => `${LANG_SHORT[l]} ${chapter.langs[l] ?? 0}`).join(' / ')}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                {preview.unmatched.length > 0 && (
                  <div className="dirrules-unmatched">
                    <div className="dirrules-unmatched-head">
                      {t('dirRules.unmatchedHeading', { count: formatNumber(preview.unmatched.length) })}
                    </div>
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
          <span className="muted tiny">{dirty ? t('dirRules.dirty') : t('dirRules.inSync')}</span>
          <span className="spacer" />
          {error && <span className="dirrules-error">{error}</span>}
          {message && <span className="muted tiny">{message}</span>}
          <button type="button" className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
          <button type="button" className="btn primary" disabled={busy || !parsed.rules} onClick={() => void save()}>
            {busy ? t('dirRules.saving') : t('dirRules.saveRules')}
          </button>
        </footer>
      </div>
    </div>
  );
}
