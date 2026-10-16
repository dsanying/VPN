import { createRoot } from 'react-dom/client';
import { StrictMode, useState } from 'react';
import { App, Button, ConfigProvider, Form, Input } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useThemeStore } from '../../src/stores/useThemeStore';
import { buildThemeConfig } from '../../src/config/theme';
import {
  DrawerForm,
  FieldLabel,
  MultiSelect,
  SummaryStrip,
  Table,
  ViewSwitch,
} from '../../src/components/client';
import i18n from '../../src/i18n';
import '../../src/design/tokens.css';
import '../../src/global.css';
import '../../src/components/client/client.css';

function Fixture() {
  const mode = useThemeStore((state) => state.mode);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('original');
  const [accept, setAccept] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [rows, setRows] = useState(
    Array.from({ length: 31 }, (_, index) => ({
      id: String(index + 1),
      name: `record-${index + 1}`,
    }))
  );
  const [lastMove, setLastMove] = useState('');
  const [route, setRoute] = useState('direct');
  return (
    <ConfigProvider
      button={{ autoInsertSpace: false }}
      locale={'default' in zhCN ? zhCN.default : zhCN}
      theme={buildThemeConfig(mode)}
    >
      <App>
        <main className="client-page">
          <h1>Client contract</h1>
          <SummaryStrip
            label="summary"
            items={[
              { key: 'region', label: '地区', value: '中国' },
              { key: 'route', label: '分流', value: route },
            ]}
          />
          <ViewSwitch
            aria-label="routing"
            value={route}
            onChange={setRoute}
            options={[
              { value: 'direct', label: '直连' },
              { value: 'proxy', label: '代理' },
            ]}
          />
          <MultiSelect
            label="filters"
            allowClear
            value={selected}
            onChange={setSelected}
            options={[
              { value: 'a', label: '警告' },
              { value: 'b', label: '错误' },
              { value: 'c', label: '长名称'.repeat(30) },
            ]}
          />
          <output aria-label="selected filters">{selected.join(',')}</output>
          <Button onClick={() => setOpen(true)}>编辑</Button>
          <Button onClick={() => setAccept((value) => !value)}>允许保存</Button>
          <output aria-label="saved value">{name}</output>
          <output aria-label="move indices">{lastMove}</output>
          <Table
            rowKey="id"
            order="given"
            dataSource={rows}
            columns={[{ title: '名称', dataIndex: 'name', key: 'name' }]}
            sortable={{
              handleLabel: '调整顺序',
              onMove: async (record, from, to) => {
                setLastMove(`${record.id}:${from}:${to}`);
                setRows((previous) => {
                  const next = [...previous];
                  next.splice(to, 0, next.splice(from, 1)[0]);
                  return next;
                });
              },
            }}
          />
          <DrawerForm<{ name: string }>
            title="编辑记录"
            open={open}
            initialValues={{ name }}
            onOpenChange={setOpen}
            onFinish={async (values) => {
              if (!accept) return false;
              setName(values.name);
              return true;
            }}
          >
            <Form.Item
              name="name"
              label={<FieldLabel label="名称" help="此名称会保存在当前记录中。" />}
              rules={[{ required: true, message: '请输入名称' }]}
            >
              <Input aria-label="名称" />
            </Form.Item>
          </DrawerForm>
        </main>
      </App>
    </ConfigProvider>
  );
}
useThemeStore
  .getState()
  .setPreference(new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light');
void i18n.changeLanguage('zh-CN');
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
