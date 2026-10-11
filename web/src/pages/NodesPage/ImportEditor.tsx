import {notifyActionFailed,notifyActionSuccess} from '@/utils/feedback';
import { saveSubscriptionSource } from './subscription-mutations';
import { UploadOutlined } from '@ant-design/icons';
import { Button, Form, Input } from 'antd';
import { useTranslation } from 'react-i18next';
import { DrawerForm } from '@/components/client';
import { api } from '@/ipc';
import { useAppStore } from '@/store/app-store';
export function ImportEditor({ onClose }: { onClose:()=>void }) {
  const { t } = useTranslation(); const [form] = Form.useForm(); return <DrawerForm form={form} open title={t('vpn.importNodes')} onOpenChange={open => { if (!open) onClose(); }} onFinish={async ({ text }) => {
    const added:string[]=[];
    try {
      const result = await api.localImport.parse(text);
      if (!result.nodes.length && !result.subscriptions.length) throw new Error(t('vpn.noNodes'));
      for (const source of result.subscriptions){const subscription=await saveSubscriptionSource(api.subscription,{...source,autoUpdate:true});added.push(subscription.id);}
      if (result.nodes.length) await api.server.addBulk(result.nodes); await useAppStore.getState().loadConfig();notifyActionSuccess('import'); return true;
    } catch(e) { const failures:unknown[]=[];for(const id of [...added].reverse()){try{await api.subscription.delete(id);}catch(cleanupError){failures.push(cleanupError);}}await useAppStore.getState().loadConfig();const failure=failures.length?new AggregateError([e,...failures],`${String(e)}; ${failures.map(String).join('; ')}`):e; notifyActionFailed('import',failure);return false; }
  }}><Button icon={<UploadOutlined aria-hidden/>} onClick={async () => { try { const file = await api.localImport.pickFile(); if (file.content) form.setFieldValue('text',file.content); else if (file.error) throw new Error(file.error); } catch(e){notifyActionFailed('upload',e);} }}>{t('common.actions.upload')}</Button><Form.Item label={t('vpn.importText')} name="text" tooltip={t('vpn.importHint')} rules={[{required:true}]}><Input.TextArea allowClear rows={10} /></Form.Item></DrawerForm>;
}
