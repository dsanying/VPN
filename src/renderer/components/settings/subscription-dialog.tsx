import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Loader2, Link as LinkIcon, Edit, Activity } from 'lucide-react';
import type { SubscriptionConfig } from '@/bridge/types';

interface SubscriptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscription?: SubscriptionConfig;
  onSave: (subscription: Omit<SubscriptionConfig, 'id' | 'createdAt'>) => Promise<void>;
}

export function SubscriptionDialog({
  open,
  onOpenChange,
  subscription,
  onSave,
}: SubscriptionDialogProps) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    if (open) {
      if (subscription) {
        setName(subscription.name);
        setUrl(subscription.url);
        setAutoUpdate(subscription.autoUpdate);
      } else {
        setName('');
        setUrl('');
        setAutoUpdate(false);
      }
    }
  }, [open, subscription]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error(t('sub.requireName', '请输入订阅名称'));
      return;
    }
    if (!url.trim()) {
      toast.error(t('sub.requireUrl', '请输入订阅链接'));
      return;
    }

    try {
      setIsSaving(true);
      await onSave({
        name: name.trim(),
        url: url.trim(),
        autoUpdate,
      });
      onOpenChange(false);
    } catch {
      // Error is handled by api wrapper
    } finally {
      setIsSaving(false);
    }
  };

  const isEditing = !!subscription;

  // 格式化流量显示
  const formatBytes = (bytes?: number) => {
    if (bytes === undefined || isNaN(bytes)) return t('sub.unknown', '未知');
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // 格式化日期显示
  const formatDate = (timestamp?: number) => {
    if (!timestamp) return t('sub.unknown', '未知');
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEditing ? <Edit className="h-5 w-5" /> : <LinkIcon className="h-5 w-5" />}
            {isEditing ? t('sub.editTitle', '编辑订阅') : t('sub.addTitle', '添加订阅')}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? t('sub.editDesc', '修改订阅配置信息')
              : t('sub.addDesc', '输入订阅链接以导入服务器节点')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="sub-name">{t('sub.nameLabel', '订阅名称')}</Label>
            <Input
              id="sub-name"
              placeholder={t('sub.namePlaceholder', '例如：我的机场')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sub-url">{t('sub.urlLabel', '订阅链接')}</Label>
            <Input
              id="sub-url"
              placeholder="https://example.com/api/v1/client/subscribe?token=xxx"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>

          {/* 流量和到期信息展示 */}
          {isEditing && subscription?.userInfo && (
            <div className="bg-muted/50 rounded-lg p-3 text-sm flex flex-col gap-1.5 border">
              <div className="flex items-center text-muted-foreground gap-1.5 mb-1">
                <Activity className="h-4 w-4" />
                <span className="font-medium text-foreground">{t('sub.planInfo', '套餐信息')}</span>
              </div>
              <div className="flex justify-between">
                <span>{t('sub.usedTraffic', '已用流量:')}</span>
                <span className="font-medium">
                  {formatBytes(
                    (subscription.userInfo.upload || 0) + (subscription.userInfo.download || 0)
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span>{t('sub.totalTraffic', '总流量:')}</span>
                <span className="font-medium">{formatBytes(subscription.userInfo.total)}</span>
              </div>
              <div className="flex justify-between">
                <span>{t('sub.expireTime', '到期时间:')}</span>
                <span className="font-medium">{formatDate(subscription.userInfo.expire)}</span>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
            <div className="space-y-0.5">
              <Label htmlFor="sub-auto-update">{t('sub.autoUpdate', '自动更新')}</Label>
              <div className="text-[0.8rem] text-muted-foreground">
                {t('sub.autoUpdateDesc', '开启后，FlowZ 启动时会自动尝试更新订阅节点')}
              </div>
            </div>
            <Switch id="sub-auto-update" checked={autoUpdate} onCheckedChange={setAutoUpdate} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t('sub.cancel', '取消')}
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? t('sub.saveChange', '保存修改') : t('sub.addAndUpdate', '添加并更新')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
