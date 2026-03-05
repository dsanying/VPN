import { useState } from 'react';
import { toast } from 'sonner';
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
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Link, Server } from 'lucide-react';
import { parseProtocolUrl, addServerFromUrl } from '@/bridge/api-wrapper';
import type { ServerConfig } from '@/bridge/types';
import { useTranslation } from 'react-i18next';

interface ImportUrlDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportSuccess?: () => void;
}

export function ImportUrlDialog({ open, onOpenChange, onImportSuccess }: ImportUrlDialogProps) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [parsedConfig, setParsedConfig] = useState<ServerConfig | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const { t } = useTranslation();

  const handleParseUrl = async () => {
    if (!url.trim()) {
      toast.error('请输入协议URL');
      return;
    }

    setIsParsing(true);
    try {
      const response = await parseProtocolUrl(url.trim());
      if (response && response.success && response.data) {
        setParsedConfig(response.data as any);

        // 自动生成服务器名称
        if (!name.trim()) {
          const protocol = response.data.protocol.toUpperCase();
          const address = response.data.address;
          setName(`${protocol} - ${address}`);
        }

        toast.success(t('servers.parseUrlSuccess', 'URL解析成功'));
      } else {
        toast.error(response?.error || t('servers.parseUrlFailed', 'URL解析失败'));
        setParsedConfig(null);
      }
    } catch (error) {
      console.error('Parse URL error:', error);
      toast.error(t('servers.parseUrlFailed', 'URL解析失败'));
      setParsedConfig(null);
    } finally {
      setIsParsing(false);
    }
  };

  const handleImport = async () => {
    if (!parsedConfig || !name.trim()) {
      toast.error(t('servers.errorImportPrerequisite', '请先解析URL并输入服务器名称'));
      return;
    }

    setIsImporting(true);
    try {
      const response = await addServerFromUrl(url.trim(), name.trim());
      if (response && response.success) {
        onImportSuccess?.();
        handleClose();
      } else {
        toast.error(response?.error || t('servers.importFailed', '导入服务器失败'));
      }
    } catch (error) {
      console.error('Import server error:', error);
      toast.error(t('servers.importFailed', '导入服务器失败'));
    } finally {
      setIsImporting(false);
    }
  };

  const handleClose = () => {
    setUrl('');
    setName('');
    setParsedConfig(null);
    onOpenChange(false);
  };

  const isValidUrl = (url: string) => {
    return (
      url.startsWith('vless://') ||
      url.startsWith('trojan://') ||
      url.startsWith('hysteria2://') ||
      url.startsWith('hy2://') ||
      url.startsWith('ss://') ||
      url.startsWith('anytls://')
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link className="h-5 w-5" />
            {t('servers.importFromUrl', '从URL导入')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'servers.importUrlDesc',
              '支持导入 vless://、trojan://、hysteria2://、hy2://、ss:// 和 anytls:// 协议链接'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* URL输入 */}
          <div className="space-y-2">
            <Label htmlFor="protocol-url">{t('servers.protocolUrl', '协议URL')}</Label>
            <div className="flex gap-2">
              <Textarea
                id="protocol-url"
                placeholder={t(
                  'servers.protocolUrlPlaceholder',
                  'vless://uuid@server:port?encryption=none&security=tls&type=ws&host=example.com&path=/path#name\n或 trojan://password@server:port?security=tls&type=ws#name\n或 hysteria2://password@server:port?sni=example.com#name\n或 ss://base64(method:password)@server:port#name\n或 anytls://password@server:port?security=tls&sni=example.com#name'
                )}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="min-h-[80px] resize-none"
              />
              <Button
                onClick={handleParseUrl}
                disabled={!url.trim() || !isValidUrl(url.trim()) || isParsing}
                className="shrink-0"
              >
                {isParsing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t('servers.parseBtn', '解析')
                )}
              </Button>
            </div>
            {url.trim() && !isValidUrl(url.trim()) && (
              <p className="text-sm text-destructive">
                {t(
                  'servers.invalidUrlFormat',
                  '请输入有效的 vless://、trojan://、hysteria2://、hy2://、ss:// 或 anytls:// 协议链接'
                )}
              </p>
            )}
          </div>

          {/* 解析结果 */}
          {parsedConfig && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Server className="h-4 w-4" />
                  {t('servers.parseResult', '解析结果')}
                </CardTitle>
                <CardDescription>
                  {t('servers.parseResultDesc', 'URL解析成功，请确认配置信息')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">{t('servers.protocol', '协议')}:</span>
                    <Badge variant="outline" className="ml-2">
                      {parsedConfig.protocol}
                    </Badge>
                  </div>
                  <div className="flex flex-col md:flex-row md:items-baseline relative pr-2">
                    <span className="text-muted-foreground whitespace-nowrap">
                      {t('servers.address', '地址')}:
                    </span>
                    <span className="md:ml-2 font-mono break-all line-clamp-2 md:line-clamp-none">
                      {parsedConfig.address.includes(':')
                        ? `[${parsedConfig.address}]`
                        : parsedConfig.address}
                      :{parsedConfig.port}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t('servers.transport', '传输')}:</span>
                    <span className="ml-2">{parsedConfig.network}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">
                      {t('servers.encryption', '加密')}:
                    </span>
                    <span className="ml-2">{parsedConfig.security}</span>
                  </div>
                  {parsedConfig.protocol === 'vless' && parsedConfig.uuid && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">UUID:</span>
                      <span className="ml-2 font-mono text-xs">{parsedConfig.uuid}</span>
                    </div>
                  )}
                  {parsedConfig.protocol === 'trojan' && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">
                        {t('servers.password', '密码')}:
                      </span>
                      <span className="ml-2">••••••••</span>
                    </div>
                  )}
                  {parsedConfig.protocol === 'hysteria2' && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">
                        {t('servers.password', '密码')}:
                      </span>
                      <span className="ml-2">••••••••</span>
                    </div>
                  )}
                  {parsedConfig.protocol === 'shadowsocks' && (
                    <>
                      <div className="col-span-2">
                        <span className="text-muted-foreground">
                          {t('servers.ssMethod', '加密方法')}:
                        </span>
                        <span className="ml-2">
                          {parsedConfig.shadowsocksSettings?.method || 'N/A'}
                        </span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-muted-foreground">
                          {t('servers.password', '密码')}:
                        </span>
                        <span className="ml-2">••••••••</span>
                      </div>
                    </>
                  )}
                  {parsedConfig.wsSettings?.path && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">
                        {t('servers.wsPath', 'WebSocket路径')}:
                      </span>
                      <span className="ml-2 font-mono">{parsedConfig.wsSettings.path}</span>
                    </div>
                  )}
                  {parsedConfig.tlsSettings?.serverName && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">
                        {t('servers.tlsSni', 'TLS服务器名')}:
                      </span>
                      <span className="ml-2">{parsedConfig.tlsSettings.serverName}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* 服务器名称 */}
          {parsedConfig && (
            <div className="space-y-2">
              <Label htmlFor="server-name">{t('servers.serverName', '服务器名称')}</Label>
              <Input
                id="server-name"
                placeholder={t('servers.inputServerName', '输入服务器名称')}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {t('servers.cancel', '取消')}
          </Button>
          <Button onClick={handleImport} disabled={!parsedConfig || !name.trim() || isImporting}>
            {isImporting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                {t('servers.importing', '导入中...')}
              </>
            ) : (
              t('servers.importConfirm', '导入服务器')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
