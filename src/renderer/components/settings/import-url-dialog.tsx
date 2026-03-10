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
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [parsedConfig, setParsedConfig] = useState<ServerConfig | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const handleParseUrl = async () => {
    if (!url.trim()) {
      toast.error(t('importUrl.pleaseEnterUrl', 'Please enter a protocol URL'));
      return;
    }

    setIsParsing(true);
    try {
      const response = await parseProtocolUrl(url.trim());
      if (response && response.success && response.data) {
        setParsedConfig(response.data as any);

        if (!name.trim()) {
          const protocol = response.data.protocol.toUpperCase();
          const address = response.data.address;
          setName(`${protocol} - ${address}`);
        }

        toast.success(t('importUrl.parseSuccess', 'URL parsed successfully'));
      } else {
        toast.error(response?.error || t('importUrl.parseFailed', 'URL parse failed'));
        setParsedConfig(null);
      }
    } catch (error) {
      console.error('Parse URL error:', error);
      toast.error(t('importUrl.parseFailed', 'URL parse failed'));
      setParsedConfig(null);
    } finally {
      setIsParsing(false);
    }
  };

  const handleImport = async () => {
    if (!parsedConfig || !name.trim()) {
      toast.error(
        t('importUrl.parseFirstAndName', 'Please parse the URL and enter a server name first')
      );
      return;
    }

    setIsImporting(true);
    try {
      const response = await addServerFromUrl(url.trim(), name.trim());
      if (response && response.success) {
        onImportSuccess?.();
        handleClose();
      } else {
        toast.error(response?.error || t('importUrl.importFailed', 'Failed to import server'));
      }
    } catch (error) {
      console.error('Import server error:', error);
      toast.error(t('importUrl.importFailed', 'Failed to import server'));
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
      url.startsWith('anytls://') ||
      url.startsWith('tuic://') ||
      url.startsWith('http2://') ||
      url.startsWith('naive+https://')
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link className="h-5 w-5" />
            {t('importUrl.title', 'Import Server from URL')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'importUrl.desc',
              'Supports vless://, trojan://, hysteria2://, hy2://, ss://, anytls://, tuic:// and http2:// protocol links'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="protocol-url">{t('importUrl.urlLabel', 'Protocol URL')}</Label>
            <div className="flex gap-2">
              <Textarea
                id="protocol-url"
                placeholder={t(
                  'importUrl.urlPlaceholder',
                  'vless://uuid@server:port?encryption=none&security=tls&type=ws#name\nor trojan://password@server:port?security=tls#name\nor hysteria2://password@server:port?sni=example.com#name\nor ss://base64(method:password)@server:port#name\nor anytls://password@server:port?security=tls&sni=example.com#name\nor tuic://uuid:password@server:port?sni=example.com#name\nor http2://username:password@server:port#name'
                )}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="min-h-[100px] resize-none"
              />
              <Button
                onClick={handleParseUrl}
                disabled={!url.trim() || !isValidUrl(url.trim()) || isParsing}
                className="shrink-0"
              >
                {isParsing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t('importUrl.parse', 'Parse')
                )}
              </Button>
            </div>
            {url.trim() && !isValidUrl(url.trim()) && (
              <p className="text-sm text-destructive">
                {t(
                  'importUrl.invalidUrl',
                  'Please enter a valid vless://, trojan://, hysteria2://, hy2://, ss://, anytls://, tuic:// or http2:// link'
                )}
              </p>
            )}
          </div>

          {parsedConfig && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Server className="h-4 w-4" />
                  {t('importUrl.parseResult', 'Parse Result')}
                </CardTitle>
                <CardDescription>
                  {t(
                    'importUrl.parseResultDesc',
                    'URL parsed successfully, please confirm the configuration'
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">
                      {t('importUrl.protocol', 'Protocol')}:
                    </span>
                    <Badge variant="outline" className="ml-2">
                      {parsedConfig.protocol}
                    </Badge>
                  </div>
                  <div className="flex flex-col md:flex-row md:items-baseline relative pr-2">
                    <span className="text-muted-foreground whitespace-nowrap">
                      {t('importUrl.address', 'Address')}:
                    </span>
                    <span className="md:ml-2 font-mono break-all line-clamp-2 md:line-clamp-none">
                      {parsedConfig.address.includes(':')
                        ? `[${parsedConfig.address}]`
                        : parsedConfig.address}
                      :{parsedConfig.port}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">
                      {t('importUrl.transport', 'Transport')}:
                    </span>
                    <span className="ml-2">{parsedConfig.network}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">
                      {t('importUrl.encryption', 'Encryption')}:
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
                        {t('importUrl.password', 'Password')}:
                      </span>
                      <span className="ml-2">••••••••</span>
                    </div>
                  )}
                  {parsedConfig.protocol === 'hysteria2' && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">
                        {t('importUrl.password', 'Password')}:
                      </span>
                      <span className="ml-2">••••••••</span>
                    </div>
                  )}
                  {parsedConfig.protocol === 'tuic' && (
                    <>
                      <div className="col-span-2">
                        <span className="text-muted-foreground">UUID:</span>
                        <span className="ml-2 font-mono text-xs">{parsedConfig.uuid}</span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-muted-foreground">
                          {t('importUrl.password', 'Password')}:
                        </span>
                        <span className="ml-2">••••••••</span>
                      </div>
                    </>
                  )}
                  {parsedConfig.protocol === 'shadowsocks' && (
                    <>
                      <div className="col-span-2">
                        <span className="text-muted-foreground">
                          {t('importUrl.encryptionMethod', 'Encryption Method')}:
                        </span>
                        <span className="ml-2">
                          {parsedConfig.shadowsocksSettings?.method || 'N/A'}
                        </span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-muted-foreground">
                          {t('importUrl.password', 'Password')}:
                        </span>
                        <span className="ml-2">••••••••</span>
                      </div>
                    </>
                  )}
                  {parsedConfig.wsSettings?.path && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">
                        {t('importUrl.wsPath', 'WebSocket Path')}:
                      </span>
                      <span className="ml-2 font-mono">{parsedConfig.wsSettings.path}</span>
                    </div>
                  )}
                  {parsedConfig.tlsSettings?.serverName && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">
                        {t('importUrl.tlsServer', 'TLS Server Name')}:
                      </span>
                      <span className="ml-2">{parsedConfig.tlsSettings.serverName}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {parsedConfig && (
            <div className="space-y-2">
              <Label htmlFor="server-name">{t('importUrl.serverName', 'Server Name')}</Label>
              <Input
                id="server-name"
                placeholder={t('importUrl.serverNamePlaceholder', 'Enter server name')}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button onClick={handleImport} disabled={!parsedConfig || !name.trim() || isImporting}>
            {isImporting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                {t('importUrl.importing', 'Importing...')}
              </>
            ) : (
              t('importUrl.importServer', 'Import Server')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
