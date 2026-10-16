import { IPC_CHANNELS as C } from '../../../shared/ipc-channels';
import { registerIpcHandler } from '../ipc-handler';
import type { EnterpriseProfileInput } from '../../../shared/enterprise-vpn';
import type { EnterpriseVpnService } from '../../services/enterprise/EnterpriseVpnService';
export function registerEnterpriseHandlers(service: EnterpriseVpnService): void {
  registerIpcHandler(C.ENTERPRISE_GET, () => service.snapshot());
  registerIpcHandler<{ gateway: string }, unknown>(C.ENTERPRISE_DETECT, (_e, args) =>
    service.discovery.detect(args.gateway)
  );
  registerIpcHandler<EnterpriseProfileInput, unknown>(C.ENTERPRISE_SAVE, (_e, args) =>
    service.save(args)
  );
  registerIpcHandler<{ id: string; value: Parameters<EnterpriseVpnService['respond']>[1] }, void>(
    C.ENTERPRISE_RESPOND,
    (_e, args) => service.respond(args.id, args.value)
  );
}
