import { createContext, createElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import type { TablePaginationConfig } from 'antd';
import i18n from '@/i18n';
export interface RouteCrumb {
  path: string;
  title: ReactNode;
  linkable?: boolean;
  object?: boolean;
}
export const RouteCrumbsContext = createContext<RouteCrumb[]>([]);
export const DEFAULT_PAGE_SIZE = 10;
export const columnWidth = {
  id: 96,
  number: 112,
  badge: 120,
  name: 240,
  text: 320,
  code: 260,
  long: 400,
  handle: 40,
  actions: (labels: number, icons = 0) => labels * 112 + icons * 48 + 16,
};
export function buildTablePagination(overrides: TablePaginationConfig = {}): TablePaginationConfig {
  return {
    defaultPageSize: DEFAULT_PAGE_SIZE,
    showSizeChanger: true,
    responsive: true,
    showLessItems: true,
    showTotal: (total) => i18n.t('app.pagination.totalData', { total }),
    pageSizeOptions: [10, 20, 50, 100],
    ...overrides,
  };
}
export const modalDefaults = {
  okButtonProps: { icon: createElement(CheckOutlined, { 'aria-hidden': true }) },
  cancelButtonProps: { icon: createElement(CloseOutlined, { 'aria-hidden': true }) },
};
export function useCopyToClipboard() {
  const { t } = useTranslation();
  const copy = async (value: string) => {
    if (!navigator.clipboard) throw new Error(t('common.requestFailed'));
    await navigator.clipboard.writeText(value);
    return true;
  };
  return { copy };
}

export function installOverflowScroll(root: HTMLElement) {
  let frame = 0;
  const regions = new Set<HTMLElement>();
  const observed = new Set<Element>();
  const measure = () => {
    frame = 0;
    for (const element of observed) {
      if (!element.isConnected) { sizes.unobserve(element); observed.delete(element); }
    }
    for (const region of regions) {
      if (!region.isConnected) { sizes.unobserve(region); regions.delete(region); continue; }
      const horizontal = region.dataset.clientOverflow === 'x';
      if (horizontal) region.style.overflowX = region.scrollWidth > region.clientWidth + 1 ? 'auto' : 'hidden';
    }
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
  const sizes = new ResizeObserver(schedule);
  const observe = (element: Element) => {
    if (!observed.has(element)) { observed.add(element); sizes.observe(element); }
  };
  const discover = (subtree: Element) => {
    const candidates = [...subtree.querySelectorAll<HTMLElement>('[data-client-overflow]')];
    if (subtree instanceof HTMLElement && subtree.matches('[data-client-overflow]')) candidates.push(subtree);
    for (const region of candidates) {
      regions.add(region); observe(region);
      for (const child of region.children) observe(child);
    }
    if (candidates.length) schedule();
  };
  const changes = new MutationObserver(records => {
    for (const record of records) {
      const parent = record.target instanceof Element ? record.target : record.target.parentElement;
      const region = parent?.closest<HTMLElement>('[data-client-overflow]');
      if (region) { for (const child of region.children) observe(child); schedule(); }
      for (const node of record.addedNodes) if (node instanceof Element) discover(node);
      if (record.removedNodes.length && [...observed].some(element => !element.isConnected)) schedule();
    }
  });
  changes.observe(root, { childList: true, subtree: true, characterData: true });
  discover(root);
  const wheel = (event: WheelEvent) => {
    if (!event.shiftKey || event.defaultPrevented || !(event.target instanceof Element)) return;
    const region = event.target.closest<HTMLElement>('[data-client-overflow]');
    if (!region || region.scrollWidth <= region.clientWidth) return;
    const before = region.scrollLeft;
    region.scrollLeft += event.deltaY || event.deltaX;
    if (before !== region.scrollLeft) event.preventDefault();
  };
  root.addEventListener('wheel', wheel, { passive: false });
  return () => { root.removeEventListener('wheel', wheel); changes.disconnect(); sizes.disconnect(); cancelAnimationFrame(frame); };
}
export function measureTextWidth(text: string, font?: string) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return text.length * 16;
  context.font = font ?? getComputedStyle(document.body).font;
  return context.measureText(text).width;
}
