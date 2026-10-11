/** Installed application discovery; no shell interpolation, privileges or launching applications. */
import { execFile } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import type { InstalledApplication } from '../../shared/types/rules';
import { powershellPath } from '../utils/win-system32';

const exec = promisify(execFile);
const options = { timeout: 15_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true };
const macIconFiles = new Map<string, string>();
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function sharedWindowsDirectory(p: string): boolean {
  return /^[a-z]:\\(?:Windows(?:\\.*)?|Program Files(?: \(x86\))?|Program Files(?: \(x86\))?\\Common Files(?:\\.*)?|Users\\[^\\]+(?:\\(?:Desktop|Downloads|Documents|AppData\\(?:Local|Roaming|Local\\Temp)))?)$/i.test(
    p
  );
}

/** Never match an entire shared system directory or generic runtime by basename. */
export function applicationIdentity(
  name: string,
  location: string,
  platform: NodeJS.Platform,
  realLocation = location
): InstalledApplication {
  const api = platform === 'win32' ? path.win32 : path.posix;
  const roots = [...new Set([location, realLocation])];
  const valid = roots.every((p) => api.isAbsolute(p) && !/[\r\n\0]/.test(p));
  const bundle = valid && platform === 'darwin' && location.endsWith('.app');
  const runtime = /^(env|sh|bash|python[\d.]*|node|electron|java|flatpak|snap)(\.exe)?$/i;
  const executable = valid && !runtime.test(api.basename(realLocation));
  let directories: string[] = bundle ? roots : [];
  if (executable && platform === 'win32') {
    // Shortcuts point to a product directory. Exclude shared Windows/Program Files roots.
    directories = roots
      .map((p) => api.dirname(p))
      .filter((p) => !sharedWindowsDirectory(p) && p.split('\\').filter(Boolean).length >= 3)
      .map((p) => (/\\app-[\d.]+$/i.test(p) ? api.dirname(p) : p))
      .filter((p) => !sharedWindowsDirectory(p));
  }
  if (executable && platform === 'linux') {
    // /usr/bin and shared libraries cannot identify a product family; /opt/<product> can.
    directories = roots
      .filter((p) => /^\/opt\/[^/]+\//.test(p))
      .map((p) => p.split('/').slice(0, 3).join('/'));
  }
  const processPathRegex = [...new Set(directories)].map(
    (p) =>
      `${platform === 'win32' ? '(?i)' : ''}^${escapeRegex(p.replace(/[\\/]+$/, ''))}${platform === 'win32' ? '[\\\\/]' : '/'}`
  );
  return {
    id: `custom-installed-${createHash('sha256')
      .update(platform + ':' + (platform === 'win32' ? location.toLowerCase() : location))
      .digest('hex')
      .slice(0, 24)}`,
    name,
    path: location,
    processPaths: executable && !bundle ? roots : [],
    processPathRegex,
    coverage:
      bundle || processPathRegex.length ? 'bundle' : executable ? 'executable' : 'unsupported',
  };
}

async function scan(dir: string, suffix: string, depth: number): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const found: string[] = [];
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.name.endsWith(suffix)) found.push(file);
    else if (depth > 0 && entry.isDirectory() && !entry.name.startsWith('.')) {
      found.push(...(await scan(file, suffix, depth - 1)));
    }
  }
  return found;
}

export function macBundleIconCandidates(bundle: string, info: Record<string, unknown>): string[] {
  const names = [info.CFBundleIconFile, info.CFBundleIconName, 'AppIcon.icns'];
  return [
    ...new Set(
      names
        .filter(
          (name): name is string =>
            typeof name === 'string' &&
            !!name &&
            path.posix.basename(name) === name &&
            !name.includes('\\') &&
            !/[\r\n\0]/.test(name)
        )
        .flatMap((name) => (path.posix.extname(name) ? [name] : [`${name}.icns`, `${name}.png`]))
    ),
  ].map((name) => path.posix.join(bundle, 'Contents/Resources', name));
}

