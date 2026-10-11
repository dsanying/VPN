import type { SingBoxConnectionEvents, SingBoxStatus } from './singbox-api-client';

/** Management operations shared by the desktop, independent of wire protocol. */
export interface CoreManagementClient {
  start(): void;
  stop(): void;
  probe(timeoutMs?: number): Promise<void>;
  selectOutbound(group: string, member: string): Promise<void>;
  closeConnection(id: string): Promise<void>;
  closeAllConnections(): Promise<void>;
  subscribeStatus(intervalNs: number, receive: (status: SingBoxStatus) => void): () => void;
  subscribeConnections(
    intervalNs: number,
    receive: (events: SingBoxConnectionEvents) => void
  ): () => void;
}
