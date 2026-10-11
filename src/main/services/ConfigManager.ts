import { createDefaultConfig } from '../../shared/config-defaults';
import { measurementConfigSaved } from './measurement-refresh';
import { prepareAutomaticTakeover } from '../../shared/automatic-takeover';
import { clearRetiredConfigData } from '../../shared/retired-config-data';
/**
 * 配置管理服务
 * 负责用户配置的加载、保存、验证和管理
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { randomBytes } from 'crypto';
import type { UserConfig, LogLevel } from '../../shared/types';
import { validateUserConfig } from '../../shared/config-validation';
import type { LogManager } from './LogManager';
import { getConfigPath } from '../utils/paths';
import { writeFileAtomic } from '../utils/atomic-write';
import { readPrivacyHash, writePrivacyHash, hashPasswordSync } from '../utils/privacy-lock';
import { customRulesNeedMigration } from '../../shared/rules';
import { migrateBypassRules } from '../../shared/bypass-rule-migration';
import { migrateTunDefaults } from '../../shared/tun-defaults';

export interface IConfigManager {
  loadConfig(): Promise<UserConfig>;
  saveConfig(config: UserConfig): Promise<void>;
  get<T>(key: keyof UserConfig): T | undefined;
  set(key: keyof UserConfig, value: any): Promise<void>;
  validateConfig(config: UserConfig): void;
  getConfigPath(): string;
}

export class ConfigManager implements IConfigManager {
  private configPath: string;
  private currentConfig: UserConfig | null = null;
  private tmpSwept = false;
  private logManager?: LogManager;

  /**
   * 注入 LogManager（由主流程在 index.ts 统一注入）。ConfigManager 可能早于 LogManager 初始化，
   * 故 logManager 为可选，注入前所有日志走 console fallback（见 this.log）。
   */
  setLogManager(lm: LogManager): void {
    this.logManager = lm;
  }

  /**
   * 统一日志出口：已注入 LogManager 则转发，否则按级别 fallback 到 console
   * （ConfigManager 可能早于 LogManager 初始化）。
   */
  private log(level: LogLevel, message: string): void {
    if (this.logManager) {
      this.logManager.addLog(level, message, 'ConfigManager');
      return;
    }
    if (level === 'error' || level === 'fatal') console.error(message);
    else if (level === 'warn') console.warn(message);
    else console.log(message);
  }

  /**
   * 清扫 saveConfig 原子写遗留的孤儿 tmp（进程在 writeFile 成功后、rename 前被硬杀/断电；随机名不会被下次写覆盖自愈）。
   * 仅首次 loadConfig 跑一次；mtime>60s 守卫避免误删并发 saveConfig 的在途 tmp；精确锚定文件名不碰 .pre-rule-migration.bak。best-effort，绝不抛。
   */
  private async sweepStaleTmpFiles(): Promise<void> {
    if (this.tmpSwept) return;
    this.tmpSwept = true;
    try {
      const dir = path.dirname(this.configPath);
      const base = path.basename(this.configPath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`^${base}\\.[0-9a-f]{12}\\.tmp$`);
      const now = Date.now();
      const entries = await fs.readdir(dir);
      await Promise.all(
        entries
          .filter((f) => re.test(f))
          .map(async (f) => {
            const p = path.join(dir, f);
            try {
              const st = await fs.stat(p);
              if (now - st.mtimeMs > 60_000) await fs.unlink(p).catch(() => {});
            } catch {
              /* 文件已消失/无权限：忽略 */
            }
          })
      );
    } catch {
      /* 目录不存在/无权限等：忽略 */
    }
  }

  constructor(customConfigPath?: string) {
    if (customConfigPath) {
      this.configPath = customConfigPath;
    } else {
      // 使用统一的路径工具，确保始终使用正确的用户数据路径
      this.configPath = getConfigPath();
    }
  }

  getConfigPath(): string {
    return this.configPath;
  }

  /** 如果文件不存在或损坏，返回默认配置。 */
  async loadConfig(): Promise<UserConfig> {
    void this.sweepStaleTmpFiles(); // 首次加载清扫原子写孤儿 tmp（fire-and-forget，不阻塞）
    try {
      // 检查配置文件是否存在
      await fs.access(this.configPath);

      // 读取配置文件
      const content = await fs.readFile(this.configPath, 'utf-8');
      const config = JSON.parse(content) as UserConfig;

      // 旧规则（DomainRule）→ 新规则（Rule）迁移前先备份原配置（仅首次，便于回滚）
      if (customRulesNeedMigration((config.customRules as unknown[]) || [])) {
        const backupPath = `${this.configPath}.pre-rule-migration.bak`;
        try {
          await fs.access(backupPath);
        } catch {
          await fs
            .copyFile(this.configPath, backupPath)
            .catch((e) => this.log('warn', `备份旧配置失败（不阻断迁移）: ${e}`));
        }
      }

      // 验证配置（内含旧规则 → 新规则迁移）
      const retiredDataRemoved = clearRetiredConfigData(config);
      this.validateConfig(config);
      if (retiredDataRemoved) await this.saveConfig(config);

      // Save the untouched on-disk configuration before any migration writes occur.
      let bypassBackupReady = false;
      if (migrateBypassRules(config) !== config) {
        try {
          await fs
            .copyFile(
              this.configPath,
              `${this.configPath}.pre-bypass-rules.bak`,
              fs.constants.COPYFILE_EXCL
            )
            .catch(async (error) => {
              if (
                (error as NodeJS.ErrnoException).code !== 'EEXIST' ||
                !(await fs.stat(`${this.configPath}.pre-bypass-rules.bak`)).isFile()
              )
                throw error;
            });
          bypassBackupReady = true;
        } catch {
          this.log('warn', '直连例外迁移暂缓，原配置保留');
        }
      }

      // 旧配置回填 clash_api secret（首次升级时随机生成并持久化，后续稳定，供 external_ui/外部客户端复用）
      if (!config.clashApiSecret) {
        config.clashApiSecret = randomBytes(16).toString('hex');
        await this.saveConfig(config).catch((e) =>
          this.log('warn', `持久化 clashApiSecret 失败（不阻断）: ${e}`)
        );
      }

      // F29：旧明文 privacyPassword 一次性迁移到独立哈希文件（幂等、绝不抛）。
      // 先清内存明文——即便后续哈希落盘 fs 失败，明文也不会再经 CONFIG_GET_VALUE / configChanged 外泄；
      // 失败时磁盘明文留存，下次加载重试迁移（此期间无哈希=fail-open，与迁移失败语义一致）。
      if (typeof config.privacyPassword === 'string' && config.privacyPassword !== '') {
        const legacyPlain = config.privacyPassword;
        config.privacyPassword = '';
        try {
          if (!readPrivacyHash()) writePrivacyHash(hashPasswordSync(legacyPlain));
          await this.saveConfig(config).catch((e) =>
            this.log('warn', `隐私密码迁移后落盘失败（不阻断）: ${e}`)
          );
        } catch (e) {
          this.log('warn', `隐私密码迁移失败（明文已从内存清除，下次加载重试）: ${e}`);
        }
      }

      // DNS upstream migration and platform TUN defaults are independent of managed FakeIP.
      await this.migrateNodeResolver(config);
      await this.migrateTunDefaults(config);

      // Persist routing consolidation only after a recoverable copy of the original exists.
      const consolidated = migrateBypassRules(config);
      if (bypassBackupReady && consolidated !== config) {
        try {
          await this.saveConfig(consolidated);
          Object.assign(config, consolidated);
        } catch {
          this.log('warn', '直连例外迁移暂缓，原配置保留');
        }
      }

      // Complete legacy migrations before enforcing the current connection policy.
      const takeover = prepareAutomaticTakeover(config);
      if (takeover !== config) {
        Object.assign(config, takeover);
        await this.saveConfig(config);
      }

      // 缓存配置
      this.currentConfig = config;

      return config;
    } catch (error) {
      // 文件不存在或解析失败，返回默认配置
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log('error', `配置文件加载失败，使用默认配置: ${errorMessage}`);

      const isMissing = (error as NodeJS.ErrnoException).code === 'ENOENT';

      // 记录详细错误信息
      if (error instanceof SyntaxError) {
        this.log('error', `配置文件 JSON 格式错误: ${errorMessage}`);
      } else if (isMissing) {
        this.log('info', '配置文件不存在，将创建默认配置');
      } else if ((error as NodeJS.ErrnoException).code === 'EACCES') {
        this.log('error', '配置文件权限不足，无法读取');
      } else {
        this.log('error', `配置验证失败: ${errorMessage}`);
      }

      const defaultConfig = this.createDefaultConfig();
      this.currentConfig = defaultConfig;

      // P0 数据丢失防护：仅当磁盘上【本就没有】配置文件（ENOENT，新装/首次运行）时才落盘默认配置。
      // 若文件存在但读取/解析/校验失败（JSON 损坏、校验 throw 等），绝不用默认配置覆盖真实文件——
      // 否则用户的 servers/subscriptions/customRules 会被一次静默覆盖、永久丢失且无从恢复。
      // 此时先把损坏的原文件备份为 config.corrupt-<ts>.json（保留人工/后续恢复的机会），
      // 内存返回默认配置让应用能启动，但磁盘真实文件原样保留、下次修复后即可恢复。
      if (isMissing) {
        try {
          await this.saveConfig(defaultConfig);
          this.log('info', `默认配置已保存到: ${this.configPath}`);
        } catch (saveError) {
          this.log('error', `保存默认配置失败: ${saveError}`);
        }
      } else {
        // 存在但损坏：备份，不覆盖。
        try {
          const ts = this.corruptBackupStamp();
          const backupPath = path.join(path.dirname(this.configPath), `config.corrupt-${ts}.json`);
          await fs.copyFile(this.configPath, backupPath).catch(() => {});
          await this.pruneCorruptBackups();
          this.log(
            'error',
            `配置文件损坏或校验失败，已备份到 ${backupPath}，未覆盖原文件；本次以默认配置启动`
          );
        } catch (backupError) {
          this.log('error', `备份损坏配置失败（不阻断启动）: ${backupError}`);
        }
      }

      return defaultConfig;
    }
  }

  async saveConfig(config: UserConfig): Promise<void> {
    // Removed resource data is never accepted through save/import.
    clearRetiredConfigData(config);
    this.validateConfig(config);
    config = prepareAutomaticTakeover(config);

    // 确保配置目录存在
    const configDir = path.dirname(this.configPath);
    await fs.mkdir(configDir, { recursive: true });

    // 原子落盘：先写唯一 tmp（随机后缀防并发 saveConfig 互相覆盖半写）→ rename 替换。
    // 防崩溃/进程被杀写到一半截断 config.json → loadConfig 校验失败回落默认配置并覆盖落盘 → 整份配置丢失
    //（节点/订阅/规则全丢）。与本项目 .srs/catalog 落盘同原子写规范（同样无 fsync → 断电 durability 为尽力而为）。
    // 收敛到 writeFileAtomic：mode:0o600 在 open(2) 即生效（绝不出现 0644 携密窗口）+ 非 Win chmod 双保险；
    // 后缀保留 `<rand6hex>.tmp`（不带 pid）以匹配既有 sweepStaleTmpFiles 清扫正则（行为字节保持）。
    const content = JSON.stringify(config, null, 2);
    await writeFileAtomic(this.configPath, content, {
      mode: 0o600,
      makeTmpSuffix: () => randomBytes(6).toString('hex'),
    });

    // 更新缓存
    this.currentConfig = config;
    measurementConfigSaved(this, config);
  }

  get<T>(key: keyof UserConfig): T | undefined {
    if (!this.currentConfig) {
      return undefined;
    }
    return this.currentConfig[key] as T;
  }

  async set(key: keyof UserConfig, value: any): Promise<void> {
    // 未加载守卫：currentConfig===null（loadConfig 从未成功跑过）时，绝不能用 createDefaultConfig 兜底后
    // 直接 saveConfig——那会用默认配置整份覆盖磁盘上真实的 config.json，静默清空用户 servers/订阅/规则。
    // 改为先 loadConfig 加载磁盘真实配置（文件不存在才回落默认，见 loadConfig catch），再改单键落盘。
    if (!this.currentConfig) {
      await this.loadConfig();
    }
    // loadConfig 必置 currentConfig（成功→磁盘配置；失败→内存默认）；防御性再兜底一层，杜绝 null 解引用。
    if (!this.currentConfig) {
      this.currentConfig = this.createDefaultConfig();
    }

    // 更新配置项
    (this.currentConfig as any)[key] = value;

    // 保存配置
    await this.saveConfig(this.currentConfig);
  }

  /** 损坏配置备份用的文件系统安全时间戳（ISO 去掉冒号/点，避免 Windows 非法文件名）。 */
  private corruptBackupStamp(): string {
    return new Date().toISOString().replace(/[:.]/g, '-');
  }

  /**
   * 清理 config.corrupt-*.json 备份，仅保留最近 2 份（本次写入新备份后总数 ≤3），
   * 防反复启动失败时备份文件在 userData 无限堆积。best-effort：任何失败仅忽略，不阻断启动。
   */
  private async pruneCorruptBackups(): Promise<void> {
    try {
      const dir = path.dirname(this.configPath);
      const entries = await fs.readdir(dir);
      const backups = entries.filter((n) => /^config\.corrupt-.*\.json$/.test(n)).sort(); // 时间戳前缀命名 → 字典序即时间序，升序（旧在前）
      const keep = 2;
      const toDelete = backups.slice(0, Math.max(0, backups.length - keep));
      for (const name of toDelete) {
        await fs.unlink(path.join(dir, name)).catch(() => {});
      }
    } catch {
      /* 清理失败不阻断加载 */
    }
  }

  validateConfig(config: UserConfig): void {
    validateUserConfig(config, (level, message) => this.log(level, message));
  }

  /**
   * 节点域名解析器迁移（issue #147）：旧单选档位 nodeDomainResolver(auto/dnspod/system) → 新多源模型
   * nodeResolverPool(race on 多选)+nodeResolverSingle(race off 单选)。幂等(nodeResolverMigrated 守卫)、绝不抛。
   * 保留用户原意图：dnspod→[dnspod]/single dnspod；system→[system]/single system；auto/缺省→[ali,dnspod]/single ali。
   * 完成后删除旧 nodeDomainResolver，运行期只使用多源解析模型。
   */
  private async migrateNodeResolver(config: UserConfig): Promise<void> {
    try {
      const dns = config.dnsConfig;
      if (!dns || dns.nodeResolverMigrated === true) return; // 已迁移（含新装）幂等跳过；无 dnsConfig 理论不达（上游已补）
      const old = dns.nodeDomainResolver ?? 'auto';
      if (dns.nodeResolverPool === undefined) {
        dns.nodeResolverPool =
          old === 'dnspod' ? ['dnspod'] : old === 'system' ? ['system'] : ['ali', 'dnspod'];
      }
      if (dns.nodeResolverSingle === undefined) {
        dns.nodeResolverSingle = old === 'dnspod' ? 'dnspod' : old === 'system' ? 'system' : 'ali';
      }
      delete dns.nodeDomainResolver;
      dns.nodeResolverMigrated = true;
      await this.saveConfig(config).catch((e) =>
        this.log('warn', `节点解析器迁移后落盘失败（不阻断，下次重试）: ${e}`)
      );
    } catch (e) {
      this.log('warn', `节点解析器迁移失败（吞掉，不影响启动）: ${e}`);
    }
  }

  /**
   * TUN 默认值（stack + mtu）一次性迁移（幂等、绝不抛）：存量值多为旧版本写死后持久化的结果，
   * 而非用户真实选择（旧 UI 既不暴露 stack 也不暴露 mtu）→ 归 'auto'，由解析期按 PLATFORM_DEFAULT_STACK /
   * PLATFORM_DEFAULT_MTU **当前表**落值。
   *
   * **别把它读成「行为零变化」**：模型统一那批（表仍是旧值）确实零变化，但默认值一换，存量用户就随之被抬到
   * 新档（Windows 存量 system/1350 → gvisor/65535，栈实现、吞吐、热切换路径全变）——这正是接入 'auto' 的目的：
   * 改一张表即全量生效，无需第二次迁移。真正守住的不变量只有一条：**用户显式选择不被回灌**（两个 *Migrated
   * 守卫各自把守，迁移只跑一次）。
   * 详见 docs/design/tun-stack-option.md §7 与 shared/tun-defaults#migrateTunDefaults。
   */
  private async migrateTunDefaults(config: UserConfig): Promise<void> {
    try {
      // 纯逻辑收敛到 shared/tun-defaults#migrateTunDefaults（可单测）；本壳只负责落盘 + 吞异常。
      if (!migrateTunDefaults(config)) return; // 幂等/无变更（含新装）→ 不落盘
      await this.saveConfig(config).catch((e) =>
        this.log('warn', `TUN 默认值迁移后落盘失败（不阻断，下次重试）: ${e}`)
      );
    } catch (e) {
      this.log('warn', `TUN 默认值迁移失败（吞掉，不影响启动）: ${e}`);
    }
  }

  private createDefaultConfig(): UserConfig {
    return createDefaultConfig(randomBytes(16).toString('hex'));
  }
}
