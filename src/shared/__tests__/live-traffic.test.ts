import {
  createConnectionFlowSelector,
  connectionApplication,
  connectionFlows,
  connectionSankey,
  filterConnections,
  connectionOutbound,
  UNKNOWN_APPLICATION,
  UNKNOWN_DESTINATION,
  UNKNOWN_OUTBOUND,
} from '../live-traffic';
import type { ConnectionEntry } from '../types';
const connection = (id: string, host?: string): ConnectionEntry => ({
  id,
  chains: [],
  rule: '',
  rulePayload: '',
  metadata: { host },
});
describe('complete application scope', () => {
  it('groups observed runtime bundles, system processes and missing identities without an installed catalog', () => {
    const paths = [
      '/Users/example/project/node_modules/electron/Electron.app/Contents/MacOS/Electron',
      '/Users/example/Library/Caches/browser/Nightly.app/Contents/MacOS/firefox',
      '/System/Library/Frameworks/Example/apsd',
      '/usr/bin/example',
      'C:\\Windows\\System32\\svchost.exe',
      undefined,
    ];
    const conns = paths.map((processPath, index) => ({
      ...connection(String(index), 'example.com'),
      metadata: { processPath },
      outbound: 'direct',
    }));
    const flows = connectionFlows(conns, 'application');
    expect(flows.reduce((total, flow) => total + flow.count, 0)).toBe(conns.length);
    expect(flows.map((flow) => flow.name)).toEqual(
      expect.arrayContaining([
        'Electron',
        'Nightly',
        'apsd',
        'example',
        'svchost.exe',
        UNKNOWN_APPLICATION,
      ])
    );
    const graph = connectionSankey(flows, 'device');
    expect(graph.nodes[0].value).toBe(conns.length);
    expect(filterConnections(conns, 'apsd')).toHaveLength(1);
  });
});
describe('complete connection routes', () => {
  it('does not discard targets after the fifteenth and preserves unnamed connections', () => {
    const conns = [
      ...Array.from({ length: 40 }, (_, i) => ({
        ...connection(String(i), `target-${i}.example.com`),
        outbound: `node-${i % 3}`,
      })),
      connection('unknown'),
    ];
    const flows = connectionFlows(conns, 'domain');
    expect(flows).toHaveLength(41);
    expect(flows.reduce((n, f) => n + f.count, 0)).toBe(41);
    expect(flows.some((f) => f.name === UNKNOWN_DESTINATION)).toBe(true);
    expect(flows.some((f) => f.name === 'target-39.example.com')).toBe(true);
  });
  it('groups nested helpers by the actual outer bundle; same names in other paths stay distinct', () => {
    const paths = [
      '/Applications/Example.app/Contents/MacOS/Main',
      '/Applications/Example.app/Contents/Frameworks/Helper.app/Contents/MacOS/Helper',
      '/Applications/Other.app/Contents/Frameworks/Helper.app/Contents/MacOS/Helper',
    ];
    const flows = connectionFlows(
      paths.map((processPath, i) => ({
        ...connection(String(i)),
        metadata: { processPath },
        outbound: 'direct',
      })),
      'application'
    );
    expect(flows.map((f) => [f.name, f.count])).toEqual([
      ['Example', 2],
      ['Other', 1],
    ]);
    const shared = [
      connection('no-process'),
      ...['/opt/a/helper', '/opt/b/helper'].map((processPath, i) => ({
        ...connection(String(i)),
        metadata: { processPath },
      })),
    ];
    expect(connectionFlows(shared, 'application')).toHaveLength(3);
    expect(connectionApplication(shared[0]).name).toBe(UNKNOWN_APPLICATION);
  });
  it('keeps actual outbound and whole fallback chains, without inventing Direct', () => {
    const c = { ...connection('x'), chains: ['selector', 'node'], outbound: 'actual-node' };
    expect(connectionOutbound(c)).toBe('actual-node');
    expect(connectionOutbound({ ...c, outbound: undefined })).toBe('selector → node');
    expect(connectionOutbound(connection('x'))).toBe(UNKNOWN_OUTBOUND);
    expect(connectionFlows([c, { ...c, id: 'y', outbound: 'direct' }], 'domain')).toHaveLength(2);
  });
});

