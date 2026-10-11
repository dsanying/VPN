/** 内部分流数据清单：只按当前智能分流和局域网需求准备，后台更新；没有用户资源管理入口。 */

import * as path from 'path';
import * as fssync from 'fs';
import * as fsp from 'fs/promises';
import { getUserDataPath } from '../utils/paths';
import { resourceManager } from './ResourceManager';

export interface BuiltinGeoRuleSet {
  /** sing-box rule_set tag，同时是运行时文件名前缀。 */
  tag: string;
  /** 运行时落盘名 `${tag}.srs`。 */
  fileName: string;
  category: 'geosite' | 'geoip';
  /** 出厂源（resources/data 内随包分发），seed / reset 用。 */
  bundledPath: () => string;
  /** 网络更新源（SagerNet rule-set raw，复用下载层 gh-proxy 重试链）。 */
  sourceUrl: string;
}

export const BUILTIN_GEO_RULESETS: BuiltinGeoRuleSet[] = [
  {
    tag: 'geosite-cn',
    fileName: 'geosite-cn.srs',
    category: 'geosite',
    bundledPath: () => resourceManager.getGeoSiteCNPath(),
    sourceUrl: 'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-cn.srs',
  },
  {
    tag: 'geosite-geolocation-!cn',
    fileName: 'geosite-geolocation-!cn.srs',
    category: 'geosite',
    bundledPath: () => resourceManager.getGeoSiteNonCNPath(),
    sourceUrl:
      'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-geolocation-!cn.srs',
  },
  {
    tag: 'geoip-cn',
    fileName: 'geoip-cn.srs',
    category: 'geoip',
    bundledPath: () => resourceManager.getGeoIPPath(),
    sourceUrl: 'https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-cn.srs',
  },
  {
    tag: 'geosite-private',
    fileName: 'geosite-private.srs',
    category: 'geosite',
    bundledPath: () => resourceManager.getDataResourcePath('geosite-private.srs'),
    sourceUrl:
      'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/geo/geosite/private.srs',
  },
];

/** 本地 geo 规则集运行时目录（内置 .srs 拷贝落地处）。copy 与 route 生成共用，单一真值。 */
export function getRuleSetRuntimeDir(): string {
  return path.join(getUserDataPath(), 'rules');
}

export const findBuiltin = (tag: string): BuiltinGeoRuleSet | undefined =>
  BUILTIN_GEO_RULESETS.find((item) => item.tag === tag);

/** SRS 文件魔数校验（'SRS' = 0x53 0x52 0x53），拦半写/损坏文件。同步读前 3 字节。 */
export function isValidSrsFile(p: string): boolean {
  let fd: number | null = null;
  try {
    fd = fssync.openSync(p, 'r');
    const buf = Buffer.alloc(3);
    const n = fssync.readSync(fd, buf, 0, 3, 0);
    return n === 3 && buf[0] === 0x53 && buf[1] === 0x52 && buf[2] === 0x53;
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try {
        fssync.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

let seedCounter = 0;

/** Seed only demanded data when missing/invalid; preserve valid network updates. */
export async function seedBuiltinRuleSets(opts?: { tags?: ReadonlySet<string> }): Promise<void> {
  const runtimeDir = getRuleSetRuntimeDir();
  const tags = opts?.tags ?? new Set(['geosite-private']);
  for (const b of BUILTIN_GEO_RULESETS) {
    if (!tags.has(b.tag)) continue;
    const dest = path.join(runtimeDir, b.fileName);
    const src = b.bundledPath();
    let reason: 'missing' | 'refresh' | null = null;
    if (!isValidSrsFile(dest)) reason = 'missing';
    if (!reason) continue;
    try {
      if (!fssync.existsSync(src)) continue; // 出厂文件缺失（异常打包）→ 跳过，由网络更新兜底
      // src 本身损坏（404/空文件污染打包）→ 跳过：seed 只校验 dest，不校验 src 会把坏文件原样种进运行时目录，
      // 之后 route builder isValidSrsFile(dest) 失败 → 智能/全局模式真悬空引用。校验 src 魔数，坏的留给网络更新兜底。
      if (!isValidSrsFile(src)) continue;
      await fsp.mkdir(runtimeDir, { recursive: true });
      const tmp = `${dest}.seed-${process.pid}-${seedCounter++}`;
      await fsp.copyFile(src, tmp);
      // 落地前复查：missing 场景若 dest 期间已被 updateBuiltin 写入合法文件 → 放弃覆盖（防竞态回滚网络版）
      if (reason === 'missing' && isValidSrsFile(dest)) {
        await fsp.unlink(tmp).catch(() => {});
      } else {
        await fsp.rename(tmp, dest);
      }
    } catch {
      /* 单项补种失败不阻塞其余项；下次启动/列表刷新再试 */
    }
  }
}
