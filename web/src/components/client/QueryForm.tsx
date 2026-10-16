import { Button, Form, Select, type FormProps, type SelectProps } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import './query.css';
import {AtomicValue} from './components';

/** In-memory/live collections filter locally; remote lists submit one snapshot. */
export function QueryForm({
  mode,
  children,
  ...props
}: FormProps & { mode: 'local' | 'remote'; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Form
      {...props}
      layout="inline"
      className={`client-query ${props.className ?? ''}`}
      data-query-mode={mode}
    >
      {children}
      {mode === 'remote' ? (
        <Form.Item>
          <Button type="primary" htmlType="submit" icon={<SearchOutlined aria-hidden />}>
            {t('common.actions.query')}
          </Button>
        </Form.Item>
      ) : null}
    </Form>
  );
}
type Value = string | number;
type FilterProps<T extends Value> =
  | (Omit<SelectProps<T[]>, 'mode' | 'allowClear'> & { kind: 'enum' })
  | (Omit<SelectProps<T>, 'mode' | 'allowClear'> & { kind: 'pair' | 'scope' });
/** Field semantics determine cardinality; option count never determines it. */
export function FilterSelect<T extends Value>(props: FilterProps<T>) {
  const shared = {
    className: `client-filter-select ${props.className ?? ''}`,
    showSearch: {
      optionFilterProp: 'label',
      filterOption: (input: string, option?: { searchText?: unknown; label?: ReactNode }) =>
        String(option?.searchText ?? option?.label ?? '')
          .toLocaleLowerCase()
          .includes(input.toLocaleLowerCase()),
    },
    classNames: { popup: { root: 'client-filter-popup' } },
    optionRender: props.optionRender ?? (option=> <AtomicValue text={option.label}/>),
  };
  if (props.kind === 'enum') {
    const { kind: _kind, ...rest } = props;
    return <Select<T[]> {...rest} {...shared} mode="multiple" allowClear />;
  }
  const { kind, ...rest } = props;
  return <Select<T> {...rest} {...shared} allowClear={kind !== 'scope'} />;
}
