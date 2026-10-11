import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadingState, QueryErrorAlert, ContentStack } from '@/components/client';
import { useAppStore } from '@/store/app-store';
export function ConfigBoundary({ children }: { children: ReactNode }) {
  const config = useAppStore(s => s.config);
  const error = useAppStore(s => s.configError);
  const load = useAppStore(s => s.loadConfig);
  const { t } = useTranslation();
  const query = {error};
  const failure = error ? <QueryErrorAlert error={query.error} errorTitle={t('errors.configNotLoaded')} retryLabel={t('common.actions.retry')} onRetry={() => void load()} layout={config ? 'banner' : 'block'} /> : null;
  return config ? <ContentStack>{failure}{children}</ContentStack> : failure ?? <LoadingState label={t('common.loading')} />;
}
