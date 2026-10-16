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
  id: 80,
  number: 140,
  badge: 120,
  time: 160,
  name: 200,
  text: 320,
  code: 240,
  long: 420,
  handle: 40,
  actions: (labels: number, icons = 0) => (labels + icons) * 100,
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

export {installOverflowScroll} from './overflowScroll';
export function measureTextWidth(text: string, font?: string) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return text.length * 16;
  context.font = font ?? getComputedStyle(document.body).font;
  return context.measureText(text).width;
}
