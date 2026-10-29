/**
 * isCoreProcessOutput（内核进程身份校验，PID 复用识破）单测。
 * 背景见 src/shared/core-process.ts 头注释：2026-10-28 事故——核死后 PID 若被复用（或仅验 PID 存在），
 * 健康检查永久失明，系统 DNS 接管无人还原。
 */

import { isCoreProcessOutput } from '../core-process';

describe('isCoreProcessOutput — 内核镜像名识别', () => {
  it('macOS/Linux ps -o pid= -o comm=：本应用内核（绝对路径）→ true', () => {
    expect(
      isCoreProcessOutput(' 12345 /Applications/暗影VPN.app/Contents/Resources/bin/sing-box\n')
    ).toBe(true);
    expect(isCoreProcessOutput(' 12345 /usr/local/bin/mihomo\n')).toBe(true);
  });

  it('ps：镜像名复用给无关进程 → false（PID 复用识破的关键用例）', () => {
    expect(isCoreProcessOutput(' 12345 /usr/sbin/cfprefsd\n')).toBe(false);
    expect(isCoreProcessOutput(' 12345 /usr/libexec/SystemImageUpdater\n')).toBe(false);
  });

  it('ps：僵尸/空输出 → false', () => {
    expect(isCoreProcessOutput(' 12345 <defunct>\n')).toBe(false);
    expect(isCoreProcessOutput('')).toBe(false);
  });

  it('Windows tasklist /NH：本应用内核行 → true', () => {
    expect(
      isCoreProcessOutput('sing-box.exe                 12345 Console            1     45,068 K\n')
    ).toBe(true);
    expect(
      isCoreProcessOutput('mihomo.exe                   12345 Console            1     45,068 K\n')
    ).toBe(true);
  });

  it('Windows tasklist：无关镜像（PID 复用）→ false', () => {
    expect(
      isCoreProcessOutput('explorer.exe                 12345 Console            1     45,068 K\n')
    ).toBe(false);
  });

  it('不把行中含 mihomo/sing-box 子串的无关路径误判成内核', () => {
    // 路径组件里带子串但镜像名不是内核（如 sing-boxctl）→ 前缀边界必须挡住。
    expect(isCoreProcessOutput(' 12345 /usr/local/bin/sing-boxctl\n')).toBe(false);
  });
});
