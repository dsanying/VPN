import { EnterpriseEngine } from '../EnterpriseEngine';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
const testUnix = process.platform === 'win32' ? test.skip : test;
testUnix(
  'a script bridge dying after readiness stops the engine and reports exit exactly once',
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'enterprise-engine-test-'));
    const engine = new EnterpriseEngine(dir, true);
    try {
      const runtime = Buffer.from('fictional runtime');
      const auth = Buffer.from(
        `#!${process.execPath}\nprocess.stdin.once('data',()=>{console.log(JSON.stringify({type:'ready',port:Number(process.env.SHADOW_BRIDGE_PORT)}));setTimeout(()=>console.log(JSON.stringify({type:'error',stage:'tunnel-exit'})),50);});setInterval(()=>{},1000);\n`
      );
      writeFileSync(join(dir, 'enterprise-runtime'), runtime);
      writeFileSync(join(dir, 'openconnect'), 'fixture');
      writeFileSync(join(dir, 'openconnect-auth'), auth, { mode: 0o755 });
      writeFileSync(
        join(dir, 'enterprise-runtime-manifest.json'),
        JSON.stringify({
          tlsVerification: true,
          sha256: createHash('sha256').update(runtime).digest('hex'),
          authSha256: createHash('sha256').update(auth).digest('hex'),
        })
      );
      let exited!: () => void;
      const exit = new Promise<void>((resolve) => {
        exited = resolve;
      });
      const onExit = jest.fn(() => exited());
      await engine.start(
        {
          id: 'fictional',
          name: 'Fixture',
          gateway: 'https://example.com/',
          protocol: 'anyconnect',
          username: 'fictional',
          password: 'fictional',
          hasPassword: true,
          updatedAt: new Date().toISOString(),
        },
        () => {},
        onExit
      );
      await exit;
      await engine.stop();
      expect(onExit).toHaveBeenCalledTimes(1);
    } finally {
      await engine.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  }
);
