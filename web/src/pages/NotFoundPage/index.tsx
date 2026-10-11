import { Result } from 'antd';
import { useTranslation } from 'react-i18next';

/** A missing client route has no data or editor state to restore. */
export default function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <section className="client-page" aria-label={t('app.404.title')}>
      <Result
        status="404"
        title={<h1>{t('app.404.title')}</h1>}
        subTitle={t('app.404.subtitle')}
      />
    </section>
  );
}
