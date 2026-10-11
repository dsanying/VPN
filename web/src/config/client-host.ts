/** Installed before React mounts. Controls represent capabilities of the actual native host. */
export interface ClientHostCapabilities {
  platform: 'desktop' | 'android';
  desktopHelper: boolean;
  loginAutostart: boolean;
  tray: boolean;
  failover: boolean;
  bundledCore: boolean;
}
let current: ClientHostCapabilities = {
  platform: 'desktop',
  desktopHelper: true,
  loginAutostart: true,
  tray: true,
  failover: true,
  bundledCore: false,
};
export function clientHost(): Readonly<ClientHostCapabilities> {
  return current;
}
export function installClientHost(value: ClientHostCapabilities): void {
  current = Object.freeze({ ...value });
}
