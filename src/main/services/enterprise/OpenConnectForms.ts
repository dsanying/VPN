import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { EnterpriseAuthField, EnterpriseDetection } from '../../../shared/enterprise-vpn';
export function openConnectAuthBinary(directory: string): string {
  const binary = join(directory, 'openconnect-auth');
  const manifest = JSON.parse(
    readFileSync(join(directory, 'enterprise-runtime-manifest.json'), 'utf8')
  );
  if (
    !manifest.authSha256 ||
    createHash('sha256').update(readFileSync(binary)).digest('hex') !== manifest.authSha256
  )
    throw new Error('OpenConnect 认证适配器完整性校验失败');
  return binary;
}
/** One bounded schema shared by discovery and runtime challenges. No raw gateway HTML. */
export function parseAuthFields(value: unknown): EnterpriseAuthField[] {
  if (!Array.isArray(value) || value.length > 32) throw new Error('网关认证表单无效');
  const seen = new Set<string>();
  return value.map((field) => {
    if (
      !field ||
      typeof field.name !== 'string' ||
      !/^[a-zA-Z0-9_.:-]{1,128}$/.test(field.name) ||
      seen.has(field.name) ||
      ['__proto__', 'constructor', 'prototype'].includes(field.name) ||
      typeof field.label !== 'string' ||
      field.label.length > 256 ||
      typeof field.secret !== 'boolean'
    )
      throw new Error('网关认证字段无效');
    seen.add(field.name);
    if (
      field.choices !== undefined &&
      (!Array.isArray(field.choices) ||
        !field.choices.length ||
        field.choices.length > 64 ||
        field.choices.some(
          (choice: { value?: unknown; label?: unknown }) =>
            typeof choice.value !== 'string' ||
            !choice.value ||
            choice.value.length > 256 ||
            /[\r\n\0]/.test(choice.value) ||
            typeof choice.label !== 'string' ||
            choice.label.length > 256
        ))
    )
      throw new Error('网关登录选项无效');
    return {
      name: field.name,
      label: field.label,
      secret: field.secret,
      ...(field.choices
        ? {
            choices: field.choices.map((choice: { value: string; label: string }) => ({
              value: choice.value,
              label: choice.label,
            })),
          }
        : {}),
    };
  });
}
export function discoverOpenConnectForms(
  directory: string,
  detected: EnterpriseDetection
): Promise<EnterpriseAuthField[]> {
  return discoverForm(
    openConnectAuthBinary(directory),
    ['--probe', detected.protocol!, detected.gateway, '', ''],
    {}
  );
}
/** Every engine returns the same bounded, credential-free form schema. */
export function discoverEnterpriseForms(
  directory: string,
  detected: EnterpriseDetection
): Promise<EnterpriseAuthField[]> {
  if (detected.protocol !== 'atrust') return discoverOpenConnectForms(directory, detected);
  const binary = join(
    directory,
    process.platform === 'win32' ? 'enterprise-runtime.exe' : 'enterprise-runtime'
  );
  const manifest = JSON.parse(
    readFileSync(join(directory, 'enterprise-runtime-manifest.json'), 'utf8')
  );
  if (
    manifest.tlsVerification !== true ||
    createHash('sha256').update(readFileSync(binary)).digest('hex') !== manifest.sha256
  )
    throw new Error('企业 VPN 引擎完整性校验失败');
  return discoverForm(binary, ['--probe'], { Protocol: 'atrust', Gateway: detected.gateway });
}
function discoverForm(
  binary: string,
  args: string[],
  configuration: Record<string, string>
): Promise<EnterpriseAuthField[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let oversized = false;
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (output.length > 65536) {
        oversized = true;
        child.kill();
      }
    });
    child.stderr.resume();
    child.stdin.end(JSON.stringify(configuration) + '\n');
    const timer = setTimeout(() => child.kill(), 12000);
    timer.unref();
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('网关认证选项识别失败'));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0 || oversized) throw new Error('当前网关认证方式尚未适配或无法安全读取');
        const form = output
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
          .find((event) => event.type === 'form');
        if (!form) throw new Error('网关未提供受支持的认证选项');
        resolve(parseAuthFields(form.fields));
      } catch (error) {
        reject(error);
      }
    });
  });
}
