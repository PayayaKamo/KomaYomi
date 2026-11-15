import { useEffect, useRef } from 'react';
import type { Lang, PageEntry } from '../types';
import { langShort } from '../types';
import { useI18n } from '../i18n';

type Props = {
  /** Every page of the open chapter; excluded pages are skipped. */
  pages: PageEntry[];
  /** Preferred languages, in order; the first one that has an image wins. */
  langs: Lang[];
  /** Index of the page that the rest of the app considers current. */
  current: number;
  onPick: (index: number) => void;
};

/**
 * Webtoon-style reader: all pages of the chapter stacked in one continuous scroll.
 * Whichever page crosses the middle of the viewport becomes the current page, so the
 * breadcrumb, notes panel and deep link stay in sync while scrolling.
 */
export function ScrollTab({ pages, langs, current, onPick }: Props) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<number, HTMLElement>());
  /** Page last reported to the app; -1 until the first scroll/jump settles it. */
  const active = useRef(-1);
  /** Page an external jump is heading to; re-aligned as eager images change the layout. */
  const pendingJump = useRef<number | null>(null);
  const visible = pages.filter((page) => !page.excluded);
  const chapterKey = `${pages[0]?.index ?? ''}:${visible.length}:${visible[0]?.files ? Object.keys(visible[0].files).join(',') : ''}`;

  /** Scroll so the given page's top sits at the top of the reader. */
  const alignTo = (index: number) => {
    const root = rootRef.current;
    const node = nodes.current.get(index);
    if (!root || !node) return;
    root.scrollTop += node.getBoundingClientRect().top - root.getBoundingClientRect().top;
  };

  const picture = (page: PageEntry) => {
    for (const lang of langs) {
      const url = page.files[lang];
      if (url) return { url, lang };
    }
    const first = Object.entries(page.files).find(([, url]) => url);
    return first ? { url: first[1] as string, lang: first[0] as Lang } : null;
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !visible.length) return;
    let frame = 0;
    const pick = () => {
      frame = 0;
      const box = root.getBoundingClientRect();
      const mid = box.top + box.height / 2;
      let best = -1;
      let bestDistance = Infinity;
      for (const [index, node] of nodes.current) {
        const rect = node.getBoundingClientRect();
        const distance = mid < rect.top ? rect.top - mid : mid > rect.bottom ? mid - rect.bottom : 0;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      }
      if (best >= 0 && best !== active.current) {
        // Any scroll that lands somewhere else means the user took over from the jump.
        if (pendingJump.current !== null && best !== pendingJump.current) pendingJump.current = null;
        active.current = best;
        onPick(best);
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(pick);
    };
    // Images load eagerly and change page heights; keep re-aligning a jump until they settle.
    const onLoad = () => {
      const target = pendingJump.current;
      if (target === null) return;
      alignTo(target);
      const done = [...root.querySelectorAll('img')].every((img) => img.complete);
      if (done) pendingJump.current = null;
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    root.addEventListener('load', onLoad, true);
    return () => {
      root.removeEventListener('scroll', onScroll);
      root.removeEventListener('load', onLoad, true);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [chapterKey, onPick, visible.length]);

  // External jumps (arrow keys, breadcrumb, deep link) scroll the matching page into view.
  useEffect(() => {
    if (current === active.current) return;
    active.current = current;
    pendingJump.current = current;
    alignTo(current);
  }, [current]);

  return (
    <div className="scroll-tab" ref={rootRef}>
      {visible.map((page) => {
        const pic = picture(page);
        return (
          <figure
            key={page.index}
            data-index={page.index}
            className={`scroll-page ${page.index === current ? 'current' : ''}`}
            ref={(node) => {
              if (node) nodes.current.set(page.index, node);
              else nodes.current.delete(page.index);
            }}
            onClick={() => {
              pendingJump.current = null;
              active.current = page.index;
              onPick(page.index);
            }}
          >
            <span className="scroll-tag">
              #{page.index + 1}
              {pic && langs.length > 1 ? ` · ${langShort(pic.lang)}` : ''}
            </span>
            {pic ? (
              // Eager on purpose: page heights must be known for the scroll position
              // and the mid-viewport page tracking to stay stable.
              <img src={pic.url} alt="" decoding="async" draggable={false} />
            ) : (
              <div className="scroll-empty">{t('scroll.noImage')}</div>
            )}
          </figure>
        );
      })}
      {!visible.length && <div className="stage-loading">{t('app.noContent')}</div>}
    </div>
  );
}
