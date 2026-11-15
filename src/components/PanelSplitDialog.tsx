import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { PanelRect } from '../types';
import { splitRect } from '../lib/geometry';
import { useI18n } from '../i18n';

type Orientation = 'v' | 'h';

type Props = { rect: PanelRect; panelNo: number | null; onClose: () => void; onApply: (pieces: PanelRect[]) => void };

const MIN_GAP = 0.04;
const MAX_COUNT = 12;

function evenCuts(count: number): number[] {
  return Array.from({ length: count - 1 }, (_, i) => (i + 1) / count);
}

function clampCut(value: number, index: number, cuts: number[]): number {
  const min = (index === 0 ? 0 : cuts[index - 1]) + MIN_GAP;
  const max = (index === cuts.length - 1 ? 1 : cuts[index + 1]) - MIN_GAP;
  return Math.min(Math.max(min, value), Math.max(min, max));
}

/** Preview the split before it lands: lines can be dragged, nudged or left at the even split. */
export function PanelSplitDialog({ rect, panelNo, onClose, onApply }: Props) {
  const { t, formatNumber: fmt } = useI18n();
  const [count, setCount] = useState(2);
  const [orientation, setOrientation] = useState<Orientation>('v');
  const [cuts, setCuts] = useState<number[]>(evenCuts(2));
  const [dragging, setDragging] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => setCuts(evenCuts(count)), [count]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (dragging === null) return;
    const move = (e: PointerEvent) => {
      const box = boxRef.current?.getBoundingClientRect();
      if (!box) return;
      const raw = orientation === 'v' ? (e.clientX - box.left) / box.width : (e.clientY - box.top) / box.height;
      setCuts((list) => list.map((value, i) => (i === dragging ? clampCut(raw, i, list) : value)));
    };
    const up = () => setDragging(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [dragging, orientation]);

  const pieces = useMemo(() => splitRect(rect, orientation, cuts), [rect, orientation, cuts]);

  const nudge = (index: number, delta: number) =>
    setCuts((list) => list.map((value, i) => (i === index ? clampCut(value + delta, i, list) : value)));

  const startLine = (index: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setDragging(index);
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal split-modal" role="dialog" aria-modal="true" aria-labelledby="split-title">
        <header className="modal-head">
          <h2 id="split-title">
            {t('split.title')}
            {panelNo !== null && <span className="muted"> #{fmt(panelNo)}</span>}
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
            ×
          </button>
        </header>
        <div className="modal-body">
          <div className="split-controls">
            <div className="split-field">
              <span className="tb-label">{t('split.count')}</span>
              <div className="seg">
                {[2, 3, 4].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={count === n ? 'on' : ''}
                    aria-pressed={count === n}
                    onClick={() => setCount(n)}
                  >
                    {fmt(n)}
                  </button>
                ))}
              </div>
              <input
                className="split-count"
                type="number"
                min={2}
                max={MAX_COUNT}
                value={count}
                aria-label={t('split.count')}
                onChange={(e) => {
                  const next = Number.parseInt(e.target.value, 10);
                  if (Number.isFinite(next)) setCount(Math.min(Math.max(2, next), MAX_COUNT));
                }}
              />
            </div>
            <div className="split-field">
              <span className="tb-label">{t('split.orientation')}</span>
              <div className="seg">
                <button
                  type="button"
                  className={orientation === 'v' ? 'on' : ''}
                  aria-pressed={orientation === 'v'}
                  onClick={() => setOrientation('v')}
                >
                  {t('split.vertical')}
                </button>
                <button
                  type="button"
                  className={orientation === 'h' ? 'on' : ''}
                  aria-pressed={orientation === 'h'}
                  onClick={() => setOrientation('h')}
                >
                  {t('split.horizontal')}
                </button>
              </div>
            </div>
            <button type="button" className="btn tiny" onClick={() => setCuts(evenCuts(count))}>
              {t('split.even')}
            </button>
          </div>

          <p className="field-hint">{t('split.hint')}</p>

          <div className="split-preview">
            <div
              ref={boxRef}
              className={`split-box split-${orientation}`}
              style={{ aspectRatio: `${rect.w || 1} / ${rect.h || 1}` }}
              aria-label={t('split.preview')}
            >
              {cuts.map((cut, i) => (
                <div
                  key={i}
                  className={`split-line ${dragging === i ? 'active' : ''}`}
                  style={orientation === 'v' ? { left: `${cut * 100}%` } : { top: `${cut * 100}%` }}
                  role="slider"
                  tabIndex={0}
                  aria-orientation={orientation === 'v' ? 'horizontal' : 'vertical'}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(cut * 100)}
                  aria-label={t('split.lineLabel', { n: fmt(i + 1) })}
                  onPointerDown={startLine(i)}
                  onKeyDown={(e) => {
                    const back = orientation === 'v' ? 'ArrowLeft' : 'ArrowUp';
                    const forward = orientation === 'v' ? 'ArrowRight' : 'ArrowDown';
                    if (e.key !== back && e.key !== forward) return;
                    e.preventDefault();
                    nudge(i, (e.shiftKey ? 0.05 : 0.01) * (e.key === back ? -1 : 1));
                  }}
                >
                  <span className="split-grip" aria-hidden="true">
                    ⠿
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="split-sizes">
            {pieces.map((piece, i) => (
              <span key={i} className="chip-mini">
                {fmt(Math.round((orientation === 'v' ? piece.w / rect.w : piece.h / rect.h) * 100))}%
              </span>
            ))}
          </div>
          <p className="field-hint">{t('split.annotationHint')}</p>
        </div>
        <footer className="modal-foot">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn primary" onClick={() => onApply(pieces)}>
            {t('split.apply')}
          </button>
        </footer>
      </div>
    </div>
  );
}
