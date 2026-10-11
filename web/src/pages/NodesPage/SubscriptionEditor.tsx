import {notifyActionFailed} from '@/utils/feedback';
import { Form, Input } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/ipc';
import type { SubscriptionPreviewResult } from '@shared/subscription-preview';
import { useTranslation } from 'react-i18next';
import { DrawerForm } from '@/components/client';
import type { SourcePreview } from './subscription-mutations';
import type { SubscriptionConfig } from '@shared/types';
export function SubscriptionEditor({ subscription, onClose, save }: { subscription?: SubscriptionConfig; onClose: () => void; save: (values: Omit<SubscriptionConfig, 'id' | 'createdAt'>, original?: SubscriptionConfig, observed?: SourcePreview) => Promise<boolean> }) {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const preview = useRef<SourcePreview | undefined>(undefined);
  const ensurePreview = (source: string) => {
    if (preview.current?.url !== source) preview.current = { url: source, result: api.subscription.preview(source) };
    return preview.current;
  };
  const url = Form.useWatch('url', form);
  const [detection, setDetection] = useState<{ loading: boolean; key?: string; result?: SubscriptionPreviewResult }>({ loading: false });
  const requestKey = JSON.stringify([url]);
  const validUrl = typeof url === 'string' && /^https?:\/\//i.test(url);
  useEffect(() => {
    let current = true;
    if (!validUrl) return;
    const timer = setTimeout(() => {
      setDetection({ loading: true, key: requestKey });
      void ensurePreview(url).result.then(result => {
        if (current) setDetection({ loading: false, key: requestKey, result });
      }, () => { if (current) setDetection({ loading: false, key: requestKey, result: { ok: false, errorKind: 'unknown' } }); });
    }, 600);
    return () => { current = false; clearTimeout(timer); };
  }, [url, requestKey, validUrl]);
  return <DrawerForm<Omit<SubscriptionConfig, 'id' | 'createdAt'>> form={form} open title={t('common.vocab.subscription')} onOpenChange={open => { if (!open) onClose(); }} initialValues={{ ...subscription, name: subscription?.name ?? '', autoUpdate: subscription?.autoUpdate ?? true }} onFinish={async values => {
    try { return await save({...subscription, ...values, autoUpdate: values.autoUpdate ?? subscription?.autoUpdate ?? true}, subscription, !subscription || subscription.url !== values.url ? ensurePreview(values.url) : undefined); } catch (e) { preview.current = undefined; notifyActionFailed('save',e);return false; }
  }}>
    <Form.Item name="name" label={t('common.vocab.name')} rules={[{required:true, whitespace:true}]}><Input allowClear /></Form.Item>
    <Form.Item name="url" label={t('common.vocab.subscriptionUrl')} tooltip={t('vpn.urlHint')} rules={[{required:true},{type:'url'}]}><Input allowClear /></Form.Item>
    <Form.Item label={t('vpn.detectedResult')}><span role="status">{!validUrl ? t('vpn.awaitingSource') : detection.key !== requestKey || detection.loading ? t('vpn.detectingConfiguration') : detection.result?.ok ? detection.result.protocols?.map(item => `${item.protocol.toUpperCase()} × ${item.count}`).join(' · ') : detection.result ? t('vpn.detectionFailed') : t('vpn.awaitingSource')}</span></Form.Item>


  </DrawerForm>;
}
