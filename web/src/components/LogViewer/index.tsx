import { flushSync } from 'react-dom';
import { LazyLog } from '@melloware/react-logviewer';
import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { AppEmpty, LoadingState } from '@/components/client';
import { designTokens } from '@/design/tokens';
import { formatDateTime } from '@/utils/dateTime';
import type { LogEntry, LogLevel } from '@shared/types';
import { logLevelLabel, presentLog } from '@shared/log-presentation';
import './style.css';

export type LogViewerProps = {
  entries: LogEntry[];
  search: string;
  viewKey: string;
  loading: boolean;
};

// Remove terminal control sequences before display: third-party text cannot forge level colors.
function plainText(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 27 && value[index + 1] === '[') {
      index += 2;
      while (index < value.length && (value.charCodeAt(index) < 64 || value.charCodeAt(index) > 126)) index++;
      continue;
    }
    if (code === 9 || code === 10 || code === 13 || code >= 32 && code !== 127) result += value[index];
  }
  return result;
}

// LazyLog resets its virtual list when text changes. Keep the viewed snapshot while
// reading history; new events remain in the page store and appear on returning to the tail.
function FollowingLog({ text, ...props }: ComponentProps<typeof LazyLog>) {
  const [follow, setFollow] = useState(true);
  const [visibleText, setVisibleText] = useState(text);
  const scrollIntent = useRef(false);
  const stream = useRef<HTMLDivElement>(null);
  const lastScrollHeight = useRef(0);
  if (follow && visibleText !== text) setVisibleText(text);
  // LazyLog rebuilds its virtual list from scratch on every text change and its
  // own scroll-to-bottom is skipped while a user scroll is in flight, which left
  // the view stuck at line 0. While following, pin the tail after our commit and
  // for a few frames, covering the rebuild commit that lands right after ours.
  useLayoutEffect(() => {
    if (!follow) return;
    let frames = 0;
    let raf = 0;
    const pin = () => {
      const viewport = stream.current?.querySelector('.react-lazylog');
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
      if (++frames < 6) raf = requestAnimationFrame(pin);
    };
    pin();
    return () => cancelAnimationFrame(raf);
  }, [follow, visibleText]);
  return <div ref={stream} className="ds-log-viewer__stream"
    onWheelCapture={event => {
      scrollIntent.current = event.deltaY > 0;

      if (event.deltaY < 0 && follow) {
        // Disable the tail effect before the browser performs this user scroll.
        flushSync(() => setFollow(false));
      }
      else if (event.deltaY > 0) {
        // A wheel at the tail may produce no scroll event (the list is already there).
        const viewport = event.currentTarget.querySelector('.react-lazylog');
        if (viewport && viewport.scrollTop >= viewport.scrollHeight - viewport.clientHeight - 1) {
          scrollIntent.current = false;
          setFollow(true);
        }
      }
    }}
    onPointerDownCapture={() => { scrollIntent.current = true; }}
    onPointerUpCapture={() => { scrollIntent.current = false; }}
    onKeyDownCapture={event => {
      if (['Home', 'PageUp', 'ArrowUp'].includes(event.key)) {
        scrollIntent.current = false;
        setFollow(false);
      } else if (['End', 'PageDown', 'ArrowDown'].includes(event.key)) scrollIntent.current = true;
    }}
    onScrollCapture={event => {
      const target = event.target as HTMLElement;
      const {scrollTop,scrollHeight,clientHeight} = target;
      // A rebuild of the virtualized list shrinks scrollHeight and emits scroll
      // events — that is not a user scroll, so it must not toggle following.
      if (scrollHeight < lastScrollHeight.current - 1) {
        lastScrollHeight.current = scrollHeight;
        return;
      }
      lastScrollHeight.current = scrollHeight;
      // Transient list resets are not a user decision to resume following.
      if (!scrollIntent.current || scrollHeight <= clientHeight) return;
      const atBottom = scrollTop >= scrollHeight - clientHeight - 1;

      if (atBottom) scrollIntent.current = false;
      setFollow(atBottom);
    }}>
    <LazyLog {...props} text={visibleText} follow={follow}/>
  </div>;
}

export function LogViewer({ entries, search, viewKey, loading }: LogViewerProps) {
  const { t, i18n } = useTranslation();
  const container = useRef<HTMLElement>(null);
  const [height, setHeight] = useState<number>(designTokens.layout.scrollRegionMaxHeight);
  useEffect(() => {
    if (!container.current) return;
    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setHeight(Math.max(1, Math.round(entry.contentRect.height))));
    });
    observer.observe(container.current);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  const language = i18n.resolvedLanguage ?? i18n.language;
  const text = entries.flatMap(entry => {
    const presentation = presentLog(entry, language);
    const prefix = `[${entry.level.toUpperCase()}] ${formatDateTime(entry.timestamp)} [${presentation.source}] `;
    // 折叠计数：同键日志合并为一条关键信息，×N 表示窗口内实际发生了 N 次（磁盘逐条落盘不减）。
    const count = entry.repeatCount && entry.repeatCount > 1 ? ` ×${entry.repeatCount}` : '';
    const body = plainText(presentation.message + (entry.stack ? `\n${entry.stack}` : ''));
    return body.split(/\r?\n/).map((line, index) => prefix + (index ? '  ' : '') + line + (index ? '' : count));
  }).join('\n');
  const formatPart = (part: string) => {
    const level = /^\[(DEBUG|INFO|WARN|ERROR|FATAL)\]/.exec(part)?.[1]?.toLowerCase() as LogLevel | undefined;
    const body = level ? part.replace(/^\[\w+\]/, `[${logLevelLabel(level, language)}]`) : part;
    const keyword = search.toLocaleLowerCase();
    const pieces = [];
    let cursor = 0;
    let match = keyword ? body.toLocaleLowerCase().indexOf(keyword) : -1;
    while (match >= 0) {
      pieces.push(body.slice(cursor, match), <mark key={match}>{body.slice(match, match + keyword.length)}</mark>);
      cursor = match + keyword.length;
      match = body.toLocaleLowerCase().indexOf(keyword, cursor);
    }
    pieces.push(body.slice(cursor));
    return <span data-log-level={level} className={`ds-log-viewer__level ds-log-viewer__level--${level ?? 'info'}`}>{pieces}</span>;
  };
  return <section ref={container} className="ds-log-viewer" aria-label={t('vpn.logs.viewer')} tabIndex={0}>
    {loading && !entries.length ? <LoadingState label={t('common.actions.reload')} /> : !entries.length ? <AppEmpty /> :
      <FollowingLog key={JSON.stringify([language, viewKey])} height={height} text={text} wrapLines selectableLines enableLineNumbers={false}
        enableSearch={false} enableLinks={false} extraLines={0} overscanRowCount={12}
        rowHeight={designTokens.control.heightSm} formatPart={formatPart}
        style={{ background: 'var(--ds-color-surface)', color: 'var(--ds-color-text)', fontFamily: designTokens.font.mono, fontSize: designTokens.font.sizeXs }}
 />}
  </section>;
}
