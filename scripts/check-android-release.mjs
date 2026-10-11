#!/usr/bin/env node
// Android 外壳不是已接通的 VPN。发布前检查实际服务、内核及私有发布签名。
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const manifest = fs.readFileSync(path.join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
const requirements = [
  [manifest.includes('android.permission.BIND_VPN_SERVICE') && manifest.includes('android.net.VpnService'), 'Android VpnService 未接入'],
  [fs.existsSync(path.join(root, 'android/app/libs/libbox.aar')), 'Android 原生 VPN 内核未集成'],
  [fs.existsSync(path.join(root, 'web/src/mobile/runtime.ts')), 'Android 共享业务桥未接入：不能发布只能调用原生底层 API 的界面壳'],
  [Boolean(process.env.SHADOW_ANDROID_KEYSTORE && fs.existsSync(process.env.SHADOW_ANDROID_KEYSTORE)), '缺少仓库外的正式签名密钥'],
  [Boolean(process.env.SHADOW_ANDROID_KEY_ALIAS && process.env.SHADOW_ANDROID_STORE_PASSWORD && process.env.SHADOW_ANDROID_KEY_PASSWORD), '缺少正式签名配置'],
];
const errors = requirements.filter(([passed]) => !passed).map(([, message]) => message);
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