it('shared exits and split application routes conserve counts without merging identical display names', () => {
  const connections = [
    ...Array.from({ length: 24 }, (_, i) => ({
      ...connection(String(i), 'example.com'),
      metadata: { processPath: '/opt/a/helper' },
      outbound: 'node',
    })),
    { ...connection('direct'), metadata: { processPath: '/opt/a/helper' }, outbound: 'direct' },
    { ...connection('other'), metadata: { processPath: '/opt/b/helper' }, outbound: 'node' },
  ];
  const graph = connectionSankey(connectionFlows(connections, 'application'), 'Device');
  expect(graph.nodes.filter((n) => n.depth === 1).map((n) => [n.name, n.value])).toEqual([
    ['helper', 25],
    ['helper', 1],
  ]);
  expect(
    graph.nodes
      .filter((n) => n.depth === 2)
      .map((n) => [n.name, n.value])
      .sort()
  ).toEqual([
    ['direct', 1],
    ['node', 25],
  ]);
  const count = (id: string, side: 'source' | 'target') =>
    graph.links.filter((l) => l[side] === id).reduce((sum, l) => sum + l.value, 0);
  for (const node of graph.nodes) {
    if (node.depth > 0) expect(count(node.id, 'target')).toBe(node.value);
    if (node.depth < 2) expect(count(node.id, 'source')).toBe(node.value);
  }
  expect(graph.nodes[0].value).toBe(connections.length);
});
it('search matches actual paths, application names, rules, target ports and translated outbounds before pagination', () => {
  const connections = [
    {
      ...connection('a', 'API.example.com'),
      metadata: {
        host: 'API.example.com',
        processPath: '/Applications/Example.app/Contents/MacOS/Main',
        destinationPort: '443',
      },
      outbound: 'direct',
      chains: ['selector'],
      rule: 'rule_set=geoip-cn',
    },
    {
      ...connection('b', 'other.example.com'),
      metadata: { host: 'other.example.com', processPath: '/opt/other' },
      outbound: 'node',
    },
  ];
  for (const query of ['example.app API', 'DIRECT 443', 'SELECTOR geoip', '直连']) {
    expect(
      filterConnections(connections, query, [], (value) =>
        value === 'direct' ? '直连' : value
      ).map((c) => c.id)
    ).toEqual(['a']);
  }
  expect(filterConnections(connections, '不存在')).toEqual([]);
  expect(filterConnections(connections, '   ')).toBe(connections);
});

it('reuses graph bands for byte updates and updates counts/routes/catalogue names', () => {
  const select = createConnectionFlowSelector();
  const first = {
    ...connection('one'),
    outbound: 'direct',
    metadata: { processPath: '/Applications/Example.app/Contents/MacOS/Example' },
  };
  const flows = select([first], []);
  expect(select([{ ...first, download: 200 }], [])).toBe(flows);
  const changed = select([first, { ...first, id: 'two' }], []);
  expect(changed).not.toBe(flows);
  expect(changed[0].count).toBe(2);
  expect(select([{ ...first, outbound: 'proxy' }], [])[0].outbound).toBe('proxy');
  const app = {
    id: 'app',
    name: 'Renamed',
    path: '/Applications/Example.app',
    processPaths: [],
    processPathRegex: [],
    coverage: 'bundle' as const,
  };
  expect(select([first], [app])[0].name).toBe('Renamed');
  expect(select([], [])).toEqual([]);
});

it('uses the OS name or PID when the executable path is inaccessible without guessing an installed app', () => {
  const row = connection('missing-path');
  row.metadata = { processId: 42, processName: 'Example Helper' };
  expect(connectionApplication(row)).toEqual({
    identity: '\u0000process:42',
    name: 'Example Helper',
  });
  row.metadata.processName = undefined;
  expect(connectionApplication(row)).toEqual({ identity: '\u0000process:42', name: 'PID 42' });
  row.metadata = {};
  expect(connectionApplication(row).identity).toBe(UNKNOWN_APPLICATION);
});
