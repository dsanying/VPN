import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/store/app-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { APP_PRESETS, type AppPreset } from '../../../shared/app-rules-preset';
import type { AppRule, RuleAction } from '../../../shared/types';
import { Beaker } from 'lucide-react';
export function AppRulesCard() {
  const { t } = useTranslation();
  const config = useAppStore((state) => state.config);
  const saveConfig = useAppStore((state) => state.saveConfig);

  if (!config) return null;

  const appRules: AppRule[] = config.appRules || [];

  const getAppRule = (appId: string): AppRule | undefined =>
    appRules.find((r) => r.appId === appId);

  const handlePolicyChange = async (preset: AppPreset, value: string) => {
    let action: RuleAction = 'proxy';
    let targetServerId: string | undefined = undefined;
    let enabled = true;

    if (value === 'direct') action = 'direct';
    else if (value === 'block') action = 'block';
    else if (value === 'proxy-default') {
      action = 'proxy';
      enabled = false;
    } else if (value.startsWith('node-')) {
      action = 'proxy';
      targetServerId = value.replace('node-', '');
    }

    const existing = getAppRule(preset.id);
    let newRules: AppRule[];

    if (existing) {
      newRules = appRules.map((r) =>
        r.appId === preset.id ? { ...r, action, targetServerId, enabled } : r
      );
    } else {
      if (value === 'proxy-default') return;
      newRules = [...appRules, { appId: preset.id, action, targetServerId, enabled: true }];
    }

    await saveConfig({ ...config, appRules: newRules });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">{t('rules.appRulesTitle')}</CardTitle>
          <Badge
            variant="outline"
            className="text-xs gap-1 text-amber-500 border-amber-500/40 bg-amber-500/10"
          >
            <Beaker className="h-3 w-3" />
            {t('rules.appRulesExperimental')}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">{t('rules.appRulesDesc')}</p>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
          {APP_PRESETS.map((preset) => {
            const rule = getAppRule(preset.id);
            const isEnabled = rule?.enabled ?? false;

            return (
              <Select
                key={preset.id}
                value={(() => {
                  if (!rule || !isEnabled) return 'proxy-default';
                  if (rule.action === 'direct') return 'direct';
                  if (rule.action === 'block') return 'block';
                  return rule.targetServerId ? `node-${rule.targetServerId}` : 'proxy-default';
                })()}
                onValueChange={(v) => handlePolicyChange(preset, v)}
              >
                <SelectTrigger
                  className={`h-[85px] w-full p-3.5 flex flex-col items-start justify-center gap-2 rounded-xl border-none shadow-none focus:ring-0 transition-all [&>svg]:hidden ${
                    isEnabled
                      ? 'bg-primary/10 hover:bg-primary/20 text-primary'
                      : 'bg-muted/40 hover:bg-muted/60 text-foreground'
                  }`}
                >
                  {/* Middle: Title ONLY */}
                  <div className="flex items-center gap-2 mt-auto mb-auto w-full">
                    <span
                      className={`text-[15px] font-bold truncate tracking-tight ${
                        isEnabled ? 'text-primary' : 'text-foreground/90'
                      }`}
                    >
                      {t(`rules.apps.${preset.labelKey}` as any)}
                    </span>
                  </div>

                  {/* Bottom: Current Policy */}
                  <div
                    className={`text-[11px] w-full text-left font-medium tracking-wider uppercase ${
                      isEnabled ? 'text-primary/70' : 'text-muted-foreground'
                    }`}
                  >
                    {(() => {
                      if (!rule || !isEnabled) return 'Proxy';
                      if (rule.action === 'direct') return 'DIRECT';
                      if (rule.action === 'block') return 'BLOCK';
                      if (rule.targetServerId) {
                        const s = config.servers?.find(
                          (server) => server.id === rule.targetServerId
                        );
                        return s ? s.name : 'Proxy';
                      }
                      return 'Proxy';
                    })()}
                  </div>
                </SelectTrigger>

                <SelectContent className="max-h-[300px]">
                  {/* 基础策略 */}
                  <div className="px-2 py-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wide">
                    系统策略
                  </div>
                  <SelectItem value="proxy-default" className="text-xs font-medium text-primary">
                    👉 代理 (默认节点)
                  </SelectItem>
                  <SelectItem value="direct" className="text-xs text-green-600 dark:text-green-500">
                    {t('rules.direct')}
                  </SelectItem>
                  <SelectItem value="block" className="text-xs text-red-600 dark:text-red-500">
                    {t('rules.block')}
                  </SelectItem>

                  {/* 具体节点 */}
                  {config.servers && config.servers.length > 0 && (
                    <>
                      <div className="px-2 py-1.5 mt-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wide border-t">
                        独立路由节点
                      </div>
                      {config.servers.map((s) => (
                        <SelectItem key={s.id} value={`node-${s.id}`} className="text-xs">
                          {s.name}
                        </SelectItem>
                      ))}
                    </>
                  )}
                </SelectContent>
              </Select>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
