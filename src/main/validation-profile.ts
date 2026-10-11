import * as path from 'path';

/** Explicit native acceptance profile keeps fixtures and normal user data separate. */
export function resolveUserDataPath(appData: string, arguments_: readonly string[]): string {
  const prefixes = arguments_.filter((argument) => argument.startsWith('--validation-profile='));
  if (prefixes.length > 1) throw new Error('Only one validation profile is allowed');
  if (!prefixes.length) return path.join(appData, 'ShadowVPN-FlowZ');
  const profile = prefixes[0].slice('--validation-profile='.length);
  if (!path.isAbsolute(profile) || path.normalize(profile) === path.parse(profile).root)
    throw new Error('Validation profile must be an absolute non-root directory');
  return path.resolve(profile);
}
