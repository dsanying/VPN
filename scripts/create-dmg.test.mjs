import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDmg } from './create-dmg.mjs';

const busy = { status: 1, stderr: 'hdiutil: create failed - Resource busy' };
test('transient contention retries identical arguments and returns actual success', async () => {
  const calls = [], delays = [];
  const args = ['-srcfolder', '/fixture', '-ov', '/fixture.dmg'];
  const output = await createDmg(args, {
    run: (command, parameters) => { calls.push([command, parameters]); return calls.length < 3 ? busy : { status: 0, stdout: 'created: /fixture.dmg' }; },
    wait: async delay => { delays.push(delay); },
  });
  assert.equal(output, 'created: /fixture.dmg');
  assert.deepEqual(calls, Array.from({ length: 3 }, () => ['hdiutil', ['create', ...args]]));
  assert.deepEqual(delays, [2000, 4000]);
});
test('persistent contention fails after three attempts', async () => {
  let calls = 0;
  await assert.rejects(createDmg([], { run: () => { calls++; return busy; }, wait: async () => {} }), /Resource busy/);
  assert.equal(calls, 3);
});
test('unrelated hdiutil errors and executable errors never retry', async () => {
  for (const result of [{ status: 1, stderr: 'No space left on device' }, { error: new Error('ENOENT') }]) {
    let calls = 0;
    await assert.rejects(createDmg([], { run: () => { calls++; return result; }, wait: async () => assert.fail('unexpected retry') }));
    assert.equal(calls, 1);
  }
});
