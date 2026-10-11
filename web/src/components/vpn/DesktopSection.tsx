import { Typography } from 'antd';
import { useId, type ReactNode } from 'react';
import { HelpTip, SectionHeader, Stack } from '@/components/client';

/** 客户端内容始终挂载和展示；长度交给主内容区或表单抽屉滚动。 */
export function DesktopSection({ title, summary, tooltip, extra, children }: { title: string; summary?: ReactNode; tooltip?: string; extra?: ReactNode; children: ReactNode }) {
  const headingId = useId();
  return <section aria-labelledby={headingId} data-layout="desktop-section">
    <Stack direction="column" gap="block">
      <SectionHeader title={<span id={headingId}>{title}{tooltip ? <HelpTip title={tooltip} /> : null}</span>} extra={extra} />
      {summary ? <Typography.Text type="secondary">{summary}</Typography.Text> : null}
      {children}
    </Stack>
  </section>;
}
