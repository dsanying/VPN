/**
 * WebSocket / HTTPUpgrade 传输字段的共享渲染组件（path / Host / gRPC）—— Conduit `.nd-fld` 版。
 *
 * network 下拉本身因各协议 enum 大小写不同（vless/vmess 首字母大写、trojan 小写）
 * 仍留在各表单内联；此处只抽 path / Host / gRPC 三个完全一致的字段。
 * 约定字段名：wsPath?: string，wsHost?: string，grpcServiceName?: string。
 */
import type { Control, FieldValues, FieldPath } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { FormField, FormMessage } from '@/components/ui/form';

type TFn = (key: string, fallback?: any) => string;

export function WsPathField<T extends FieldValues>({
  control,
  t,
}: {
  control: Control<T>;
  t: TFn;
}) {
  return (
    <FormField
      control={control}
      name={'wsPath' as FieldPath<T>}
      render={({ field }) => (
        <div className="nd-fld">
          <span className="nd-fld-lbl">{t('servers.wsPath')}</span>
          <Input placeholder="/path" {...field} />
          <FormMessage className="fld-err" />
        </div>
      )}
    />
  );
}

export function WsHostField<T extends FieldValues>({
  control,
  t,
}: {
  control: Control<T>;
  t: TFn;
}) {
  return (
    <FormField
      control={control}
      name={'wsHost' as FieldPath<T>}
      render={({ field }) => (
        <div className="nd-fld">
          <span className="nd-fld-lbl">{t('servers.wsHost')}</span>
          <Input placeholder="example.com" {...field} />
          <FormMessage className="fld-err" />
        </div>
      )}
    />
  );
}

export function GrpcServiceNameField<T extends FieldValues>({
  control,
  t,
}: {
  control: Control<T>;
  t: TFn;
}) {
  return (
    <FormField
      control={control}
      name={'grpcServiceName' as FieldPath<T>}
      render={({ field }) => (
        <div className="nd-fld">
          <span className="nd-fld-lbl">{t('servers.grpcServiceName')}</span>
          <Input placeholder="GunService" {...field} />
          <FormMessage className="fld-err" />
        </div>
      )}
    />
  );
}
