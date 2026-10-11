import * as os from 'os';
import * as path from 'path';
import { resolveUserDataPath, assertPersistentHelperProfile } from '../validation-profile';
test('normal launches keep the existing independent product path', () => {
  expect(resolveUserDataPath('/tmp/appdata', ['electron', '--remote-debugging-port=9223'])).toBe(
    path.join('/tmp/appdata', 'ShadowVPN-FlowZ')
  );
});
test('explicit acceptance profile does not overlap the normal data directory', () => {
  const profile = path.join(os.tmpdir(), 'isolated-shadow-test');
  expect(resolveUserDataPath(os.tmpdir(), [`--validation-profile=${profile}`])).toBe(profile);
});
test('relative, root and ambiguous profile arguments cannot select a storage location', () => {
  for (const value of ['', '.', '/', 'relative', path.parse(path.resolve(os.tmpdir())).root])
    expect(() => resolveUserDataPath('/tmp/appdata', [`--validation-profile=${value}`])).toThrow();
  expect(() =>
    resolveUserDataPath('/tmp/appdata', [
      '--validation-profile=/tmp/a',
      '--validation-profile=/tmp/b',
    ])
  ).toThrow();
});

test('isolated acceptance cannot replace the persistent privileged service', () => {
  expect(() =>
    assertPersistentHelperProfile(['electron', '--validation-profile=/tmp/isolated'])
  ).toThrow('隔离验收模式');
  expect(() =>
    assertPersistentHelperProfile(['electron', '--remote-debugging-port=9223'])
  ).not.toThrow();
});
