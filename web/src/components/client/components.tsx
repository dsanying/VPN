import {
  Alert,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Menu,
  Popconfirm as AntPopconfirm,
  Segmented,
  Select,
  Spin,
  Table as AntTable,
  Tag,
  Tooltip,
  type ButtonProps,
  type FormInstance,
  type InputProps,
  type MenuProps,
  type PopconfirmProps,
  type SegmentedProps,
  type SelectProps,
  type TableProps,
} from 'antd';
import {
  ArrowLeftOutlined,
  CheckOutlined,
  CloseOutlined,
  HolderOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  SaveOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import {
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type Key,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { RouteCrumbsContext, buildTablePagination } from './utilities';
import './client.css';

type ContainerProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & { children?: ReactNode };
export function Stack({
  direction = 'row',
  gap = 'control',
  align,
  wrap,
  style,
  ...props
}: ContainerProps & {
  direction?: 'row' | 'column';
  gap?: 'tight' | 'control' | 'block' | 'page' | number;
  align?: CSSProperties['alignItems'];
  wrap?: boolean;
}) {
  const spaces = { tight: 4, control: 8, block: 16, page: 24 };
  return (
    <div
      {...props}
      style={{
        display: 'flex',
        minWidth: 0,
        flexDirection: direction,
        gap: typeof gap === 'number' ? gap : spaces[gap],
        alignItems: align,
        flexWrap: wrap ? 'wrap' : undefined,
        ...style,
      }}
    />
  );
}
export const ContentStack = ({ className = '', ...props }: ContainerProps) => (
  <Stack
    {...props}
    className={`client-content-stack ${className}`}
    direction="column"
    gap="block"
  />
);
export const PageStack = ({ className = '', ...props }: ContainerProps) => (
  <Stack {...props} className={`client-page-stack ${className}`} direction="column" gap="page" />
);
export function ResponsiveActions({
  justify = 'end',
  ...props
}: ContainerProps & { justify?: 'start' | 'end' }) {
  return (
    <Stack
      {...props}
      wrap
      align="center"
      style={{ justifyContent: justify === 'start' ? 'flex-start' : 'flex-end', ...props.style }}
    />
  );
}
export function HelpTip({ title, children }: { title: ReactNode; children?: ReactNode }) {
  const { t } = useTranslation();
  if (children !== undefined)
    return (
      <Tooltip
        title={title}
        destroyOnHidden
        trigger={['hover', 'focus', 'click']}
        classNames={{ root: 'client-help-popup' }}
        align={{ overflow: { adjustX: true, adjustY: true, shiftX: true } }}
      >
        <span tabIndex={0}>{children}</span>
      </Tooltip>
    );
  return (
    <Tooltip
      title={title}
      destroyOnHidden
      trigger={['hover', 'focus', 'click']}
      classNames={{ root: 'client-help-popup' }}
      align={{ overflow: { adjustX: true, adjustY: true, shiftX: true } }}
    >
      <button
        type="button"
        className="client-help ds-help-tip"
        aria-label={t('common.vocab.description')}
        onClick={(event) => event.stopPropagation()}
      >
        <QuestionCircleOutlined aria-hidden />
      </button>
    </Tooltip>
  );
}
/** Field help uses the same focusable/touchable trigger as non-form headings. */
export function FieldLabel({ label, help }: { label: ReactNode; help: ReactNode }) {
  return (
    <span className="client-field-label">
      {label}
      <HelpTip title={help} />
    </span>
  );
}
export function SectionHeader({ title, extra }: { title: ReactNode; extra?: ReactNode }) {
  return (
    <header className="client-section-header">
      <h2>{title}</h2>
      {extra}
    </header>
  );
}
export function AppPage({
  children,
  extra,
  onBack,
  className = '',
  scrollMode,
}: ContainerProps & {
  extra?: ReactNode;
  onBack?: () => void;
  scrollMode?: string;
  showBreadcrumb?: boolean;
}) {
  const crumbs = useContext(RouteCrumbsContext);
  const { t } = useTranslation();
  return (
    <section
      data-scroll-mode={scrollMode}
      className={`ds-app-page client-page ${scrollMode === 'contained' ? 'client-page-contained' : ''} ${className}`}
    >
      <header className="client-page-header">
        <div>
          {onBack ? (
            <Button
              type="text"
              icon={<ArrowLeftOutlined aria-hidden />}
              aria-label={t('common.actions.back')}
              onClick={onBack}
            />
          ) : null}
          <h1>{crumbs.at(-1)?.title}</h1>
        </div>
        {extra}
      </header>
      <div className="client-page-content">{children}</div>
    </section>
  );
}
export function FormGrid({
  children,
  columns = 2,
}: {
  children: ReactNode;
  columns?: number;
  field?: string;
}) {
  return (
    <div className="client-form-grid" style={{ '--client-columns': columns } as CSSProperties}>
      {children}
    </div>
  );
}
export function AtomicValue({
  text,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { text?: ReactNode }) {
  return (
    <span {...props} className={`client-atomic ${props.className ?? ''}`}>
      {children ?? text}
    </span>
  );
}
export function MetadataTag({ children }: { children?: ReactNode }) {
  return <Tag>{children}</Tag>;
}
export function StatusTag({
  tone,
  children,
}: {
  tone: 'success' | 'error' | 'warning' | 'neutral' | 'info';
  children?: ReactNode;
}) {
  return (
    <Tag color={tone === 'neutral' ? undefined : tone === 'info' ? 'processing' : tone}>
      {children}
    </Tag>
  );
}
export function IconButton({ label, ...props }: ButtonProps & { label: string }) {
  const [hintOpen, setHintOpen] = useState(false);
  return (
    <Tooltip title={label} open={hintOpen} onOpenChange={setHintOpen} classNames={{ root: 'client-action-hint' }}>
      <Button
        {...props}
        aria-label={label}
        onClick={(event) => {
          setHintOpen(false);
          props.onClick?.(event);
        }}
      />
    </Tooltip>
  );
}
export function SearchInput({ hint, ...props }: InputProps & { hint?: ReactNode }) {
  return (
    <Input
      type="search"
      {...props}
      prefix={<SearchOutlined aria-hidden />}
      suffix={hint ? <HelpTip title={hint} /> : props.suffix}
    />
  );
}
export function MultiSelect<T extends string = string>({
  freeInput,
  label,
  ...props
}: SelectProps<T[]> & { freeInput?: boolean; label?: string }) {
  return (
    <Select
      showSearch={freeInput === true}
      {...props}
      mode={freeInput ? 'tags' : 'multiple'}
      aria-label={label ?? props['aria-label']}
    />
  );
}
export function ViewSwitch<T extends string | number>(props: SegmentedProps<T>) {
  return <Segmented {...props} />;
}
export function ScrollRegion({
  axis = 'both',
  label,
  style,
  ...props
}: ContainerProps & { axis?: 'x' | 'y' | 'both'; label?: string }) {
  return (
    <div
      {...props}
      data-client-overflow
      role="region"
      aria-label={label}
      tabIndex={0}
      style={{
        overflowX: axis === 'y' ? 'hidden' : 'auto',
        overflowY: axis === 'x' ? 'hidden' : 'auto',
        minWidth: 0,
        ...style,
      }}
    />
  );
}
export function InlineList<T extends { key: Key; text?: ReactNode }>({
  items,
  label,
  renderItem,
}: {
  items: T[];
  label?: string;
  renderItem?: (item: T) => ReactNode;
}) {
  return (
    <span className="client-inline-list" aria-label={label}>
      {items.map((item) => (
        <span key={item.key}>{renderItem ? renderItem(item) : item.text}</span>
      ))}
    </span>
  );
}
export function AppEmpty() {
  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />;
}
export function LoadingState({ label }: { label?: string; variant?: string }) {
  return (
    <div role="status" className="client-loading">
      <Spin />
      {label}
    </div>
  );
}
export function QueryErrorAlert({
  error,
  errorTitle,
  onRetry,
  retryLabel,
}: {
  error: unknown;
  errorTitle?: string;
  onRetry?: () => void;
  retryLabel?: string;
  layout?: string;
}) {
  return (
    <Alert
      type="error"
      showIcon
      title={errorTitle}
      description={error instanceof Error ? error.message : String(error ?? '')}
      action={
        onRetry ? (
          <Button icon={<ReloadOutlined aria-hidden />} onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : undefined
      }
    />
  );
}
export function Popconfirm(props: PopconfirmProps) {
  return (
    <AntPopconfirm
      {...props}
      okButtonProps={{ icon: <CheckOutlined aria-hidden />, ...props.okButtonProps }}
      cancelButtonProps={{ icon: <CloseOutlined aria-hidden />, ...props.cancelButtonProps }}
    />
  );
}
export interface InformationField {
  key: Key;
  label: ReactNode;
  value: ReactNode;
}
export function InformationFieldGrid({
  items,
}: {
  items: InformationField[];
  compact?: boolean;
  fit?: string;
}) {
  return (
    <dl className="client-information-grid">
      {items.map((item) => (
        <div key={item.key}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
export function SummaryStrip({
  items,
  label,
}: {
  items: InformationField[];
  label?: string;
  compact?: boolean;
}) {
  return (
    <div className="client-summary ds-summary-strip" role="group" aria-label={label}>
      {items.map((item) => (
        <div key={item.key} className="ds-summary-strip__item">
          <span>{item.label}</span>
          <span className="ds-summary-strip__value">{item.value}</span>
        </div>
      ))}
    </div>
  );
}
export function TablePanel({
  children,
  title,
  extra,
  query,
}: ContainerProps & {
  title?: ReactNode;
  extra?: ReactNode;
  embedded?: boolean;
  query?: ReactNode;
}) {
  return (
    <section className="client-table-panel">
      {title || extra ? <SectionHeader title={title} extra={extra} /> : null}
      {query}
      {children}
    </section>
  );
}
export function Table<T extends object>({
  sortable,
  order: _order,
  columns,
  onRow,
  ...props
}: TableProps<T> & {
  order?: string;
  sortable?: {
    handleLabel: string;
    onMove: (record: T, from: number, to: number) => Promise<void> | void;
  };
}) {
  const moving = useRef(false);
  const source = useRef<number | undefined>(undefined);
  const rows = props.dataSource ?? [];
  const move = async (from: number, to: number) => {
    if (!sortable || moving.current || from === to || to < 0 || to >= rows.length) return;
    moving.current = true;
    try {
      await sortable.onMove(rows[from], from, to);
    } finally {
      moving.current = false;
    }
  };
  const handle = sortable
    ? [
        {
          key: 'client-drag',
          width: 40,
          render: (_: unknown, record: T) => {
            const index = rows.indexOf(record);
            return (
              <Button
                type="text"
                icon={<HolderOutlined aria-hidden />}
                aria-label={sortable.handleLabel}
                style={{ touchAction: 'none' }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                    event.preventDefault();
                    void move(index, index + (event.key === 'ArrowUp' ? -1 : 1));
                  }
                }}
                onPointerDown={(event) => {
                  source.current = index;
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerCancel={() => {
                  source.current = undefined;
                }}
                onPointerUp={(event) => {
                  const from = source.current;
                  source.current = undefined;
                  const row = document
                    .elementFromPoint(event.clientX, event.clientY)
                    ?.closest('[data-client-row]');
                  const to = Number(row?.getAttribute('data-client-row'));
                  if (from !== undefined && row) void move(from, to);
                }}
              />
            );
          },
        },
      ]
    : [];
  return (
    <AntTable<T>
      {...props}
      pagination={props.pagination === false ? false : buildTablePagination(props.pagination)}
      columns={[...handle, ...(columns ?? [])]}
      scroll={{ x: 'max-content', ...props.scroll }}
      onRow={(record, index) => ({
        ...onRow?.(record, index),
        'data-client-row': rows.indexOf(record),
        ...(sortable
          ? {
              tabIndex: 0,
              onKeyDown: (event: React.KeyboardEvent<HTMLTableRowElement>) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === ' ' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                  event.preventDefault();
                  if (event.key === ' ')
                    source.current =
                      source.current === undefined ? rows.indexOf(record) : undefined;
                  else if (source.current !== undefined) {
                    const index = rows.indexOf(record);
                    void move(index, index + (event.key === 'ArrowUp' ? -1 : 1));
                  }
                }
              },
            }
          : {}),
      })}
    />
  );
}
export function DrawerForm<T extends object>({
  form: provided,
  children,
  title,
  open,
  onOpenChange,
  initialValues,
  onFinish,
  submitter = true,
}: {
  form?: FormInstance<T>;
  children?: ReactNode;
  title?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialValues?: Partial<T>;
  onFinish?: (values: T) => Promise<boolean | void>;
  submitter?: boolean;
}) {
  const [local] = Form.useForm<T>();
  const form = provided ?? local;
  const [busy, setBusy] = useState(false);
  const { t } = useTranslation();
  const initial = useRef(initialValues);
  useEffect(() => { initial.current = initialValues; }, [initialValues]);
  useEffect(() => {
    if (open) {
      form.resetFields();
      if (initial.current)
        form.setFieldsValue(initial.current as Parameters<FormInstance<T>['setFieldsValue']>[0]);
    }
  }, [open, form]);
  const close = () => {
    if (!busy) onOpenChange?.(false);
  };
  return (
    <Drawer
      title={title}
      open={open}
      onClose={close}
      maskClosable={!busy}
      keyboard={!busy}
      size={Math.min(560, typeof window === 'undefined' ? 560 : window.innerWidth)}
      destroyOnHidden
      footer={
        submitter ? (
          <ResponsiveActions>
            <Button disabled={busy} icon={<CloseOutlined aria-hidden />} onClick={close}>
              {t('common.actions.cancel')}
            </Button>
            <Button
              type="primary"
              loading={busy}
              icon={<SaveOutlined aria-hidden />}
              onClick={() => form.submit()}
            >
              {t('common.actions.save')}
            </Button>
          </ResponsiveActions>
        ) : undefined
      }
    >
      <Form<T>
        form={form}
        layout="vertical"
        initialValues={initialValues}
        onFinish={async (values) => {
          setBusy(true);
          try {
            if ((await onFinish?.(values)) !== false) onOpenChange?.(false);
          } finally {
            setBusy(false);
          }
        }}
      >
        {children}
      </Form>
    </Drawer>
  );
}
export function SidebarMenu({
  compact,
  className = '',
  ...props
}: MenuProps & { compact?: boolean }) {
  return (
    <Menu
      {...props}
      className={`ds-sidebar-menu ${className}`}
      mode="inline"
      inlineCollapsed={compact ?? props.inlineCollapsed}
    />
  );
}
