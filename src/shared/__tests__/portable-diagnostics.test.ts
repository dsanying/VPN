import { PortableDiagnostics } from '../portable-diagnostics';
import { createDefaultConfig } from '../config-defaults';

function fixture() {
  const config = createDefaultConfig('fixture-secret');
  config.servers = [
    {
      id: 'node-1',
      name: 'Private Node',
      address: 'private-node.example.com',
      port: 443,
      protocol: 'vless',
      uuid: '00000000-0000-4000-8000-000000000001',
    },
  ];
  const host = {
    clientInfo: jest.fn(async () => ({
      appVersion: '0.1.0',
      singBoxVersion: '1.14.3',
      platform: 'android',
      arch: 'arm64',
      osVersion: '15',
    })),
    exportDocument: jest.fn(async (_options: { name: string; content: string }) => ({
      canceled: false,
    })),
  };
  const diagnostics = new PortableDiagnostics(
    { read: async () => config },
    { snapshot: () => ({ running: true, busy: false }) },
    {
      read: async () => [
        {
          timestamp: '2026-10-11T00:00:00Z',
          level: 'error',
          source: '内核',
          message: 'private-node.example.com password=fixture-secret ``` error',
          stack: 'Private Node token=private-token',
        },
      ],
    },
    host
  );
  return { diagnostics, host, config };
}

test('exports real version and state facts with sanitized logs and no raw node configuration', async () => {
  const { diagnostics, host, config } = fixture();
  const original = JSON.stringify(config);
  expect(await diagnostics.export()).toEqual({ success: true });
  const document = host.exportDocument.mock.calls[0][0];
  expect(document.name).toMatch(/^shadowvpn-diagnostic-\d{4}-\d{2}-\d{2}\.md$/);
  expect(document.content).toContain('1.14.3');
  expect(document.content).toContain('android arm64 15');
  expect(document.content).toContain('serverCount');
  for (const secret of [
    'fixture-secret',
    'private-token',
    'private-node.example.com',
    'Private Node',
    config.servers[0].uuid!,
  ])
    expect(document.content).not.toContain(secret);
  expect(document.content).toContain('````');
  expect(JSON.stringify(config)).toBe(original);
});

test('native picker cancellation is not reported as a successful export', async () => {
  const { diagnostics, host } = fixture();
  host.exportDocument.mockResolvedValueOnce({ canceled: true });
  expect(await diagnostics.export()).toEqual({ success: false, error: 'cancelled' });
});

test('native write failures propagate without a success result', async () => {
  const { diagnostics, host } = fixture();
  host.exportDocument.mockRejectedValueOnce(new Error('Document provider refused write'));
  await expect(diagnostics.export()).rejects.toThrow('refused write');
});
