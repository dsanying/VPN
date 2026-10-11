import { registerPlugin } from '@capacitor/core';
import { connectMobileRuntime, type MobileBusinessHost } from './remote-runtime';

/** UI connection only; the native application owns the shared business runtime. */
export function createMobileRuntime() {
  return connectMobileRuntime(registerPlugin<MobileBusinessHost>('ShadowVpn'));
}
