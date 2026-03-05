import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/store/app-store';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

export function AdvancedSettings() {
  const config = useAppStore((state) => state.config);
  const saveConfig = useAppStore((state) => state.saveConfig);
  const { t } = useTranslation();

  const [socksPort, setSocksPort] = useState(config?.socksPort?.toString() || '65534');
  const [httpPort, setHttpPort] = useState(config?.httpPort?.toString() || '65533');
  const [isLoading, setIsLoading] = useState(false);

  const handleSavePorts = async () => {
    if (!config) return;

    const socksPortNum = parseInt(socksPort, 10);
    const httpPortNum = parseInt(httpPort, 10);

    // Validate ports
    if (isNaN(socksPortNum) || socksPortNum < 1024 || socksPortNum > 65535) {
      toast.error(t('advanced.socksPortRange', 'SOCKS 端口必须在 1024-65535 之间'));
      return;
    }

    if (isNaN(httpPortNum) || httpPortNum < 1024 || httpPortNum > 65535) {
      toast.error(t('advanced.httpPortRange', 'HTTP 端口必须在 1024-65535 之间'));
      return;
    }

    if (socksPortNum === httpPortNum) {
      toast.error(t('advanced.portsSame', 'SOCKS 和 HTTP 端口不能相同'));
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
      toast.success(t('advanced.portsSaved', '端口设置已保存，重启代理后生效'));
    } catch {
      toast.error(t('advanced.portsSaveFail', '保存端口设置失败'));
    } finally {
      setIsLoading(false);
    }
  };

  if (!config) {
    return null;
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(t('advanced.copied', '已复制到剪贴板'));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('advanced.title', '高级')}</CardTitle>
        <CardDescription>{t('advanced.description', '高级配置选项与 DNS 设置')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* DNS 设置区域 */}
        <div className="space-y-4">
          <h4 className="text-sm font-medium mb-2">{t('advanced.dnsSettings', 'DNS 设置')}</h4>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="domesticDns">{t('advanced.domesticDns', '国内 DNS (直连)')}</Label>
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
                placeholder={t(
                  'advanced.domesticDnsPlaceholder',
                  '例如: https://doh.pub/dns-query 或 223.5.5.5'
                )}
              />
              <p className="text-xs text-muted-foreground">
                {t('advanced.domesticDnsDesc', '用于解析国内域名，建议使用国内 DoH 或 UDP DNS')}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="foreignDns">{t('advanced.foreignDns', '海外 DNS (代理)')}</Label>
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
                placeholder={t(
                  'advanced.foreignDnsPlaceholder',
                  '例如: https://dns.google/dns-query 或 8.8.8.8'
                )}
              />
              <p className="text-xs text-muted-foreground">
                {t('advanced.foreignDnsDesc', '用于解析海外域名，防止 DNS 污染 (将通过代理发送)')}
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
                {t('advanced.enableFakeIp', '启用 FakeIP (仅 TUN 模式有效)')}
              </Label>
            </div>
            <p className="text-xs text-muted-foreground ml-6">
              {t(
                'advanced.fakeIpDesc',
                '能显著降低首次连接延迟，但可能导致某些依赖真实 IP 的应用异常'
              )}
            </p>
          </div>
        </div>

        {/* 端口设置区域 */}
        <div className="space-y-4 pt-4 border-t">
          <h4 className="text-sm font-medium mb-2">{t('advanced.portSettings', '端口设置')}</h4>
          <div className="space-y-2">
            <Label htmlFor="socksPort">{t('advanced.socksPort', '本地 SOCKS 端口')}</Label>
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
            <p className="text-xs text-muted-foreground">{t('advanced.default', '默认')}: 65534</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="httpPort">{t('advanced.httpPort', '本地 HTTP 端口')}</Label>
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
            <p className="text-xs text-muted-foreground">{t('advanced.default', '默认')}: 65533</p>
          </div>

          <Button onClick={handleSavePorts} disabled={isLoading}>
            {isLoading
              ? t('advanced.saving', '保存中...')
              : t('advanced.savePortSettings', '保存端口设置')}
          </Button>
        </div>

        <div className="space-y-4 pt-4 border-t">
          <div>
            <h4 className="text-sm font-medium mb-2">
              {t('advanced.terminalProxy', '终端代理设置')}
            </h4>
            <p className="text-xs text-muted-foreground mb-3">
              {t('advanced.terminalProxyDesc', '复制以下命令到终端中设置代理（需要先启动代理）')}
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
                      onClick={() => copyToClipboard(`set http_proxy=http://127.0.0.1:${httpPort}`)}
                    >
                      {t('advanced.copy', '复制')}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2 py-1 text-xs bg-muted rounded font-mono">
                      set https_proxy=http://127.0.0.1:{httpPort}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        copyToClipboard(`set https_proxy=http://127.0.0.1:${httpPort}`)
                      }
                    >
                      {t('advanced.copy', '复制')}
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
                      $env:http_proxy=&quot;http://127.0.0.1:{httpPort}&quot;
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        copyToClipboard(`$env:http_proxy="http://127.0.0.1:${httpPort}"`)
                      }
                    >
                      {t('advanced.copy', '复制')}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2 py-1 text-xs bg-muted rounded font-mono">
                      $env:https_proxy=&quot;http://127.0.0.1:{httpPort}&quot;
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        copyToClipboard(`$env:https_proxy="http://127.0.0.1:${httpPort}"`)
                      }
                    >
                      {t('advanced.copy', '复制')}
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
                      onClick={() =>
                        copyToClipboard(`export http_proxy=http://127.0.0.1:${httpPort}`)
                      }
                    >
                      {t('advanced.copy', '复制')}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2 py-1 text-xs bg-muted rounded font-mono">
                      export https_proxy=http://127.0.0.1:{httpPort}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        copyToClipboard(`export https_proxy=http://127.0.0.1:${httpPort}`)
                      }
                    >
                      {t('advanced.copy', '复制')}
                    </Button>
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-xs font-medium text-muted-foreground">
                  {t('advanced.gitProxy', 'Git 代理设置')}
                </Label>
                <div className="mt-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2 py-1 text-xs bg-muted rounded font-mono">
                      git config --global http.proxy http://127.0.0.1:{httpPort}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        copyToClipboard(
                          `git config --global http.proxy http://127.0.0.1:${httpPort}`
                        )
                      }
                    >
                      {t('advanced.copy', '复制')}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2 py-1 text-xs bg-muted rounded font-mono">
                      git config --global https.proxy http://127.0.0.1:{httpPort}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        copyToClipboard(
                          `git config --global https.proxy http://127.0.0.1:${httpPort}`
                        )
                      }
                    >
                      {t('advanced.copy', '复制')}
                    </Button>
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-xs font-medium text-muted-foreground">
                  {t('advanced.npmProxy', 'npm 代理设置')}
                </Label>
                <div className="mt-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2 py-1 text-xs bg-muted rounded font-mono">
                      npm config set proxy http://127.0.0.1:{httpPort}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        copyToClipboard(`npm config set proxy http://127.0.0.1:${httpPort}`)
                      }
                    >
                      {t('advanced.copy', '复制')}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2 py-1 text-xs bg-muted rounded font-mono">
                      npm config set https-proxy http://127.0.0.1:{httpPort}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        copyToClipboard(`npm config set https-proxy http://127.0.0.1:${httpPort}`)
                      }
                    >
                      {t('advanced.copy', '复制')}
                    </Button>
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-xs font-medium text-muted-foreground">
                  {t('advanced.socks5Proxy', 'SOCKS5 代理设置（通用）')}
                </Label>
                <div className="mt-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2 py-1 text-xs bg-muted rounded font-mono">
                      set ALL_PROXY=socks5://127.0.0.1:{socksPort}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        copyToClipboard(`set ALL_PROXY=socks5://127.0.0.1:${socksPort}`)
                      }
                    >
                      {t('advanced.copy', '复制')}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2 py-1 text-xs bg-muted rounded font-mono">
                      $env:ALL_PROXY=&quot;socks5://127.0.0.1:{socksPort}&quot;
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        copyToClipboard(`$env:ALL_PROXY="socks5://127.0.0.1:${socksPort}"`)
                      }
                    >
                      {t('advanced.copy', '复制')}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2 py-1 text-xs bg-muted rounded font-mono">
                      export ALL_PROXY=socks5://127.0.0.1:{socksPort}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        copyToClipboard(`export ALL_PROXY=socks5://127.0.0.1:${socksPort}`)
                      }
                    >
                      {t('advanced.copy', '复制')}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 p-3 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground">
                <strong>{t('advanced.tip', '提示：')}</strong>
              </p>
              <ul className="text-xs text-muted-foreground mt-1 space-y-1">
                <li>• {t('advanced.tipSessionOnly', '终端代理设置仅在当前会话有效')}</li>
                <li>
                  •{' '}
                  {t(
                    'advanced.tipPermanent',
                    '要永久设置，请将命令添加到 ~/.bashrc 或 ~/.zshrc 文件中'
                  )}
                </li>
                <li>
                  •{' '}
                  {t('advanced.tipHttpPort', 'HTTP 代理端口：{{port}}（推荐，兼容性最好）', {
                    port: httpPort,
                  })}
                </li>
                <li>
                  •{' '}
                  {t('advanced.tipSocksPort', 'SOCKS5 代理端口：{{port}}（部分工具支持）', {
                    port: socksPort,
                  })}
                </li>
                <li>• {t('advanced.tipDisable', '取消代理：删除或注释相关环境变量')}</li>
              </ul>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