async function macApplications(): Promise<InstalledApplication[]> {
  const roots = ['/Applications', path.join(os.homedir(), 'Applications'), '/System/Applications'];
  const apps = (await Promise.all(roots.map((root) => scan(root, '.app', 2)))).flat();
  const results: InstalledApplication[] = [];
  // Bound subprocess concurrency; a large Applications directory must not exhaust descriptors.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, apps.length) }, async () => {
      while (next < apps.length) {
        const file = apps[next++];
        try {
          const { stdout } = await exec(
            '/usr/bin/plutil',
            ['-convert', 'json', '-o', '-', path.join(file, 'Contents/Info.plist')],
            options
          );
          const info = JSON.parse(stdout) as Record<string, unknown>;
          if (
            typeof info.CFBundleExecutable !== 'string' ||
            path.basename(info.CFBundleExecutable) !== info.CFBundleExecutable
          )
            continue;
          const executable = path.join(file, 'Contents/MacOS', info.CFBundleExecutable);
          await fs.access(executable, fs.constants.X_OK);
          const candidates = macBundleIconCandidates(file, info);
          for (const candidate of candidates) {
            if (
              await fs
                .access(candidate)
                .then(() => true)
                .catch(() => false)
            ) {
              macIconFiles.set(file, candidate);
              break;
            }
          }
          const real = await fs.realpath(file);
          const identity = applicationIdentity(
            [info.CFBundleDisplayName, info.CFBundleName].find(
              (v): v is string => typeof v === 'string' && !!v.trim()
            ) || path.basename(file, '.app'),
            file,
            'darwin',
            real
          );
          // Safari's WebKit network service lives outside its bundle and is shared with other apps.
          const realExecutable = await fs.realpath(executable);
          if (
            info.CFBundleIdentifier === 'com.apple.Safari' ||
            !realExecutable.startsWith(real + path.sep)
          ) {
            identity.coverage = 'unsupported';
            identity.processPaths = [];
            identity.processPathRegex = [];
          }
          results.push(identity);
        } catch {
          /* Removed, inaccessible, or incomplete bundle. */
        }
      }
    })
  );
  return results;
}

export function parseDesktopApplication(
  text: string,
  desktopFile: string
): InstalledApplication | undefined {
  const section = text.split(/^\[Desktop Entry\]\s*$/m)[1]?.split(/^\[/m)[0];
  if (!section || /^(Hidden|NoDisplay)=true\s*$/m.test(section)) return undefined;
  const name = /^Name=(.+)$/m.exec(section)?.[1]?.trim();
  const command = /^Exec=(.+)$/m.exec(section)?.[1]?.trim();
  if (!name || !command) return undefined;
  const executable = /^(?:"([^"]+)"|([^\s]+))/.exec(command);
  const location = executable?.[1] || executable?.[2] || '';
  // Bare command lookup is resolved against PATH by the caller, never executed.
  return applicationIdentity(name, location || desktopFile, 'linux');
}

async function linuxApplications(): Promise<InstalledApplication[]> {
  const dataDirs = process.env.XDG_DATA_DIRS?.split(':') ?? ['/usr/local/share', '/usr/share'];
  const roots = [
    path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'applications'),
    ...dataDirs.map((p) => path.join(p, 'applications')),
  ];
  const files = (await Promise.all(roots.map((root) => scan(root, '.desktop', 1)))).flat();
  const results: InstalledApplication[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    // XDG user entries override system entries, including Hidden=true tombstones.
    const desktopId = path.basename(file);
    if (seen.has(desktopId)) continue;
    seen.add(desktopId);
    const parsed = parseDesktopApplication(await fs.readFile(file, 'utf8').catch(() => ''), file);
    if (!parsed) continue;
    let location = parsed.path;
    if (!path.isAbsolute(location)) {
      for (const dir of (process.env.PATH || '/usr/bin:/bin').split(':')) {
        const candidate = path.join(dir, location);
        if (
          await fs.access(candidate, fs.constants.X_OK).then(
            () => true,
            () => false
          )
        ) {
          location = candidate;
          break;
        }
      }
    }
    const real = await fs.realpath(location).catch(() => location);
    const identity = applicationIdentity(parsed.name, location, 'linux', real);
    if (
      !(await fs.access(real, fs.constants.X_OK).then(
        () => true,
        () => false
      ))
    ) {
      identity.coverage = 'unsupported';
      identity.processPaths = [];
      identity.processPathRegex = [];
    }
    results.push(identity);
  }
  return results;
}

