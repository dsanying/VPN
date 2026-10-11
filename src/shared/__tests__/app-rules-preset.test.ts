import { getAppPreset } from '../app-rules-preset';
import type { CustomAppPreset } from '../types';

it('does not provide implicit website/service application presets', () => {
  expect(getAppPreset('youtube')).toBeUndefined();
  expect(getAppPreset('telegram')).toBeUndefined();
});
it('preserves actual process identity and never supplies website or process-name guesses', () => {
  const app = {
    id: 'installed',
    name: 'Example',
    emoji: '',
    processPaths: ['/opt/example/bin/example'],
    processPathRegex: ['^/opt/example/'],
    processNames: ['guessed'],
    geositeTags: ['youtube'],
    geoipTags: ['us'],
  } as CustomAppPreset;
  expect(getAppPreset('installed', [app])).toMatchObject({
    processPaths: app.processPaths,
    processPathRegex: app.processPathRegex,
  });
  expect(getAppPreset('installed', [app])).not.toHaveProperty('geositeTags');
  expect(getAppPreset('installed', [app])).not.toHaveProperty('geoipTags');
  expect(getAppPreset('installed', [app])).not.toHaveProperty('processNames');
});
