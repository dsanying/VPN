import { createServer } from 'net';
import { allocateCompatibilityPort } from '../CompatibilityCoreService';

jest.mock('net', () => ({ createServer: jest.fn() }));

function ports(sequence: number[]) {
  let index = 0;
  (createServer as jest.Mock).mockImplementation(() => ({
    once: jest.fn(),
    listen: (_port: number, _host: string, ready: () => void) => ready(),
    address: () => ({ port: sequence[Math.min(index++, sequence.length - 1)] }),
    close: (done: (error?: Error) => void) => done(),
  }));
}

test('closed probe reuse cannot alias another pending compatibility listener', async () => {
  ports([19001, 19001, 19002]);
  const reserved = new Set<number>();
  expect(await allocateCompatibilityPort(reserved)).toBe(19001);
  expect(await allocateCompatibilityPort(reserved)).toBe(19002);
  expect(reserved).toEqual(new Set([19001, 19002]));
});

test('repeated excluded ports fail within a bounded allocation attempt', async () => {
  ports([19001]);
  await expect(allocateCompatibilityPort(new Set([19001]))).rejects.toThrow('distinct');
});
