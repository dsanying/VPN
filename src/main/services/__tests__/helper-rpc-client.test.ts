import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  requestHelper,
  waitForHelperProcessExit,
  waitForHelperStopped,
} from '../helper-rpc-client';
import { spawn } from 'child_process';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-rpc-test-'));
const socketPath =
  process.platform === 'win32'
    ? `\\\\.\\pipe\\shadow-rpc-test-${process.pid}`
    : path.join(directory, 'helper.sock');
let server: http.Server;
let respond: (req: http.IncomingMessage, res: http.ServerResponse) => void;

beforeAll(async () => {
  server = http.createServer((req, res) => respond(req, res));
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(directory, { force: true, recursive: true });
});

it('uses JSON-RPC 2.0 with Bearer authorization and preserves path newlines', async () => {
  respond = (req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const message = JSON.parse(body);
      expect(req.url).toBe('/rpc');
      expect(req.headers.authorization).toBe('Bearer test-token');
      expect(message.jsonrpc).toBe('2.0');
      expect(message.params).toEqual(['path\nwith newline']);
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: { state: 'pong', uid: 0, version: '0.1.0', capabilities: ['start'] },
        })
      );
    });
  };
  await expect(
    requestHelper(socketPath, 'test-token', 'ping', ['path\nwith newline'], 1000)
  ).resolves.toMatchObject({ uid: 0, capabilities: ['start'] });
});

it('reports HTTP authentication errors', async () => {
  respond = (_req, res) => {
    res.writeHead(401);
    res.end('unauthorized');
  };
  await expect(requestHelper(socketPath, 'wrong', 'ping', [], 1000)).rejects.toThrow('401');
});

it('times out a valid JSON response with the wrong request ID', async () => {
  respond = (_req, res) =>
    res.end(JSON.stringify({ jsonrpc: '2.0', id: 'wrong', result: { state: 'pong' } }));
  await expect(requestHelper(socketPath, null, 'ping', [], 80)).rejects.toThrow();
});

it('rejects oversized responses', async () => {
  respond = (_req, res) => res.end('x'.repeat(70000));
  await expect(requestHelper(socketPath, null, 'ping', [], 1000)).rejects.toThrow('too large');
});

it('confirms an actual child exit before reporting stopped', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  const pid = child.pid!;
  expect(await waitForHelperProcessExit(pid, 60)).toBe(false);
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill();
  await exited;
  expect(await waitForHelperProcessExit(pid, 1000)).toBe(true);
});

it('进程退出后继续等待系统状态善后，不把 stopping 当完成', async () => {
  const status = jest
    .fn()
    .mockResolvedValueOnce('OK stopping 1')
    .mockResolvedValueOnce('OK stopping 1')
    .mockResolvedValue('OK stopped');
  await expect(waitForHelperStopped(status, 1000)).resolves.toBe(true);
  expect(status).toHaveBeenCalledTimes(3);
});
it('状态始终 stopping 时诚实返回失败', async () => {
  await expect(waitForHelperStopped(async () => 'OK stopping 1', 60)).resolves.toBe(false);
});
