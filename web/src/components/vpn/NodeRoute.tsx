import { Fragment } from 'react';
import { AtomicValue } from '@/components/client';
import { useAppStore } from '@/store/app-store';
import { resolveNodeIdentity } from '@shared/node-identity';
import { NodeIdentity } from './NodeIdentity';
import type { ServerConfig } from '@shared/types';

const EMPTY_SERVERS: ServerConfig[] = [];

export function NodeRoute({
  values,
  display,
}: {
  values: string[];
  display: (value: string) => string;
}) {
  const servers = useAppStore((state) => state.config?.servers ?? EMPTY_SERVERS);
  return (
    <AtomicValue text={values.map(display).join(' → ')}>
      {values.map((value, index) => {
        const node = resolveNodeIdentity(value, servers);
        return (
          <Fragment key={`${index}:${value}`}>
            {index ? ' → ' : null}
            {node ? <NodeIdentity nodeId={node.id} name={node.name} /> : display(value)}
          </Fragment>
        );
      })}
    </AtomicValue>
  );
}
