import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import {
  chmodSync,
  constants,
  closeSync,
  fstatSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import type { SecretCodec } from './EnterpriseProfileStore';
const MAGIC = Buffer.from('SVPN1');
/** Application-owned encryption. No OS credential service or silent plaintext fallback. */
export class LocalSecretCodec implements SecretCodec {
  private readonly key: Buffer;
  constructor(file: string) {
    let fd: number;
    try {
      fd = openSync(
        file,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      fd = -1;
    }
    if (fd >= 0) {
      try {
        writeFileSync(fd, randomBytes(32));
      } finally {
        closeSync(fd);
      }
    }
    const reader = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!fstatSync(reader).isFile()) throw new Error('本地密钥文件无效');
      this.key = readFileSync(reader);
    } finally {
      closeSync(reader);
    }
    if (this.key.length !== 32) throw new Error('本地密钥文件损坏，不能读取企业 VPN 配置');
    chmodSync(file, 0o600);
  }
  encrypt(value: string): Buffer {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), data]);
  }
  decrypt(value: Buffer): string {
    if (value.length < 33 || !value.subarray(0, 5).equals(MAGIC))
      throw new Error('旧系统加密配置需要迁移，不能按本地密钥读取');
    const cipher = createDecipheriv('aes-256-gcm', this.key, value.subarray(5, 17));
    cipher.setAuthTag(value.subarray(17, 33));
    return Buffer.concat([cipher.update(value.subarray(33)), cipher.final()]).toString('utf8');
  }
}
