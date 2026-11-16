/**
 * Note pins on the artwork.
 *
 * Every note can carry an anchor (whole-page fractions plus the language lane it was placed
 * in). This layer draws one dot per position in a single language pane: the colour follows the
 * note category, notes sharing a spot collapse into one dot with a count badge, and clicking a
 * dot opens the notes pinned there. Dots are positioned through the same alignment offset and
 * zoom as the image, so they stay glued to the artwork.
 *
 * In read-only mode dots stay visible and clickable but can neither be created nor dragged;
 * the pane underneath owns anchor placement while a composer is picking a spot.
 */
import { useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { AlignOffset, Lang, Note, NoteAnchor, NoteTypeDef, Panel } from '../types';
import { BUILTIN_NOTE_TYPES, DEFAULT_NOTE_TYPE, NOTE_TYPE_COLORS, languageNoteTypeId } from '../types';
import { groupAnchoredNotes, pagePointToPane, panePointToPage } from '../../shared/noteAnchors';
import { renderMarkdown } from '../../shared/markdown';
import { langLabel, useI18n } from '../i18n';

type Props = {
  /** All notes of the page; the layer filters by panel and lane itself. */
  notes: Note[];
  panel: Panel;
  lang: Lang;
  offset: AlignOffset;
  /** Extra zoom applied by the parent (panel detail view); compare view leaves it at 1. */
  zoom?: number;
  noteTypes?: NoteTypeDef[];
  langs?: Lang[];
  /** Viewer mode: dots open notes but never move. */
  readOnly?: boolean;
  /** Move every note in a group to a new spot on the page. */
  onMove?: (ids: string[], anchor: NoteAnchor) => void;
  /** Hide dots (and their popup) while the composer is picking a new anchor. */
  hidden?: boolean;
};

/** Same category resolution the notes panel and compare markers use. */
function useTypeMeta(noteTypes: NoteTypeDef[] | undefined, langs: Lang[]) {
  const { t } = useI18n();
  const map = new Map<string, { name: string; color: string }>();
  for (const id of BUILTIN_NOTE_TYPES) map.set(id, { name: t(`notes.type.${id}`), color: NOTE_TYPE_COLORS[id] });
  for (const lang of langs) {
    map.set(languageNoteTypeId(lang), {
      name: t('notes.typeLanguage', { lang: langLabel(lang) }),
      color: NOTE_TYPE_COLORS[DEFAULT_NOTE_TYPE],
    });
  }
  for (const def of noteTypes ?? []) map.set(def.id, { name: def.name, color: def.color });
  return (note: Note) => {
    const id = note.type && map.has(note.type) ? note.type : DEFAULT_NOTE_TYPE;
    return map.get(id) ?? { name: t(`notes.type.${DEFAULT_NOTE_TYPE}`), color: NOTE_TYPE_COLORS[DEFAULT_NOTE_TYPE] };
  };
}

type DragState = { ids: string[]; startX: number; startY: number; moved: boolean };

export function NoteAnchorLayer({
  notes,
  panel,
  lang,
  offset,
  zoom = 1,
  noteTypes,
  langs = [],
  readOnly = false,
  onMove,
  hidden = false,
}: Props) {
  const { t } = useI18n();
  const metaOf = useTypeMeta(noteTypes, langs);
  const ref = useRef<HTMLDivElement>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  /** A finished drag must not also toggle the popup through the click that follows it. */
  const skipClickRef = useRef(false);

  const groups = groupAnchoredNotes(notes, panel, lang);
  if (hidden || !groups.length) return null;

  /** Pane-relative pointer position → page point, undoing offset and parent zoom. */
  const pagePointFromEvent = (e: { clientX: number; clientY: number }) => {
    const el = ref.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return panePointToPage((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, panel.rect, offset, zoom);
  };

  const startDrag = (e: ReactPointerEvent<HTMLButtonElement>, group: (typeof groups)[number]) => {
    e.stopPropagation();
    if (readOnly || !onMove) return;
    e.preventDefault();
    dragRef.current = {
      ids: group.notes.map((n) => n.id),
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    const move = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (!drag.moved && Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY) < 4) return;
      drag.moved = true;
      const point = pagePointFromEvent(ev);
      if (point) onMove(drag.ids, { x: point.x, y: point.y, lang });
    };
    const up = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (drag?.moved) skipClickRef.current = true;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const open = groups.find((g) => g.key === openKey) ?? null;
  const openMeta = open ? metaOf(open.notes[0]) : null;
  const openPos = open ? pagePointToPane({ x: open.x, y: open.y }, panel.rect, offset, zoom) : null;

  return (
    <div className="note-anchor-layer" ref={ref}>
      {groups.map((group) => {
        const pos = pagePointToPane({ x: group.x, y: group.y }, panel.rect, offset, zoom);
        const meta = metaOf(group.notes[0]);
        const label =
          group.notes.length > 1
            ? t('notes.anchorDotCount', { count: String(group.notes.length) })
            : t('notes.anchorDot', { type: meta.name });
        return (
          <button
            type="button"
            key={group.key}
            className={`note-anchor-dot ${openKey === group.key ? 'on' : ''}`}
            style={
              {
                left: `${pos.u * 100}%`,
                top: `${pos.v * 100}%`,
                '--note-color': meta.color,
                cursor: readOnly || !onMove ? 'pointer' : 'grab',
              } as CSSProperties
            }
            title={label}
            aria-label={label}
            aria-expanded={openKey === group.key}
            onPointerDown={(e) => startDrag(e, group)}
            onClick={(e) => {
              // One dot stands for one spot: a second click on it folds the popup away.
              e.stopPropagation();
              if (skipClickRef.current) {
                skipClickRef.current = false;
                return;
              }
              setOpenKey((key) => (key === group.key ? null : group.key));
            }}
          >
            {group.notes.length > 1 && <span className="note-anchor-count">{group.notes.length}</span>}
          </button>
        );
      })}

      {open && openPos && openMeta && (
        <div
          className="note-anchor-pop"
          style={
            {
              left: '50%',
              top: `${openPos.v * 100}%`,
              transform: openPos.v > 0.55 ? 'translate(-50%, calc(-100% - 12px))' : 'translate(-50%, 12px)',
              '--note-color': openMeta.color,
            } as CSSProperties
          }
          role="dialog"
          aria-label={t('notes.anchorPopoverLabel')}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="note-anchor-pop-head">
            <span className="note-anchor-pop-title">
              <i aria-hidden="true" />
              {open.notes.length > 1
                ? t('notes.anchorGroupCount', { count: String(open.notes.length) })
                : openMeta.name}
            </span>
            <span className="note-anchor-pop-lang">{langLabel(lang)}</span>
          </div>
          <ul>
            {open.notes.map((note) => {
              const meta = metaOf(note);
              return (
                <li key={note.id}>
                  <span className="note-anchor-pop-type" style={{ '--type-color': meta.color } as CSSProperties}>
                    <i aria-hidden="true" />
                    {meta.name}
                  </span>
                  <div
                    className="md-body note-anchor-pop-body"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(note.text) }}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