async function windowsApplications(): Promise<InstalledApplication[]> {
  // Start Menu shortcuts include per-user installations. COM only reads targets; never Run/Invoke-Item.
  const script = `$ErrorActionPreference='Stop'; $w=New-Object -ComObject WScript.Shell; $dirs=@([Environment]::GetFolderPath('StartMenu'),[Environment]::GetFolderPath('CommonStartMenu')); $items=@(foreach($d in $dirs){Get-ChildItem -LiteralPath $d -Filter *.lnk -Recurse -ErrorAction SilentlyContinue | ForEach-Object {$s=$w.CreateShortcut($_.FullName); if($s.TargetPath -match '\\.exe$' -and (Test-Path -LiteralPath $s.TargetPath)){[pscustomobject]@{Name=$_.BaseName;Path=$s.TargetPath}}}}); ConvertTo-Json -InputObject $items -Compress`;
  const { stdout } = await exec(
    powershellPath(),
    ['-NoProfile', '-NonInteractive', '-Command', script],
    options
  );
  const parsed = JSON.parse(stdout.replace(/^\uFEFF/, '')) as Array<{ Name: string; Path: string }>;
  return parsed
    .filter((p) => p.Name && p.Path)
    .map((p) => applicationIdentity(p.Name, p.Path, 'win32'));
}

const iconCache = new Map<string, { at: number; value?: string }>();
export async function attachApplicationIcons(
  applications: InstalledApplication[],
  readIcon: (file: string) => Promise<string | undefined>
): Promise<InstalledApplication[]> {
  let next = 0;
  const result = applications.map((application) => ({ ...application }));
  await Promise.all(
    Array.from({ length: Math.min(8, result.length) }, async () => {
      while (next < result.length) {
        const application = result[next++];
        try {
          application.iconDataUrl = await readIcon(application.path);
        } catch {
          /* Icon failures never hide an application or change routing coverage. */
        }
      }
    })
  );
  return result;
}

export async function listInstalledApplications(): Promise<InstalledApplication[]> {
  const apps =
    process.platform === 'darwin'
      ? await macApplications()
      : process.platform === 'win32'
        ? await windowsApplications()
        : process.platform === 'linux'
          ? await linuxApplications()
          : [];
  const catalogue = [...new Map(apps.map((a) => [a.id, a])).values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  return attachApplicationIcons(catalogue, readApplicationIcon);
}

/** Shared native icon reader for installed and observed applications. */
export async function readApplicationIcon(file: string): Promise<string | undefined> {
  const { app, nativeImage } = await import('electron');
  const cached = iconCache.get(file);
  if (cached && Date.now() - cached.at < 300_000) return cached.value;
  let icon: Electron.NativeImage | undefined;
  let bundleIcon = process.platform === 'darwin' ? macIconFiles.get(file) : undefined;
  if (!bundleIcon && process.platform === 'darwin' && file.endsWith('.app')) {
    try {
      const { stdout } = await exec(
        '/usr/bin/plutil',
        ['-convert', 'json', '-o', '-', path.join(file, 'Contents/Info.plist')],
        options
      );
      for (const candidate of macBundleIconCandidates(file, JSON.parse(stdout))) {
        if (
          await fs.access(candidate).then(
            () => true,
            () => false
          )
        ) {
          bundleIcon = candidate;
          break;
        }
      }
    } catch {
      /* Inaccessible bundle: use the native file icon. */
    }
  }
  if (bundleIcon) {
    try {
      if (path.extname(bundleIcon).toLowerCase() === '.icns') {
        // Electron's file-icon API can return generic .app icons; macOS ships an ICNS decoder.
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shadowvpn-app-icon-'));
        try {
          const png = path.join(directory, 'icon.png');
          await exec(
            '/usr/bin/sips',
            ['-s', 'format', 'png', '-Z', '32', bundleIcon, '--out', png],
            options
          );
          icon = nativeImage.createFromPath(png);
        } finally {
          await fs.rm(directory, { recursive: true, force: true });
        }
      } else icon = nativeImage.createFromPath(bundleIcon);
    } catch {
      /* Fall back to the native file icon without hiding the application. */
    }
  }
  if (!icon || icon.isEmpty()) icon = await app.getFileIcon(file, { size: 'normal' });
  const value = icon.isEmpty() ? undefined : icon.resize({ width: 32, height: 32 }).toDataURL();
  if (iconCache.size >= 512) iconCache.delete(iconCache.keys().next().value!);
  iconCache.set(file, { at: Date.now(), value });
  return value;
}
