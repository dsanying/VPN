import { flushSync } from 'react-dom';
import { LazyLog } from '@melloware/react-logviewer';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
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
  if (follow && visibleText !== text) setVisibleText(text);
  return <div className="ds-log-viewer__stream"
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
      const {scrollTop,scrollHeight,clientHeight} = event.target as HTMLElement;
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
    const body = plainText(presentation.message + (entry.stack ? `\n${entry.stack}` : ''));
    return body.split(/\r?\n/).map((line, index) => prefix + (index ? '  ' : '') + line);
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
