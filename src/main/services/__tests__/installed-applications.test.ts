import {
  applicationIdentity,
  parseDesktopApplication,
  macBundleIconCandidates,
} from '../InstalledApplications';
import { applicationProcessMatchers } from '../../../shared/application-matching';
import { getAppPreset } from '../../../shared/app-rules-preset';

const matches = (patterns: string[], value: string) =>
  patterns.some((p) =>
    new RegExp(p.replace(/^\(\?i\)/, ''), p.startsWith('(?i)') ? 'i' : '').test(value)
  );

describe('installed application identities', () => {
  it('covers the main executable and nested helpers without matching another Electron bundle', () => {
    const app = applicationIdentity('Example', '/Applications/Example [1]+.app', 'darwin');
    expect(
      matches(app.processPathRegex, '/Applications/Example [1]+.app/Contents/MacOS/Example')
    ).toBe(true);
    expect(
      matches(
        app.processPathRegex,
        '/Applications/Example [1]+.app/Contents/Frameworks/Helper.app/Contents/MacOS/Helper'
      )
    ).toBe(true);
    expect(
      matches(
        app.processPathRegex,
        '/Applications/Other.app/Contents/Frameworks/Helper.app/Contents/MacOS/Helper'
      )
    ).toBe(false);
    expect(
      matches(app.processPathRegex, '/Applications/Example [1]+.app.backup/Contents/MacOS/Example')
    ).toBe(false);
    expect(app.processPaths).toEqual([]);
  });
  it('covers both symlink and canonical bundle locations, keeping a stable ID', () => {
    const first = applicationIdentity(
      'Example',
      '/Applications/Example.app',
      'darwin',
      '/opt/example/1/Example.app'
    );
    const next = applicationIdentity(
      'Example',
      '/Applications/Example.app',
      'darwin',
      '/opt/example/2/Example.app'
    );
    expect(first.id).toBe(next.id);
    expect(
      matches(next.processPathRegex, '/opt/example/2/Example.app/Contents/MacOS/Example')
    ).toBe(true);
    expect(next.id.startsWith('custom-')).toBe(true);
  });
  it('covers Windows versioned helpers case-insensitively but not a sibling product', () => {
    const app = applicationIdentity(
      'Example',
      'C:\\Users\\Test\\AppData\\Local\\Example\\app-1.2.3\\Example.exe',
      'win32'
    );
    expect(
      matches(
        app.processPathRegex,
        'c:\\users\\test\\appdata\\local\\example\\app-2.0.0\\Helper.exe'
      )
    ).toBe(true);
    expect(
      matches(app.processPathRegex, 'C:\\Users\\Test\\AppData\\Local\\Other\\Helper.exe')
    ).toBe(false);
    expect(
      matches(app.processPathRegex, 'C:\\Users\\Test\\AppData\\Local\\ExampleTwo\\Helper.exe')
    ).toBe(false);
  });
  it.each([
    'C:\\Windows\\System32\\example.exe',
    'C:\\Program Files\\example.exe',
    'C:\\Users\\Test\\Desktop\\example.exe',
    'C:\\Users\\Test\\AppData\\Local\\app-1.2.3\\Example.exe',
    'C:\\Program Files\\Common Files\\Example\\example.exe',
  ])('never broadens shared directories: %s', (file) => {
    expect(applicationIdentity('Example', file, 'win32').processPathRegex).toEqual([]);
  });
  it('keeps Linux shared-bin applications exact and covers dedicated /opt helpers', () => {
    expect(applicationIdentity('Example', '/usr/bin/example', 'linux').processPathRegex).toEqual(
      []
    );
    const app = applicationIdentity('Example', '/opt/example/bin/example', 'linux');
    expect(matches(app.processPathRegex, '/opt/example/lib/helper')).toBe(true);
    expect(matches(app.processPathRegex, '/opt/other/lib/helper')).toBe(false);
  });
  it.each([
    '/usr/bin/flatpak',
    '/usr/bin/snap',
    '/usr/bin/env',
    '/usr/bin/node',
    '/usr/bin/python3',
  ])('rejects generic launchers instead of routing all their users: %s', (file) => {
    expect(applicationIdentity('Example', file, 'linux').coverage).toBe('unsupported');
  });
  it('reads desktop names and quoted executable paths without executing arguments', () => {
    const app = parseDesktopApplication(
      '[Desktop Entry]\nName=Example\nExec="/opt/example dir/bin/example" --url %U\n[Desktop Action Run]\nExec=/usr/bin/other',
      '/usr/share/applications/example.desktop'
    );
    expect(app?.path).toBe('/opt/example dir/bin/example');
    expect(app?.name).toBe('Example');
    expect(
      parseDesktopApplication(
        '[Desktop Entry]\nName=Hidden\nExec=/usr/bin/example\nHidden=true',
        '/example.desktop'
      )
    ).toBeUndefined();
  });
  it('passes installed identities through presets and emits separate OR legs', () => {
    const app = applicationIdentity('Example', '/opt/example/bin/example', 'linux');
    const preset = getAppPreset(app.id, [
      {
        id: app.id,
        name: app.name,
        emoji: '',
        geositeTags: [],
        processPaths: app.processPaths,
        processPathRegex: app.processPathRegex,
      },
    ]);
    expect(applicationProcessMatchers(preset!)).toEqual([
      { process_path: ['/opt/example/bin/example'] },
      { process_path_regex: ['^/opt/example/'] },
    ]);
  });
});

describe('local application icons', () => {
  it('keeps failed icon lookups in the catalogue and bounds native work', async () => {
    const { attachApplicationIcons } = await import('../InstalledApplications');
    const applications = Array.from({ length: 21 }, (_, i) =>
      applicationIdentity(`Example ${i}`, `/Applications/Example${i}.app`, 'darwin')
    );
    let active = 0;
    let peak = 0;
    const result = await attachApplicationIcons(applications, async (file) => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setImmediate(resolve));
      active--;
      if (file === applications[0].path) throw new Error('example icon lookup failure');
      return 'data:image/png;base64,example';
    });
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
    expect(result.map((a) => a.id)).toEqual(applications.map((a) => a.id));
    expect(result[0].iconDataUrl).toBeUndefined();
    expect(result.slice(1).every((a) => a.iconDataUrl)).toBe(true);
    expect(applications.every((a) => !a.iconDataUrl)).toBe(true);
  });
});

it('reads only named bundle icon resources and rejects metadata path traversal', () => {
  expect(
    macBundleIconCandidates('/Applications/Example.app', {
      CFBundleIconFile: 'Example',
      CFBundleIconName: 'Alternate.png',
    })
  ).toEqual([
    '/Applications/Example.app/Contents/Resources/Example.icns',
    '/Applications/Example.app/Contents/Resources/Example.png',
    '/Applications/Example.app/Contents/Resources/Alternate.png',
    '/Applications/Example.app/Contents/Resources/AppIcon.icns',
  ]);
  expect(
    macBundleIconCandidates('/Applications/Example.app', {
      CFBundleIconFile: '../../secret.png',
      CFBundleIconName: '/private/secret.icns',
    })
  ).toEqual(['/Applications/Example.app/Contents/Resources/AppIcon.icns']);
});
