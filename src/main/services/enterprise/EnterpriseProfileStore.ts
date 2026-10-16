import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import type {
  EnterpriseDetection,
  EnterpriseProfile,
  EnterpriseProfileInput,
} from '../../../shared/enterprise-vpn';
export interface SecretCodec {
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}
export interface StoredEnterpriseProfile extends EnterpriseProfile {
  password?: string;
}
/** Entire records are encrypted, including gateway and username; never part of config backups. */
export class EnterpriseProfileStore {
  private db: DatabaseSync;
  constructor(
    file: string,
    private readonly codec: SecretCodec
  ) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    chmodSync(file, 0o600);
    this.db.exec(
      'PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS enterprise_profiles (id TEXT PRIMARY KEY, record BLOB NOT NULL)'
    );
  }
  private decode(record: unknown): StoredEnterpriseProfile {
    return JSON.parse(this.codec.decrypt(Buffer.from(record as Uint8Array)));
  }
  list(): EnterpriseProfile[] {
    return this.db
      .prepare('SELECT record FROM enterprise_profiles ORDER BY rowid')
      .all()
      .map((row) => {
        const { password: _password, ...profile } = this.decode(row.record);
        return profile;
      });
  }
  has(id: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM enterprise_profiles WHERE id=?').get(id);
  }
  get(id: string): StoredEnterpriseProfile {
    const row = this.db.prepare('SELECT record FROM enterprise_profiles WHERE id=?').get(id);
    if (!row) throw new Error('企业 VPN 配置不存在');
    return this.decode(row.record);
  }
  save(input: EnterpriseProfileInput, detected: EnterpriseDetection): EnterpriseProfile {
    if (!detected.protocol || detected.gateway !== input.gateway)
      throw new Error('请先成功识别 VPN 网关');
    if (
      input.password !== undefined &&
      (typeof input.password !== 'string' ||
        input.password.length > 4096 ||
        /[\r\n\0]/.test(input.password))
    )
      throw new Error('密码格式无效');
    if (
      input.username !== undefined &&
      (typeof input.username !== 'string' ||
        input.username.length > 512 ||
        /[\r\n\0]/.test(input.username))
    )
      throw new Error('账号格式无效');
    if (input.name !== undefined && (typeof input.name !== 'string' || input.name.length > 256))
      throw new Error('名称格式无效');
    if (
      input.id !== undefined &&
      (typeof input.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.id))
    )
      throw new Error('节点身份无效');
    const old = input.id && this.has(input.id) ? this.get(input.id) : undefined;
    // A secret belongs to an origin AND account. Never reuse it across a gateway/account edit.
    const sameIdentity =
      old?.gateway === input.gateway &&
      old?.username === (input.username ?? '') &&
      old?.protocol === detected.protocol;
    const password = input.clearPassword
      ? undefined
      : input.password || (sameIdentity ? old?.password : undefined);
    const selections: Record<string, string> = {};
    const choices = detected.fields?.filter((field) => field.choices?.length) ?? [];
    for (const field of choices) {
      const value =
        input.selections?.[field.name] ??
        (sameIdentity ? old?.selections?.[field.name] : undefined) ??
        (field.choices!.length === 1 ? field.choices![0].value : undefined);
      if (value && !field.choices!.some((choice) => choice.value === value))
        throw new Error('网关登录选项已变更，请重新选择');
      if (value) selections[field.name] = value;
    }
    const profile: StoredEnterpriseProfile = {
      id: old?.id ?? input.id ?? randomUUID(),
      name: input.name?.trim() || new URL(input.gateway).hostname,
      gateway: input.gateway,
      protocol: detected.protocol,
      username: input.username?.trim() ?? '',
      password,
      hasPassword: !!password,
      selections,
      updatedAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        'INSERT INTO enterprise_profiles(id,record) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record'
      )
      .run(profile.id, this.codec.encrypt(JSON.stringify(profile)));
    const { password: _password, ...publicProfile } = profile;
    return publicProfile;
  }
  remove(id: string): void {
    this.db.prepare('DELETE FROM enterprise_profiles WHERE id=?').run(id);
  }
  close(): void {
    this.db.close();
  }
}
