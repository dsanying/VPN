import * as grpc from '@grpc/grpc-js';
import { SingBoxApiClient, type TailscaleEndpointStatus } from '../singbox-api-client';

// 固定 payload 按官方 v1.14.2 字段号编码；不经被测 schema 序列化。
const OFFICIAL_WIRE = Buffer.from(
  '0a710a077461696c6e6574221a68747470733a2f2f6c6f67696e2e6578616d706c652e746573743a0f0a0473656c66620773656c662d69644226121175736572406578616d706c652e746573742a110a047065657238016207657869742d69644a110a047065657238016207657869742d6964',
  'hex'
);

it('用官方字段号解码认证链接、self、用户组和出口节点', async () => {
  const server = new grpc.Server();
  server.addService(
    {
      SubscribeTailscaleStatus: {
        path: '/daemon.StartedService/SubscribeTailscaleStatus',
        requestStream: false,
        responseStream: true,
        requestSerialize: () => Buffer.alloc(0),
        requestDeserialize: () => ({}),
        responseSerialize: () => OFFICIAL_WIRE,
        responseDeserialize: (buffer: Buffer) => buffer,
      },
    },
    {
      SubscribeTailscaleStatus: (call: grpc.ServerWritableStream<unknown, unknown>) => {
        if (call.metadata.get('authorization')[0] !== 'Bearer example-secret')
          return call.destroy(new Error('missing auth'));
        call.write({});
      },
    }
  );
  let client: SingBoxApiClient | undefined;
  try {
    const port = await new Promise<number>((resolve, reject) =>
      server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, port) =>
        err ? reject(err) : resolve(port)
      )
    );
    const result = await new Promise<TailscaleEndpointStatus[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no official wire response')), 2000);
      client = new SingBoxApiClient({ host: '127.0.0.1', port }, 'example-secret', (status) => {
        clearTimeout(timer);
        resolve(status);
      });
      client.start();
    });
    expect(result[0]).toMatchObject({
      endpointTag: 'tailnet',
      authURL: 'https://login.example.test',
      self: { hostName: 'self', stableID: 'self-id' },
      userGroups: [
        {
          loginName: 'user@example.test',
          peers: [{ hostName: 'peer', stableID: 'exit-id', exitNodeOption: true }],
        },
      ],
      exitNode: { stableID: 'exit-id' },
    });
  } finally {
    client?.stop();
    await new Promise<void>((resolve) => server.tryShutdown(() => resolve()));
  }
});
