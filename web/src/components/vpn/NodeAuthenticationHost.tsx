import { Button, Form, Image, Input, Select } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DrawerForm, Stack, QueryErrorAlert } from '@/components/client';
import { api } from '@/ipc';
import { useAppStore } from '@/store/app-store';
import { notifyActionFailed } from '@/utils/feedback';
import { type EnterpriseChallenge } from '@shared/enterprise-vpn';
import { useEnterpriseNodes } from '@/store/enterprise-nodes';
export function NodeAuthenticationHost() {
  const { t } = useTranslation();
  const challenge = useEnterpriseNodes(s => s.sessions.find(v => v.challenge)?.challenge);
  const [loadError, setLoadError] = useState<unknown>();
  const [retryTick, setRetryTick] = useState(0);
  useEffect(() => {
    let active = true; let received = false;
    const accept = (snapshot: Awaited<ReturnType<typeof api.enterprise.get>>) => {
      if (active) useEnterpriseNodes.getState().setSessions(snapshot.sessions ?? []);
    };
    const off = api.enterprise.onChanged(snapshot => { received = true; accept(snapshot); });
    void api.enterprise.get().then(snapshot => {
      if (!received) accept(snapshot);
      if (active) setLoadError(undefined);
    }, error => { if (active) setLoadError(error); });
    return () => { active=false; off(); };
  }, [retryTick]);
  return (
    <>
      {loadError ? <QueryErrorAlert error={loadError} errorTitle={t('errors.configNotLoaded')} retryLabel={t('common.actions.retry')} onRetry={() => { setLoadError(undefined); setRetryTick(v => v + 1); }} /> : null}
      {challenge ? <EnterpriseAuthentication key={challenge.id} challenge={challenge} onCancel={() => void api.proxy.stop().then(() => useAppStore.getState().refreshConnectionStatus(), error => notifyActionFailed('disconnect', error))} /> : null}
    </>
  );
}
function EnterpriseAuthentication({
  challenge,
  onCancel,
}: {
  challenge: EnterpriseChallenge;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [points, setPoints] = useState<{ x: number; y: number }[]>([]);
  const [size, setSize] = useState<{ width: number; height: number }>();
  return (
    <DrawerForm<{ fields?: Record<string,string>; code?: string; callbackURL?: string }>
      open
      title={t('vpn.enterprise.authentication')}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      onFinish={async (value) => {
        try {
          await api.enterprise.respond(challenge.id, { ...value, ...size, points });
          return false;
        } catch (e) {
          notifyActionFailed('save', e);
          return false;
        }
      }}
    >
      {challenge.message ? <p role="status">{challenge.message}</p> : null}
      {challenge.image ? (
        <Image
          src={challenge.image}
          alt={t('vpn.enterprise.captcha')}
          preview={false}
          onClick={(event) => {
            if (challenge.kind !== 'click-captcha') return;
            const image = event.target as HTMLImageElement;
            const bounds = image.getBoundingClientRect();
            setSize({ width: image.naturalWidth, height: image.naturalHeight });
            setPoints((old) => [
              ...old,
              {
                x: Math.round(((event.clientX - bounds.left) * image.naturalWidth) / bounds.width),
                y: Math.round(((event.clientY - bounds.top) * image.naturalHeight) / bounds.height),
              },
            ]);
          }}
        />
      ) : null}
      {challenge.kind === 'click-captcha' ? (
        <Stack direction="row" gap="control">
          <span>{t('vpn.enterprise.points', { count: points.length })}</span>
          <Button onClick={() => setPoints([])}>{t('common.actions.reset')}</Button>
        </Stack>
      ) : null}
      {challenge.url ? (
        <Button onClick={() => void api.system.openExternal(challenge.url!)}>
          {t('vpn.enterprise.browserLogin')}
        </Button>
      ) : null}
      {challenge.kind === 'form' ? challenge.fields?.map(field => <Form.Item key={field.name} name={['fields',field.name]} label={field.label} rules={[{required:true}]}>{field.choices ? <Select options={field.choices} /> : field.secret ? <Input.Password autoComplete="off" /> : <Input autoComplete="off" />}</Form.Item>) : challenge.kind === 'external' ? (
        <Form.Item
          name="callbackURL"
          label={t('vpn.enterprise.callback')}
          rules={[{ required: true }, { type: 'url' }]}
        >
          <Input autoComplete="off" />
        </Form.Item>
      ) : challenge.kind !== 'click-captcha' ? (
        <Form.Item name="code" label={t('vpn.enterprise.code')} rules={[{ required: true }]}>
          <Input autoComplete="one-time-code" />
        </Form.Item>
      ) : null}
    </DrawerForm>
  );
}
