import * as path from 'path';

/** Explicit native acceptance profile keeps fixtures and normal user data separate. */
export function resolveUserDataPath(appData: string, arguments_: readonly string[]): string {
  const prefixes = arguments_.filter((argument) => argument.startsWith('--validation-profile='));
  if (prefixes.length > 1) throw new Error('Only one validation profile is allowed');
  if (!prefixes.length) return path.join(appData, 'ShadowVPN');
  const profile = prefixes[0].slice('--validation-profile='.length);
  const resolved = path.resolve(profile);
  if (!path.isAbsolute(profile) || resolved === path.parse(resolved).root)
    throw new Error('Validation profile must be an absolute non-root directory');
  if (process.platform === 'win32' && !/^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/i.test(profile))
    throw new Error('Validation profile must include a drive or network share');
  return resolved;
}

/** Disposable acceptance profiles must never rebind the machine's persistent service. */
export function assertPersistentHelperProfile(arguments_: readonly string[] = process.argv): void {
  if (arguments_.some((argument) => argument.startsWith('--validation-profile=')))
    throw new Error('隔离验收模式不能安装、修复或卸载系统助手；请在正常配置中管理助手');
}
