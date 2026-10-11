import { convertSingBoxRuleData, prepareMihomoRuleData } from '../mihomo-rule-data';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';

const platform =
  process.platform === 'darwin'
    ? process.arch === 'arm64'
      ? 'mac-arm64'
      : 'mac-x64'
    : process.platform === 'win32'
      ? 'win'
      : 'linux';
const binary = (name: string) =>
  resolve(
    __dirname,
    '../../../../resources',
    platform,
    name + (process.platform === 'win32' ? '.exe' : '')
  );

it('preserves headless domain/IP OR semantics and other field intersections', () => {
  expect(
    convertSingBoxRuleData({
      version: 3,
      rules: [{ domain_suffix: ['example.com'], ip_cidr: ['2001:db8::/32'], port: [443] }],
    })
  ).toEqual({
    payload: ['AND,((OR,((DOMAIN-SUFFIX,example.com),(IP-CIDR6,2001:db8::/32))),(DST-PORT,443))'],
  });
  expect(() =>
    convertSingBoxRuleData({ version: 3, rules: [{ source_mac_address: ['00:00:00:00:00:01'] }] })
  ).toThrow('Unsupported');
});

it('decompiles a real SRS, preserves it, caches by content, and passes the native provider gate', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'shadowvpn-rule-convert-'));
  try {
    const json = join(directory, 'source.json'),
      srs = join(directory, 'source.srs');
    const source = {
      version: 3,
      rules: [
        { domain_suffix: ['example.com'], ip_cidr: ['192.0.2.0/24'] },
        {
          type: 'logical',
          mode: 'and',
          invert: true,
          rules: [{ domain: ['fixture.example.net'] }, { port: [443] }],
        },
      ],
    };
    writeFileSync(json, JSON.stringify(source));
    execFileSync(binary('sing-box'), ['rule-set', 'compile', '--output', srs, json], {
      timeout: 10000,
      stdio: 'pipe',
    });
    const before = readFileSync(srs);
    const converted = await prepareMihomoRuleData(
      srs,
      binary('sing-box'),
      join(directory, 'converted')
    );
    expect(readFileSync(srs)).toEqual(before);
    expect(JSON.parse(readFileSync(converted, 'utf8'))).toEqual(convertSingBoxRuleData(source));
    expect(await prepareMihomoRuleData(srs, binary('sing-box'), join(directory, 'converted'))).toBe(
      converted
    );
    const config = join(directory, 'mihomo.json');
    writeFileSync(
      config,
      JSON.stringify({
        'rule-providers': {
          fixture: { type: 'file', behavior: 'classical', format: 'yaml', path: converted },
        },
        rules: ['RULE-SET,fixture,DIRECT', 'MATCH,REJECT'],
      })
    );
    execFileSync(binary('mihomo'), ['-t', '-d', directory, '-f', config], {
      timeout: 10000,
      stdio: 'pipe',
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
