import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/store/app-store';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

export function AdvancedSettings() {
  const config = useAppStore((state) => state.config);
  const saveConfig = useAppStore((state) => state.saveConfig);

  const [socksPort, setSocksPort] = useState(config?.socksPort?.toString() || '65534');
  const [httpPort, setHttpPort] = useState(config?.httpPort?.toString() || '65533');
  const [isLoading, setIsLoading] = useState(false);
  const { t } = useTranslation();

  const handleSavePorts = async () => {
    if (!config) return;

    const socksPortNum = parseInt(socksPort, 10);
    const httpPortNum = parseInt(httpPort, 10);

    // Validate ports
    if (isNaN(socksPortNum) || socksPortNum < 1024 || socksPortNum > 65535) {
      toast.error(t('settings.advanced.socksPortRange'));
      return;
    }

    if (isNaN(httpPortNum) || httpPortNum < 1024 || httpPortNum > 65535) {
      toast.error(t('settings.advanced.httpPortRange'));
      return;
    }

    if (socksPortNum === httpPortNum) {
      toast.error(t('settings.advanced.portsSame'));
      return;
    }

    setIsLoading(true);
    try {
      const updatedConfig = {
        ...config,
        socksPort: socksPortNum,
        httpPort: httpPortNum,
      };
      await saveConfig(updatedConfig);
      toast.success(t('settings.advanced.portsSaved'));
    } catch {
      toast.error(t('settings.advanced.portsSaveFail'));
    } finally {
      setIsLoading(false);
    }
  };

  if (!config) {
    return null;
  }

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        {/* DNS 设置区域 */}
        <div className="space-y-4">
          <h4 className="text-sm font-medium mb-2">{t('settings.advanced.dnsSettings')}</h4>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="domesticDns">{t('settings.advanced.domesticDns')}</Label>
              <Input
                id="domesticDns"
                value={config.dnsConfig?.domesticDns || 'https://doh.pub/dns-query'}
                onChange={(e) => {
                  const updatedConfig = { ...config };
                  if (!updatedConfig.dnsConfig) {
                    updatedConfig.dnsConfig = {
                      domesticDns: '',
                      foreignDns: '',
                      enableFakeIp: false,
                    };
                  }
                  updatedConfig.dnsConfig.domesticDns = e.target.value;
                  saveConfig(updatedConfig);
                }}
                className="max-w-md"
                placeholder={t('settings.advanced.domesticDnsPlaceholder')}
              />
              <p className="text-xs text-muted-foreground">
                {t('settings.advanced.domesticDnsDesc')}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="foreignDns">{t('settings.advanced.foreignDns')}</Label>
              <Input
                id="foreignDns"
                value={config.dnsConfig?.foreignDns || 'https://dns.google/dns-query'}
                onChange={(e) => {
                  const updatedConfig = { ...config };
                  if (!updatedConfig.dnsConfig) {
                    updatedConfig.dnsConfig = {
                      domesticDns: '',
                      foreignDns: '',
                      enableFakeIp: false,
                    };
                  }
                  updatedConfig.dnsConfig.foreignDns = e.target.value;
                  saveConfig(updatedConfig);
                }}
                className="max-w-md"
                placeholder={t('settings.advanced.foreignDnsPlaceholder')}
              />
              <p className="text-xs text-muted-foreground">
                {t('settings.advanced.foreignDnsDesc')}
              </p>
            </div>

            <div className="flex items-center space-x-2 pt-2">
              <input
                type="checkbox"
                id="enableFakeIp"
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                checked={config.dnsConfig?.enableFakeIp || false}
                onChange={(e) => {
                  const updatedConfig = { ...config };
                  if (!updatedConfig.dnsConfig) {
                    updatedConfig.dnsConfig = {
                      domesticDns: 'https://doh.pub/dns-query',
                      foreignDns: 'https://dns.google/dns-query',
                      enableFakeIp: false,
                    };
                  }
                  updatedConfig.dnsConfig.enableFakeIp = e.target.checked;
                  saveConfig(updatedConfig);
                }}
              />
              <Label htmlFor="enableFakeIp" className="font-normal">
                {t('settings.advanced.enableFakeIp')}
              </Label>
            </div>
            <p className="text-xs text-muted-foreground ml-6">
              {t('settings.advanced.fakeIpDesc')}
            </p>
          </div>
        </div>

        {/* 端口设置区域 */}
        <div className="space-y-4 pt-4 border-t">
          <h4 className="text-sm font-medium mb-2">{t('settings.advanced.portSettings')}</h4>
          <div className="space-y-2">
            <Label htmlFor="socksPort">{t('settings.advanced.socksPort')}</Label>
            <div className="flex gap-2">
              <Input
                id="socksPort"
                type="number"
                min="1024"
                max="65535"
                value={socksPort}
                onChange={(e) => setSocksPort(e.target.value)}
                className="max-w-[200px]"
              />
            </div>
            <p className="text-xs text-muted-foreground">{t('settings.advanced.default')}: 65534</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="httpPort">{t('settings.advanced.httpPort')}</Label>
            <div className="flex gap-2">
              <Input
                id="httpPort"
                type="number"
                min="1024"
                max="65535"
                value={httpPort}
                onChange={(e) => setHttpPort(e.target.value)}
                className="max-w-[200px]"
              />
            </div>
            <p className="text-xs text-muted-foreground">{t('settings.advanced.default')}: 65533</p>
          </div>

          <Button onClick={handleSavePorts} disabled={isLoading}>
            {isLoading ? t('settings.advanced.saving') : t('settings.advanced.savePortSettings')}
          </Button>
        </div>

        <div className="space-y-4 pt-4 border-t">
          <div>
            <h4 className="text-sm font-medium mb-2">{t('settings.advanced.terminalProxy')}</h4>
            <p className="text-xs text-muted-foreground mb-3">
              {t('settings.advanced.terminalProxyDesc')}
            </p>

            <div className="space-y-3">
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Windows (CMD)</Label>
                <div className="mt-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2 py-1 text-xs bg-muted rounded font-mono">
                      set http_proxy=http://127.0.0.1:{httpPort}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          `set http_proxy=http://127.0.0.1:${httpPort}`
                        );
                        toast.success(t('settings.advanced.copied'));
                      }}
                    >
                      {t('settings.advanced.copy')}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2 py-1 text-xs bg-muted rounded font-mono">
                      set https_proxy=http://127.0.0.1:{httpPort}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          `set https_proxy=http://127.0.0.1:${httpPort}`
                        );
                        toast.success(t('settings.advanced.copied'));
                      }}
                    >
                      {t('settings.advanced.copy')}
                    </Button>
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-xs font-medium text-muted-foreground">
                  Windows (PowerShell)
                </Label>
                <div className="mt-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2 py-1 text-xs bg-muted rounded font-mono">
                      $env:http_proxy="http://127.0.0.1:{httpPort}"
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          `$env:http_proxy="http://127.0.0.1:${httpPort}"`
                        );
                        toast.success(t('settings.advanced.copied'));
                      }}
                    >
                      {t('settings.advanced.copy')}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2 py-1 text-xs bg-muted rounded font-mono">
                      $env:https_proxy="http://127.0.0.1:{httpPort}"
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          `$env:https_proxy="http://127.0.0.1:${httpPort}"`
                        );
                        toast.success(t('settings.advanced.copied'));
                      }}
                    >
                      {t('settings.advanced.copy')}
                    </Button>
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-xs font-medium text-muted-foreground">
                  Linux/macOS (Bash/Zsh)
                </Label>
                <div className="mt-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2 py-1 text-xs bg-muted rounded font-mono">
                      export http_proxy=http://127.0.0.1:{httpPort}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          `export http_proxy=http://127.0.0.1:${httpPort}`
                        );
                        toast.success(t('settings.advanced.copied'));
                      }}
                    >
                      {t('settings.advanced.copy')}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2 py-1 text-xs bg-muted rounded font-mono">
                      export https_proxy=http://127.0.0.1:{httpPort}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          `export https_proxy=http://127.0.0.1:${httpPort}`
                        );
                        toast.success(t('settings.advanced.copied'));
                      }}
                    >
                      {t('settings.advanced.copy')}
                    </Button>
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-xs font-medium text-muted-foreground">
                  {t('settings.advanced.gitProxy')}
                </Label>
                <div className="mt-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2 py-1 text-xs bg-muted rounded font-mono">
                      git config --global http.proxy http://127.0.0.1:{httpPort}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          `git config --global http.proxy http://127.0.0.1:${httpPort}`
                        );
                        toast.success(t('settings.advanced.copied'));
                      }}
                    >
                      {t('settings.advanced.copy')}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2 py-1 text-xs bg-muted rounded font-mono">
                      git config --global https.proxy http://127.0.0.1:{httpPort}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          `git config --global https.proxy http://127.0.0.1:${httpPort}`
                        );
                        toast.success(t('settings.advanced.copied'));
                      }}
                    >
                      {t('settings.advanced.copy')}
                    </Button>
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-xs font-medium text-muted-foreground">
                  {t('settings.advanced.npmProxy')}
                </Label>
                <div className="mt-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2 py-1 text-xs bg-muted rounded font-mono">
                      npm config set proxy http://127.0.0.1:{httpPort}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          `npm config set proxy http://127.0.0.1:${httpPort}`
                        );
                        toast.success(t('settings.advanced.copied'));
                      }}
                    >
                      {t('settings.advanced.copy')}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2 py-1 text-xs bg-muted rounded font-mono">
                      npm config set https-proxy http://127.0.0.1:{httpPort}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          `npm config set https-proxy http://127.0.0.1:${httpPort}`
                        );
                        toast.success(t('settings.advanced.copied'));
                      }}
                    >
                      {t('settings.advanced.copy')}
                    </Button>
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-xs font-medium text-muted-foreground">
                  {t('settings.advanced.socks5Proxy')}
                </Label>
                <div className="mt-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2 py-1 text-xs bg-muted rounded font-mono">
                      set ALL_PROXY=socks5://127.0.0.1:{socksPort}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          `set ALL_PROXY=socks5://127.0.0.1:${socksPort}`
                        );
                        toast.success(t('settings.advanced.copied'));
                      }}
                    >
                      {t('settings.advanced.copy')}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2 py-1 text-xs bg-muted rounded font-mono">
                      $env:ALL_PROXY="socks5://127.0.0.1:{socksPort}"
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          `$env:ALL_PROXY="socks5://127.0.0.1:${socksPort}"`
                        );
                        toast.success(t('settings.advanced.copied'));
                      }}
                    >
                      {t('settings.advanced.copy')}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2 py-1 text-xs bg-muted rounded font-mono">
                      export ALL_PROXY=socks5://127.0.0.1:{socksPort}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          `export ALL_PROXY=socks5://127.0.0.1:${socksPort}`
                        );
                        toast.success(t('settings.advanced.copied'));
                      }}
                    >
                      {t('settings.advanced.copy')}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 p-3 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground">
                <strong>{t('settings.advanced.tip')}</strong>
              </p>
              <ul className="text-xs text-muted-foreground mt-1 space-y-1">
                <li>• {t('settings.advanced.tipSessionOnly')}</li>
                <li>• {t('settings.advanced.tipPermanent')}</li>
                <li>• {t('settings.advanced.tipHttpPort', { port: httpPort })}</li>
                <li>• {t('settings.advanced.tipSocksPort', { port: socksPort })}</li>
                <li>• {t('settings.advanced.tipDisable')}</li>
              </ul>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
