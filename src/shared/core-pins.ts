/**
 * 内核摘要白名单（SecAudit H1 pins 方案）：helper 的 install-core / install-mihomo 只接受清单内 sha256。
 *
 * 单一真值是 src/shared/core-manifest.json（sing-box 各平台 binarySha256）与
 * compatibility-core-manifest.json（mihomo 各平台 binarySha256）。白名单在两者基础上**并入现役受保护核**
 * （安装/修复 helper 时把 coreDir/sing-box 的实际摘要追加进去）——现役核是之前合法在线更新的版本，
 * 不并入则 helper 升级后该核立刻变「非法」、回滚/同版本重装被 pin-mismatch 拒。root-owned coreDir 普通
 * 用户改不动，把它当可信基线不增风险。
 *
 * helper 安装脚本把 pins.json 拷到 root 专属位置（mac: /Library/Application Support/ShadowVPN/core-pins.json；
 * linux: /usr/local/lib/shadowvpn/core-pins.json；win: C:\ProgramData\ShadowVPN\core-pins.json），helper -pins
 * flag 指向它。安装后 app bundle 被改不影响已锚定的 pins。
 */
import * as fs from 'fs';
import * as path from 'path';
import { sha256File } from './file-hash';
import coreManifest from './core-manifest.json';
import compatManifest from './compatibility-core-manifest.json';

export interface CorePinsFile {
  'sing-box': string[];
  mihomo: string[];
}

// manifest 是打包物、结构受 fetch-*/check-* 脚本与 core-manifest-invariants 测试约束；
// 此处只做存在性/类型收窄（JSON 导入默认宽类型），不做全量 schema 校验。
interface CoreManifestShape {
  coreBinarySha256?: Record<string, string>;
}
interface CompatManifestShape {
  mihomo?: { assets?: Record<string, { binarySha256?: string }> };
}

const isHex64 = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v);
/** 从两份 manifest 合并出当前安装包允许安装的核摘要集；activeCoreDir 存在时并入其中现役核的实际摘要：
 *  - <dir>/sing-box(.exe)           → sing-box pins（mac/Linux 受保护目录、Windows userData/core_update）
 *  - <dir>/mihomo-runtime/mihomo(.exe) → mihomo pins（与 helperrpc.MihomoPath 的布局一致）
 * 现役核是之前合法在线更新的版本，不在 manifest 内但 helper 应认（否则升级 helper 后回滚被拒）。
 * 注意：mac/Linux 受保护目录 root-owned，并入它零增量风险；Windows userData 普通用户可写——但 Windows
 * 无 install-core，sing-box pin 不被消费，现役 mihomo 的并入收益（兼容升级）大于同 UID 已失守面的残余风险。 */
export function buildCorePins(activeCoreDir?: string): CorePinsFile {
  const core: CoreManifestShape = coreManifest;
  const compat: CompatManifestShape = compatManifest;

  const singBox = new Set<string>();
  const mihomo = new Set<string>();
  for (const v of Object.values(core.coreBinarySha256 ?? {})) {
    if (isHex64(v)) singBox.add(v.toLowerCase());
  }
  for (const a of Object.values(compat.mihomo?.assets ?? {})) {
    const sha = a?.binarySha256;
    if (isHex64(sha)) mihomo.add(sha.toLowerCase());
  }
  if (activeCoreDir) {
    const candidates: Array<[string, Set<string>]> = [
      [path.join(activeCoreDir, 'sing-box'), singBox],
      [path.join(activeCoreDir, 'sing-box.exe'), singBox],
      [path.join(activeCoreDir, 'mihomo-runtime', 'mihomo'), mihomo],
      [path.join(activeCoreDir, 'mihomo-runtime', 'mihomo.exe'), mihomo],
    ];
    for (const [p, target] of candidates) {
      try {
        if (fs.existsSync(p)) target.add(sha256File(p).toLowerCase());
      } catch {
        /* 现役核读不到/算不出 → 不并入（保持 manifest-only，升级后该核会被拒，属可接受的边缘回退） */
      }
    }
  }
  return { 'sing-box': [...singBox].sort(), mihomo: [...mihomo].sort() };
}

/** pins.json 序列化文本（固定 2 空格缩进，确定性输出便于测试/比对）。 */
export function corePinsJson(activeCorePath?: string): string {
  return JSON.stringify(buildCorePins(activeCorePath), null, 2) + '\n';
}
