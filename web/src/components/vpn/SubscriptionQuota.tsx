import { Progress, theme } from 'antd';
import { useTranslation } from 'react-i18next';
import type { SubscriptionConfig } from '@shared/types';
import { normalizeSubscriptionUsage } from '@shared/subscription-usage';
import { formatDataSize } from '@shared/network-units';
import './SubscriptionQuota.css';

/** One compact quota display shared by subscription views. */
export function SubscriptionQuota({ info }: { info: SubscriptionConfig['userInfo'] }) {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const usage = info ? normalizeSubscriptionUsage(info) : undefined;
  if (!usage || [usage.total, usage.remaining].every((value) => value === undefined)) return null;
  const { used, total, remaining } = usage;
  const text = (value: number | undefined) => (value === undefined ? '—' : formatDataSize(value));
  const knownRatio = total !== undefined && total > 0 && remaining !== undefined;
  // Divide before multiplying to avoid overflow for large but valid byte counts.
  const percent = knownRatio ? Math.min(100, (remaining / total) * 100) : 0;
  const exceeded = total !== undefined && used !== undefined && used > total;
  return (
    <div className="ds-subscription-quota">
      <div className="ds-subscription-quota__values">
        <span>
          {t('vpn.remainingTraffic')}: {text(remaining)} / {t('common.vocab.total')}: {text(total)}
        </span>
      </div>
      <div className="ds-subscription-quota__meter">
        {knownRatio ? (
          <div className="ds-subscription-quota__bar">
            <Progress
              percent={percent}
              showInfo={false}
              size="small"
              strokeColor={exceeded ? token.colorError : token.colorSuccess}
              railColor={token.colorFillSecondary}
              aria-label={`${t('vpn.remainingTraffic')}: ${text(remaining)} / ${t('common.vocab.total')}: ${text(total)}`}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
