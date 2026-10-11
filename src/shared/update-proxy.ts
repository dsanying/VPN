/** Automatic update routing uses a live owned proxy entry, otherwise direct networking. */
export function resolveUpdateProxyTarget(
  proxyRunning: boolean,
  updateInPort: number | null | undefined
): { viaProxy: boolean; port: number } {
  const port =
    typeof updateInPort === 'number' &&
    Number.isInteger(updateInPort) &&
    updateInPort > 0 &&
    updateInPort <= 65535
      ? updateInPort
      : 0;
  return { viaProxy: proxyRunning && port > 0, port };
}
