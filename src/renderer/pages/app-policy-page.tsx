import { AppRulesCard } from '@/components/rules/app-rules-card';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Beaker } from 'lucide-react';

export function AppPolicyPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-bold">{t('rules.appRulesTitle')}</h2>
          <Badge
            variant="outline"
            className="text-xs gap-1 text-amber-500 border-amber-500/40 bg-amber-500/10 h-fit"
          >
            <Beaker className="h-3 w-3" />
            {t('rules.appRulesExperimental')}
          </Badge>
        </div>
        <p className="text-muted-foreground mt-1">{t('rules.appRulesDesc')}</p>
      </div>

      <AppRulesCard />
    </div>
  );
}
