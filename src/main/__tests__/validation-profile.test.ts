import * as path from 'path';
import { resolveUserDataPath } from '../validation-profile';
test('normal launches keep the existing independent product path', () => {
  expect(resolveUserDataPath('/tmp/appdata', ['electron', '--remote-debugging-port=9223'])).toBe(
    path.join('/tmp/appdata', 'ShadowVPN-FlowZ')
  );
});
test('explicit acceptance profile does not overlap the normal data directory', () => {
  expect(
    resolveUserDataPath('/tmp/appdata', ['--validation-profile=/tmp/isolated-shadow-test'])
  ).toBe('/tmp/isolated-shadow-test');
});
test('relative, root and ambiguous profile arguments cannot select a storage location', () => {
  for (const value of ['', '.', '/', 'relative'])
    expect(() => resolveUserDataPath('/tmp/appdata', [`--validation-profile=${value}`])).toThrow();
  expect(() =>
    resolveUserDataPath('/tmp/appdata', [
      '--validation-profile=/tmp/a',
      '--validation-profile=/tmp/b',
    ])
  ).toThrow();
});
