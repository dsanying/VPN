import { PROCESS_ICON } from '@shared/application-icon';
import { useState } from 'react';
import { AtomicValue, Stack } from '@/components/client';
import type { InstalledApplication } from '@shared/types';
import './ApplicationIdentity.css';

export function ApplicationIdentity({ application, name }: { application?: InstalledApplication; name: string }) {
  const source = application?.iconDataUrl;
  const [failed, setFailed] = useState<string>();
  const valid = source && /^data:image\/png;base64,/.test(source) && failed !== source;
  return <Stack direction="row" align="center" gap="control">
    <span className="ds-application-icon" aria-hidden><img src={valid ? source : PROCESS_ICON} alt="" onError={valid ? () => setFailed(source) : undefined} /></span>
    <AtomicValue text={name} />
  </Stack>;
}
