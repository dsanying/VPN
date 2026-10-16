import { ClearOutlined, DownloadOutlined } from '@ant-design/icons';
import { Button, Form } from 'antd';
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AppPage,
  PageStack,
  ResponsiveActions,
  Popconfirm,
  QueryForm,
  QueryErrorAlert,
  FilterSelect,
  SearchInput,
} from '@/components/client';
import { LogViewer } from '@/components/LogViewer';
import { compareText } from '@/utils/collation';
import { api } from '@/ipc';
import { notifyActionFailed, notifyActionSuccess } from '@/utils/feedback';
import type { LogEntry, LogLevel } from '@shared/types';
import {
  mergeLogEntries,
  presentLog,
  logLevelLabel,
  logSourceLabel,
} from '@shared/log-presentation';

export default function LogsPage() {
  const { t, i18n } = useTranslation();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<Error>();
  const [levels, setLevels] = useState<LogLevel[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const buffered = useRef<LogEntry[]>([]);
  const request = useRef(0);
  const fetching = useRef(false);

  const reload = useCallback(async () => {
    const generation = ++request.current;
    fetching.current = true;
    buffered.current = [];
    try {
      const initial = await api.logs.get(2000);
      if (generation !== request.current) return;
      const complete = mergeLogEntries(initial, buffered.current);
      buffered.current = [];
      setLogs(complete);
      setError(undefined);
    } catch (e) {
      if (generation === request.current) {
        setError(e instanceof Error ? e : new Error(String(e)));
        const backlog = buffered.current;
        buffered.current = [];
        setLogs((old) => mergeLogEntries(old, backlog));
      }
    } finally {
      if (generation === request.current) {
        fetching.current = false;
        setLoading(false);
      }
    }
  }, []);
  useEffect(() => {
    const off = api.logs.onReceivedBatch((batch) => {
      if (fetching.current) {
        buffered.current = mergeLogEntries(buffered.current, batch);
      } else setLogs((old) => mergeLogEntries(old, batch));
    });
    void reload();
    const activeRequest = request;
    return () => {
      activeRequest.current++;
      off();
    };
  }, [reload]);

  const language = i18n.resolvedLanguage ?? i18n.language;
  const sourceOptions = useMemo(
    () =>
      [...new Set(logs.map((log) => log.source))]
        .map((value) => ({ value, label: logSourceLabel(value, language) }))
        .sort((a, b) => compareText(a.label, b.label)),
    [logs, language]
  );
  const rows = useMemo(() => {
    const keyword = search.toLocaleLowerCase();
    return logs.filter((log) => {
      if (
        (levels.length && !levels.includes(log.level)) ||
        (sources.length && !sources.includes(log.source))
      )
        return false;
      if (!keyword) return true;
      const display = presentLog(log, language);
      return `${display.message} ${display.source} ${log.message} ${log.source} ${log.stack ?? ''}`
        .toLocaleLowerCase()
        .includes(keyword);
    });
  }, [logs, levels, sources, search, language]);
  return (
    <AppPage
      showBreadcrumb={false}
      extra={
        <ResponsiveActions>
          <Button
            icon={<DownloadOutlined aria-hidden />}
            onClick={async () => {
              try {
                const r = await api.diagnostic.export();
                if (r.success) notifyActionSuccess('export');
                else if (r.error && r.error !== 'cancelled') throw new Error(r.error);
              } catch (e) {
                notifyActionFailed('export', e);
              }
            }}
          >
            {t('common.actions.export')}
          </Button>
          <Popconfirm
            title={t('common.confirm.execute')}
            description={t('vpn.clearLogsImpact')}
            onConfirm={async () => {
              try {
                ++request.current;
                fetching.current = true;
                await api.logs.clear();
                await reload();
                notifyActionSuccess('clear');
              } catch (e) {
                fetching.current = false;
                setLoading(false);
                notifyActionFailed('clear', e);
              }
            }}
          >
            <Button icon={<ClearOutlined aria-hidden />} color="danger" variant="text">
              {t('common.actions.clear')}
            </Button>
          </Popconfirm>
        </ResponsiveActions>
      }
    >
      <PageStack>
        <QueryForm mode="local">
          <Form.Item label={t('common.vocab.search')} data-filter-purpose="keyword">
            <SearchInput
              aria-label={t('common.vocab.search')}
              allowClear
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Form.Item>
          <Form.Item label={t('vpn.logLevel')} data-filter-field="log.level">
            <FilterSelect
              kind="enum"
              aria-label={t('vpn.logLevel')}
              value={levels}
              options={(['debug', 'info', 'warn', 'error', 'fatal'] as const).map((value) => ({
                value,
                label: logLevelLabel(value, language),
              }))}
              onChange={setLevels}
            />
          </Form.Item>
          <Form.Item label={t('common.vocab.source')} data-filter-field="log.source">
            <FilterSelect
              kind="enum"
              aria-label={t('common.vocab.source')}
              value={sources}
              options={sourceOptions}
              onChange={setSources}
            />
          </Form.Item>
        </QueryForm>
        {error ? (
          <QueryErrorAlert
            error={error}
            errorTitle={t('errors.configNotLoaded')}
            onRetry={reload}
            retryLabel={t('common.actions.retry')}
            layout="banner"
          />
        ) : null}
        <LogViewer
          viewKey={JSON.stringify([levels, sources, search])}
          entries={rows}
          search={search}
          loading={loading}
        />
      </PageStack>
    </AppPage>
  );
}
