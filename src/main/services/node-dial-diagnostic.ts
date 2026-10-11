import type { ServerConfig } from '../../shared/types';
/** Retain only a known dial error for an exact node endpoint; never persist raw core output. */
export function nodeDialDiagnostic(output: string, node: ServerConfig): string | undefined {
  const host = node.address.includes(':') ? `[${node.address}]` : node.address;
  const endpoint = `${host}:${node.port}`;
  const codes = new Set<string>();
  for (const line of output.split('\n')) {
    if (!line.includes(`dial tcp ${endpoint}: `)) continue;
    if (line.includes('no route to host')) codes.add('EHOSTUNREACH');
    else if (line.includes('network is unreachable')) codes.add('ENETUNREACH');
    else if (line.includes('connection refused')) codes.add('ECONNREFUSED');
    else if (line.includes('i/o timeout')) codes.add('ETIMEDOUT');
  }
  // Differing errors are retained as separate tunnel results rather than guessed.
  return codes.size === 1 ? [...codes][0] : undefined;
}
