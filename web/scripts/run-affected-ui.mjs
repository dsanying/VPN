// SPDX-License-Identifier: MIT
// 针对性 UI 门禁：按本次改动映射受影响的 spec，只跑相关用例；核心共享层才全量。
//
// 用法：
//   node scripts/run-affected-ui.mjs                # 按 git diff（工作区 + 暂存，相对 HEAD）映射
//   node scripts/run-affected-ui.mjs --base v0.3.2  # 与指定基线比较
//   node scripts/run-affected-ui.mjs --full         # 跳过映射直接全量
//
// 设计约束：映射表按「源码目录 → 页面级 spec」维护；测试基建（desktop-mock 等）与核心共享层
// （components/client、store、i18n、domain、shared、应用入口）影响面遍及全部页面，页面级映射
// 无法收敛，保守起见直接全量——这是「实在不行了才全量」的那一类。实际执行统一转交
// run-runtime.mjs，保证运行时锁、webServer 端口与环境变量行为不变。
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

/** 目录/文件前缀 → 受影响 spec（不含 .spec.ts 后缀）。命中多条取并集。 */
const MAP = [
  [/^tests\/ui\//, (file) => [file.replace(/^tests\/ui\//, '').replace(/\.spec\.ts$/, '')]],
  [/^src\/pages\/NodesPage\//, () => ['node-list', 'nodes-filters', 'nodes-card-visual', 'node-failure-reasons', 'node-measurements', 'node-interaction-performance', 'server-region-icons', 'desktop-actions']],
  [/^src\/pages\/RulesPage\//, () => ['rules-integration', 'rules-summary', 'rule-editor-simple', 'rules-node-and-update', 'rules-oscillation-probe', 'application-routing']],
  [/^src\/pages\/ConnectionsPage\//, () => ['connections-live-traffic', 'connection-identities', 'connection-semantics']],
  [/^src\/pages\/LogsPage\//, () => ['log-viewer']],
  [/^src\/pages\/AppsPage\//, () => ['real-pages', 'client-contract']],
  [/^src\/pages\/SettingsPage\//, () => ['settings-minimal', 'global-updates', 'configuration-detection']],
  [/^src\/layouts\//, () => ['desktop-navigation', 'desktop-density', 'desktop-expanded', 'desktop-scroll', 'sider-update', 'real-pages']],
  [/^src\/components\/vpn\/NodeRegionIcon|^src\/components\/vpn\/useNodeRegion/, () => ['server-region-icons', 'automatic-region', 'node-list']],
  [/^src\/components\/vpn\/(ApplicationIdentity|NodeAvailability)/, () => ['node-list', 'connections-live-traffic']],
  [/^src\/domain\/components\/settings\/flag-assets/, () => ['server-region-icons', 'node-list', 'nodes-card-visual']],
  [/^src\/domain\/lib\/entry-latency/, () => ['desktop-actions', 'node-list']],
  [/^src\/store\/useUpdateStore|^src\/components\/vpn\/GlobalUpdateNotice|^src\/components\/vpn\/Update/, () => ['global-updates', 'update-popup', 'sider-update']],
];

/** 核心共享层：任何命中都直接全量（页面级映射无法收敛其影响面）。 */
const FULL_PREFIXES = [
  'src/components/client/',
  'src/store/',
  'src/i18n/',
  'src/domain/',
  'src/App.',
  'src/main.tsx',
  'src/shared/',
  'tests/ui/desktop-mock',
  'tests/ui/console-guard',
  'tests/ui/app-origin',
  'tests/ui/client-geometry',
  'tests/ui/operation-notification',
  'vite.config',
  'playwright.config',
];

const args = process.argv.slice(2);
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'HEAD';

function changedFiles() {
  const files = new Set(
    execFileSync('git', ['diff', '--name-only', base], { cwd: root, encoding: 'utf8' }).split('\n'),
  );
  return [...files].filter((file) => file.length > 0);
}

let specs = null;
if (args.includes('--full')) {
  console.error('--full：直接全量。');
} else {
  const files = changedFiles();
  if (files.length === 0) {
    console.error('没有相对基线的改动，无需跑门禁。');
    process.exit(0);
  }
  const shared = files.filter((file) => FULL_PREFIXES.some((prefix) => file.includes(prefix)));
  if (shared.length > 0) {
    console.error(`改动触及核心共享层（${shared.slice(0, 3).join('、')}${shared.length > 3 ? ' 等' : ''}），跑全量。`);
  } else {
    const matched = new Set();
    for (const file of files) {
      for (const [pattern, map] of MAP) {
        if (pattern.test(file)) for (const spec of map(file)) matched.add(spec);
      }
    }
    if (matched.size === 0) {
      console.error(`改动未命中任何映射（${files.slice(0, 3).join('、')}），保守跑全量。`);
    } else {
      specs = [...matched];
      console.error(`针对性跑 ${specs.length} 个 spec 文件：${specs.join(' ')}`);
    }
  }
}

const specArgs = specs ? specs.map((spec) => `tests/ui/${spec}.spec.ts`) : [];
execFileSync(process.execPath, [resolve(import.meta.dirname, 'run-runtime.mjs'), 'ui', ...specArgs], {
  stdio: 'inherit',
  env: process.env,
});
