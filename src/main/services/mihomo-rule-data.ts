import { execFile } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import { readFile, mkdir, rename, writeFile, rm } from 'fs/promises';
import { join } from 'path';

const run = promisify(execFile);
const keys: Record<string, string> = {
  domain: 'DOMAIN',
  domain_suffix: 'DOMAIN-SUFFIX',
  domain_keyword: 'DOMAIN-KEYWORD',
  domain_regex: 'DOMAIN-REGEX',
  ip_cidr: 'IP-CIDR',
  source_ip_cidr: 'SRC-IP-CIDR',
  port: 'DST-PORT',
  port_range: 'DST-PORT',
  source_port: 'SRC-PORT',
  source_port_range: 'SRC-PORT',
  process_name: 'PROCESS-NAME',
  process_path: 'PROCESS-PATH',
  process_path_regex: 'PROCESS-PATH-REGEX',
  network: 'NETWORK',
};
function group(mode: 'AND' | 'OR', expressions: string[]): string {
  if (!expressions.length) throw new Error('Empty routing-data condition');
  return expressions.length === 1
    ? expressions[0]
    : `${mode},(${expressions.map((value) => `(${value})`).join(',')})`;
}
function convertRule(input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid routing-data rule');
  const rule = input as Record<string, unknown>;
  let expression: string;
  if (rule.type === 'logical') {
    if (
      Object.keys(rule).some((key) => !['type', 'mode', 'invert', 'rules'].includes(key)) ||
      !Array.isArray(rule.rules) ||
      !['and', 'or'].includes(String(rule.mode))
    )
      throw new Error('Unsupported logical routing-data rule');
    expression = group(rule.mode === 'and' ? 'AND' : 'OR', rule.rules.map(convertRule));
  } else {
    const domainsAndDestinationIps: string[] = [];
    const otherConditions: string[] = [];
    for (const [key, raw] of Object.entries(rule)) {
      if (key === 'invert' || (key === 'type' && raw === 'default')) continue;
      if (!keys[key]) throw new Error(`Unsupported routing-data field: ${key}`);
      const values = Array.isArray(raw) ? raw : [raw];
      const atoms = values.map((value) => {
        if (
          (typeof value !== 'string' && typeof value !== 'number') ||
          /[,\r\n]/.test(String(value))
        )
          throw new Error('Invalid routing-data value');
        const kind = key === 'ip_cidr' && String(value).includes(':') ? 'IP-CIDR6' : keys[key];
        return `${kind},${key.endsWith('port_range') ? String(value).replace(':', '-') : key === 'network' ? String(value).toUpperCase() : value}`;
      });
      if (['domain', 'domain_suffix', 'domain_keyword', 'domain_regex', 'ip_cidr'].includes(key))
        domainsAndDestinationIps.push(...atoms);
      else otherConditions.push(group('OR', atoms));
    }
    if (domainsAndDestinationIps.length)
      otherConditions.unshift(group('OR', domainsAndDestinationIps));
    expression = group('AND', otherConditions);
  }
  if (rule.invert !== undefined && typeof rule.invert !== 'boolean')
    throw new Error('Invalid routing-data inversion');
  return rule.invert ? `NOT,((${expression}))` : expression;
}

/** Fail on unrepresentable fields; never turn a narrowed rule into a broader match. */
export function convertSingBoxRuleData(input: unknown): { payload: string[] } {
  const document = input as { version?: unknown; rules?: unknown };
  if (
    !document ||
    ![1, 2, 3, 4].includes(Number(document.version)) ||
    !Array.isArray(document.rules)
  )
    throw new Error('Invalid routing-data document');
  return { payload: document.rules.map(convertRule) };
}

/** Preserve source .srs files; cache converted providers by content hash and converter revision. */
export async function prepareMihomoRuleData(
  source: string,
  singBoxBinary: string,
  directory: string
): Promise<string> {
  const content = await readFile(source);
  const digest = createHash('sha256').update('mihomo-classical-v1\0').update(content).digest('hex');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const output = join(directory, `${digest}.yaml`);
  try {
    await readFile(output);
    return output;
  } catch {
    /* first conversion */
  }
  const scratch = join(
    directory,
    `${digest}-${process.pid}-${Math.random().toString(36).slice(2)}.json`
  );
  const temporary = `${scratch}.yaml`;
  try {
    let json: unknown;
    if (content.subarray(0, 3).toString() === 'SRS') {
      await run(singBoxBinary, ['rule-set', 'decompile', '--output', scratch, source], {
        timeout: 15000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });
      json = JSON.parse(await readFile(scratch, 'utf8'));
    } else json = JSON.parse(content.toString('utf8'));
    await writeFile(temporary, JSON.stringify(convertSingBoxRuleData(json)), { mode: 0o600 });
    await rename(temporary, output);
    return output;
  } finally {
    await Promise.all([rm(scratch, { force: true }), rm(temporary, { force: true })]);
  }
}
