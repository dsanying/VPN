import { AppRulesCard } from '@/components/rules/app-rules-card';
import { useTranslation } from 'react-i18next';

export function AppPolicyPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t('rules.appRulesTitle')}</h2>
        <p className="text-muted-foreground mt-1">{t('rules.appRulesDesc')}</p>
      </div>

      <AppRulesCard />
    </div>
  );
}
