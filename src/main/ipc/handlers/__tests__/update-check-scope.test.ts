import { IPC_CHANNELS } from '../../../../shared/ipc-channels';
import type { GlobalUpdateItem, UpdateKind } from '../../../../shared/global-update';
import type { UpdateCheckResult } from '../../../../shared/types/update';
import { GlobalUpdateService } from '../../../services/GlobalUpdateService';
import type { UpdateService } from '../../../services/UpdateService';

jest.mock('../../ipc-handler', () => ({ registerIpcHandler: jest.fn() }));
jest.mock('../../../services/UpdateService', () => ({ UpdateService: jest.fn() }));
import { registerIpcHandler } from '../../ipc-handler';
import {
  registerUpdateHandlers,
  setGlobalUpdateService,
  setUpdateService,
} from '../update-handlers';

it('update:check invokes only software/core; status reads never trigger preparation', async () => {
  const kinds: UpdateKind[] = ['software', 'core', 'data', 'subscriptions'];
  const prepare = Object.fromEntries(
    kinds.map((kind) => [
      kind,
      jest.fn(async (): Promise<GlobalUpdateItem> => ({
        kind,
        status: kind === 'data' ? 'ready' : 'latest',
      })),
    ])
  ) as Record<UpdateKind, jest.Mock<Promise<GlobalUpdateItem>>>;
  const refreshMeasurements = jest.fn(async () => {});
  const service = new GlobalUpdateService({
    store: { read: async () => null, write: async () => {} },
    maintenanceError: () => {},
    prepare,
    refreshMeasurements,
    apply: async () => {},
    publish: () => {},
  });
  await service.check();
  for (const kind of kinds) prepare[kind].mockClear();
  refreshMeasurements.mockClear();
  setUpdateService({} as UpdateService);
  setGlobalUpdateService(service);
  registerUpdateHandlers();
  const registered = (registerIpcHandler as jest.Mock).mock.calls.find(
    ([channel]) => channel === IPC_CHANNELS.UPDATE_CHECK
  );
  const handler = registered![1] as (event: unknown, args: unknown) => Promise<UpdateCheckResult>;
  await handler({}, { statusOnly: true });
  for (const kind of kinds) expect(prepare[kind]).not.toHaveBeenCalled();
  const result = await handler({}, {});
  expect(result.hasUpdate).toBe(false);
  expect(prepare.software).toHaveBeenCalledTimes(1);
  expect(prepare.core).toHaveBeenCalledTimes(1);
  expect(prepare.data).not.toHaveBeenCalled();
  expect(prepare.subscriptions).not.toHaveBeenCalled();
  expect(refreshMeasurements).not.toHaveBeenCalled();
});
