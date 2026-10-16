// electron 仅在方法内被调用（构造期不触碰）；mock 掉 app.getPath 供 state/known-bad 文件路径用临时目录。
jest.mock('electron', () => {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shadowvpn-core-test-'));
  return {
    app: { getPath: (_k: string) => tmpRoot },
    net: { request: jest.fn() },
    dialog: { showOpenDialog: jest.fn() },
  };
});
// ResourceManager 含 electron 间接依赖；CoreUpdateService 落位路径会用到，但本测试只走 runAutoUpdateCycle 的
// 「检查→stage/跨带」分支（代理 mock 为 running，永不落位），故 ensureCronetBeside 等不会被调用。
jest.mock('../ResourceManager', () => ({
  resourceManager: {
    getSingBoxPath: () => '/tmp/shadowvpn-fake/sing-box',
    getSingBoxUpdateTargetPath: () => '/tmp/shadowvpn-fake/sing-box',
    ensureCronetBeside: jest.fn(),
  },
}));

import * as fs from 'fs';
import { setTimeout as realSetTimeout } from 'timers';

import { CoreUpdateService } from '../CoreUpdateService';

// M1 修复：jest30 + node26 组合下 useFakeTimers() 会删除 globalThis.setTimeout，且 useRealTimers() 不恢复
// （typeof globalThis.setTimeout === 'undefined'）。applyStagedNow 内裸用 setTimeout(2000) 会 ReferenceError。
// 修法：M1 测试在 useRealTimers() 后从 node 'timers' 模块钉回真实 setTimeout 到 globalThis；
//   后续 test 的 beforeEach useFakeTimers() 会用 mocked 版替换它（非删除），不破坏 scheduler 其他 fake-timer 测试。

function makeLogManager() {
  return { addLog: jest.fn() } as any;
}

describe('CoreUpdateService.runAutoUpdateCycle', () => {
  function makeProxyManager(running: boolean) {
    return {
      getStatus: () => ({ running }),
      getCoreVersion: jest.fn().mockResolvedValue('1.13.13'),
      buildPreflightConfigJson: () => null,
      hasNaiveNodes: () => false,
      setAutoRestartSuppressed: jest.fn(),
    } as any;
  }

  function makeService(opts: { config: any; checkResult: any; running?: boolean }) {
    const svc = new CoreUpdateService(makeLogManager());
    svc.setProxyManager(makeProxyManager(opts.running ?? true));
    svc.setConfigProvider(() => Promise.resolve(opts.config));
    const events: Array<{ channel: string; payload: any }> = [];
    svc.setEventSender((channel, payload) => events.push({ channel, payload }));
    // 边界打桩：checkUpdate（网络）/ download / extract / preflight / stage / save-state
    jest.spyOn(svc as any, 'checkUpdate').mockResolvedValue(opts.checkResult);
    const downloadSpy = jest
      .spyOn((svc as any).coreDownloader, 'downloadFile')
      .mockResolvedValue('/tmp/fake.tar.gz');
    jest
      .spyOn((svc as any).coreDownloader, 'extractCore')
      .mockResolvedValue({ corePath: '/tmp/x/sing-box', extractDir: '/tmp/x' });
    jest.spyOn(svc as any, 'preflightValidate').mockResolvedValue({
      ok: true,
      version: opts.checkResult.latestVersion,
      versionLine: `sing-box version ${opts.checkResult.latestVersion}`,
    });
    const stageSpy = jest.spyOn(svc as any, 'stageCore').mockImplementation((_d: any, v: any) => ({
      version: v,
      dir: '/tmp/staged',
      stagedAt: 'now',
    }));
    jest.spyOn(svc as any, 'saveAutoState').mockImplementation(() => {});
    let autoState: any = {};
    jest.spyOn(svc as any, 'loadAutoState').mockImplementation(() => autoState);
    (svc as any).__setAutoState = (s: any) => (autoState = s);
    jest.spyOn(svc as any, 'tryApplyStaged').mockResolvedValue(undefined);
    return { svc, events, downloadSpy, stageSpy };
  }

  afterEach(() => jest.restoreAllMocks());

  it('带内新版 → 下载并 stage', async () => {
    const { svc, downloadSpy, stageSpy } = makeService({
      config: {},
      checkResult: {
        hasUpdate: true,
        currentVersion: '1.13.13',
        latestVersion: '1.13.14',
        downloadUrl: 'https://x/sing-box-1.13.14.tar.gz',
        // 真实 checkUpdate 恒带上资产摘要；缺它自动腿会拒装（见下一条用例）。
        downloadSha256: 'a'.repeat(64),
      },
    });
    await svc.runAutoUpdateCycle();
    expect(downloadSpy).toHaveBeenCalledTimes(1);
    expect(stageSpy).toHaveBeenCalledWith(expect.any(String), '1.13.14');
  });

  /**
   * 自动更新是**无人值守**的：没人会看日志、没人会核对下载来源。故「取不到官方 sha256」时必须直接中止，
   * 而不是退化成不校验就装——运行期换核会回落 gh-proxy 第三方镜像，无摘要即无从判断拿到的是什么。
   */
  it('取不到资产摘要 → 自动腿中止，绝不下载安装未校验的内核', async () => {
    const { svc, downloadSpy, stageSpy } = makeService({
      config: {},
      checkResult: {
        hasUpdate: true,
        currentVersion: '1.13.13',
        latestVersion: '1.13.14',
        downloadUrl: 'https://x/sing-box-1.13.14.tar.gz',
        // 无 downloadSha256
      },
    });
    // 现取也拿不到（releases 里没有匹配 URL 的 asset）
    jest.spyOn(svc as any, 'resolveAssetSha256').mockResolvedValue(null);
    await expect(svc.runAutoUpdateCycle()).rejects.toThrow('checksum unavailable');
    expect(downloadSpy).not.toHaveBeenCalled();
    expect(stageSpy).not.toHaveBeenCalled();
  });

  it('跨 minor 新版 → 发跨带事件、绝不下载', async () => {
    const { svc, events, downloadSpy, stageSpy } = makeService({
      config: {},
      checkResult: {
        hasUpdate: false, // checkUpdate 内 ceiling 闸通常已挡，但即便放行也不下载
        currentVersion: '1.13.13',
        latestVersion: '1.14.0',
      },
    });
    await svc.runAutoUpdateCycle();
    expect(downloadSpy).not.toHaveBeenCalled();
    expect(stageSpy).not.toHaveBeenCalled();
    expect(events.some((e) => e.channel === 'event:coreAutoUpdateStatus')).toBe(true);
  });

  it('旧配置开关不再阻止统一周期检查', async () => {
    const { svc, downloadSpy } = makeService({
      config: { autoUpdateCore: false },
      checkResult: { hasUpdate: true, currentVersion: '1.13.13', latestVersion: '1.13.14' },
    });
    const checkSpy = jest.spyOn(svc as any, 'checkUpdate');
    await svc.runAutoUpdateCycle();
    expect(checkSpy).toHaveBeenCalledTimes(1);
    expect(downloadSpy).not.toHaveBeenCalled();
  });

  it('已有相同版本 staged → tryApplyStaged，免重下', async () => {
    const { svc, downloadSpy } = makeService({
      config: {},
      checkResult: {
        hasUpdate: true,
        currentVersion: '1.13.13',
        latestVersion: '1.13.14',
        downloadUrl: 'https://x/sing-box-1.13.14.tar.gz',
      },
    });
    (svc as any).__setAutoState({
      staged: { version: '1.13.14', dir: '/tmp/staged', stagedAt: 'now' },
    });
    const applySpy = jest.spyOn(svc as any, 'tryApplyStaged');
    await svc.runAutoUpdateCycle();
    // H1：runAutoUpdateCycle 内调 tryApplyStaged 传 lockHeld=true（复用入口持的 isUpdating 闸，不二次置/复位）
    expect(applySpy).toHaveBeenCalledWith('staged-same-version', true);
    expect(downloadSpy).not.toHaveBeenCalled();
  });

  // M3：用户手动升级追上跨带提示版本 → 清除残留跨带提示
  it('M3：current 追上 crossBandNotifiedVersion → 清除提示并发 crossBandLatest:null', async () => {
    const { svc, events } = makeService({
      config: {},
      // 当前已升到 1.14.0，无更新（latest 缺省）→ 仍应清掉旧的 1.14.0 跨带提示
      checkResult: { hasUpdate: false, currentVersion: '1.14.0', latestVersion: undefined },
    });
    const saved: any[] = [];
    jest.spyOn(svc as any, 'saveAutoState').mockImplementation((p: any) => saved.push(p));
    (svc as any).loadAutoState = () => ({ crossBandNotifiedVersion: '1.14.0' });
    await svc.runAutoUpdateCycle();
    expect(saved.some((p) => p.crossBandNotifiedVersion === undefined)).toBe(true);
    const ev = events.filter((e) => e.channel === 'event:coreAutoUpdateStatus');
    expect(ev.some((e) => e.payload.crossBandLatest === null)).toBe(true);
  });

  it('M3：current 仍落后 notified → 不清除', async () => {
    const { svc } = makeService({
      config: {},
      checkResult: { hasUpdate: false, currentVersion: '1.13.13', latestVersion: undefined },
    });
    const saved: any[] = [];
    jest.spyOn(svc as any, 'saveAutoState').mockImplementation((p: any) => saved.push(p));
    (svc as any).loadAutoState = () => ({ crossBandNotifiedVersion: '1.14.0' });
    await svc.runAutoUpdateCycle();
    expect(saved.some((p) => 'crossBandNotifiedVersion' in p)).toBe(false);
  });
});

/**
 * tryApplyStaged 枚举结果 + applyStagedNow 恢复 + M4 守门（修 fable review M1/M2/M4）。
 * 直接 mock 文件/进程边界，断言枚举返回与 restoreBackup / proxy 恢复行为。
 */
describe('CoreUpdateService.tryApplyStaged / applyStagedNow', () => {
  // 真实临时 staged 目录 + sing-box 文件（避免 spy 不可配置的 fs.existsSync）
  const os = require('os');
  const realPath = require('path');
  const stagedDir = fs.mkdtempSync(realPath.join(os.tmpdir(), 'shadowvpn-staged-'));
  const coreName = process.platform === 'win32' ? 'sing-box.exe' : 'sing-box';
  fs.writeFileSync(realPath.join(stagedDir, coreName), 'fake-core');
  const STAGED = { version: '1.13.14', dir: stagedDir, stagedAt: 'now' };

  afterAll(() => {
    try {
      fs.rmSync(stagedDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  function makeProxy(running: boolean) {
    // 有状态：stop() 翻转 running→false（拟真，否则 applyStagedNow 停代理后 tryApplyStaged 仍判运行中误 deferred）
    let isRunning = running;
    return {
      getStatus: jest.fn(() => ({ running: isRunning })),
      getCoreVersion: jest.fn().mockResolvedValue('1.13.13'),
      buildPreflightConfigJson: () => null,
      hasNaiveNodes: () => false,
      setAutoRestartSuppressed: jest.fn(),
      setCoreSwapInProgress: jest.fn(),
      stop: jest.fn().mockImplementation(async () => {
        isRunning = false;
      }),
      start: jest.fn().mockResolvedValue(undefined),
    } as any;
  }

  /**
   * 构造一个 staged 已就绪、可落位的 service。
   * @param opts.running 代理是否运行
  
   * @param opts.installImpl installCoreFromDir 桩实现（用于模拟 M2 中途失败）
   */
  function makeSvc(opts: {
    running: boolean;
    installImpl?: (dir: string, ver: any, onBackupDone?: () => void) => Promise<void>;
    hasStaged?: boolean;
  }) {
    const svc = new CoreUpdateService(makeLogManager());
    const proxy = makeProxy(opts.running);
    svc.setProxyManager(proxy);
    svc.setConfigProvider(() => Promise.resolve({} as any));
    svc.setEventSender(() => {});

    // 文件/状态边界打桩
    let staged: any = opts.hasStaged === false ? undefined : { ...STAGED };
    jest.spyOn(svc as any, 'loadAutoState').mockImplementation(() => ({ staged }));
    const clearSpy = jest
      .spyOn(svc as any, 'clearStaged')
      .mockImplementation(() => (staged = undefined));
    jest.spyOn(svc as any, 'emitAutoStatus').mockImplementation(() => {});
    jest.spyOn(svc as any, 'saveAutoState').mockImplementation(() => {});
    jest.spyOn(svc as any, 'getCurrentVersion').mockResolvedValue('1.13.13');
    jest.spyOn(svc as any, 'isKnownBad').mockReturnValue(false);
    jest
      .spyOn(svc as any, 'preflightValidate')
      .mockResolvedValue({ ok: true, version: '1.13.14', versionLine: 'sing-box version 1.13.14' });
    jest.spyOn(svc as any, 'hasBackup').mockReturnValue(true);
    const restoreSpy = jest.spyOn(svc as any, 'restoreBackup').mockResolvedValue(undefined);
    const installSpy = jest
      .spyOn(svc as any, 'installCoreFromDir')
      .mockImplementation((opts.installImpl ?? (async () => {})) as any);
    return { svc, proxy, clearSpy, restoreSpy, installSpy };
  }

  afterEach(() => jest.restoreAllMocks());

  it('代理未运行 + install 成功 → applied，清 staged', async () => {
    const { svc, clearSpy } = makeSvc({ running: false });
    const r = await svc.tryApplyStaged('proxy-stopped');
    expect(r).toBe('applied');
    expect(clearSpy).toHaveBeenCalled();
  });

  it('代理运行中 → deferred，不换核、保留 staged', async () => {
    const { svc, installSpy, clearSpy } = makeSvc({ running: true });
    const r = await svc.tryApplyStaged('proxy-stopped');
    expect(r).toBe('deferred');
    expect(installSpy).not.toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it('M2：install 中途失败（已备份）→ failed 且 restoreBackup 被调用，staged 保留', async () => {
    const { svc, restoreSpy, clearSpy } = makeSvc({
      running: false,
      installImpl: async (_d, _v, onBackupDone) => {
        onBackupDone?.(); // 备份已完成
        throw new Error('disk full mid-copy'); // 复制半截失败
      },
    });
    const r = await svc.tryApplyStaged('proxy-stopped');
    expect(r).toBe('failed');
    expect(restoreSpy).toHaveBeenCalledTimes(1);
    expect(clearSpy).not.toHaveBeenCalled(); // 失败保留 staged 待重试
  });

  it('M2：install 失败但尚未备份 → failed 且不误调 restoreBackup（不恢复陈旧 .bak）', async () => {
    const { svc, restoreSpy } = makeSvc({
      running: false,
      installImpl: async () => {
        throw new Error('fail before backup'); // onBackupDone 未触发
      },
    });
    const r = await svc.tryApplyStaged('proxy-stopped');
    expect(r).toBe('failed');
    expect(restoreSpy).not.toHaveBeenCalled();
  });

  it('统一自动更新在停核后安全应用暂存内核', async () => {
    const { svc, installSpy, clearSpy } = makeSvc({ running: false });
    const r = await svc.tryApplyStaged('proxy-stopped');
    expect(r).toBe('applied');
    expect(installSpy).toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalled();
  });

  it('手动应用与自动应用共用落位机制', async () => {
    const { svc } = makeSvc({ running: false });
    const r = await svc.tryApplyStaged('manual-apply');
    expect(r).toBe('applied');
  });

  it('staged 不再领先当前 → discarded', async () => {
    const { svc, clearSpy } = makeSvc({ running: false });
    jest.spyOn(svc as any, 'getCurrentVersion').mockResolvedValue('1.13.14'); // 已是该版本
    const r = await svc.tryApplyStaged('proxy-stopped');
    expect(r).toBe('discarded');
    expect(clearSpy).toHaveBeenCalled();
  });

  it('无 staged → noop', async () => {
    const { svc } = makeSvc({ running: false, hasStaged: false });
    const r = await svc.tryApplyStaged('proxy-stopped');
    expect(r).toBe('noop');
  });

  it('落位前重预检失败 → markKnownBad + clearStaged → discarded', async () => {
    const { svc, clearSpy, installSpy } = makeSvc({ running: false });
    // 重预检返回 ok:false（下载到落位间 config 变）→ 标记坏 + 清 staged，绝不落位
    jest.spyOn(svc as any, 'preflightValidate').mockResolvedValue({
      ok: false,
      version: '1.13.14',
      versionLine: 'sing-box version 1.13.14',
      reason: 'config invalid',
    });
    const markBadSpy = jest.spyOn(svc as any, 'markKnownBad').mockImplementation(() => {});
    const r = await svc.tryApplyStaged('proxy-stopped');
    expect(r).toBe('discarded');
    expect(markBadSpy).toHaveBeenCalledWith('1.13.14');
    expect(clearSpy).toHaveBeenCalled();
    expect(installSpy).not.toHaveBeenCalled(); // 重预检失败 → 不换核
  });

  it('staged 暂存核心文件缺失 → clearStaged → discarded（不预检不换核）', async () => {
    // staged.dir 指向一个空临时目录（无 sing-box 二进制）
    const emptyDir = fs.mkdtempSync(realPath.join(os.tmpdir(), 'shadowvpn-staged-empty-'));
    const { svc, clearSpy, installSpy } = makeSvc({ running: false });
    (svc as any).loadAutoState = () => ({
      staged: { version: '1.13.14', dir: emptyDir, stagedAt: 'now' },
    });
    const preflightSpy = jest.spyOn(svc as any, 'preflightValidate');
    const r = await svc.tryApplyStaged('proxy-stopped');
    expect(r).toBe('discarded');
    expect(clearSpy).toHaveBeenCalled();
    expect(preflightSpy).not.toHaveBeenCalled(); // 文件缺失早于重预检
    expect(installSpy).not.toHaveBeenCalled();
    try {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('isUpdating 重入（已有落位/更新在途）→ noop', async () => {
    const { svc, installSpy, clearSpy } = makeSvc({ running: false });
    (svc as any).isUpdating = true; // 模拟另一更新流程持闸在途
    const r = await svc.tryApplyStaged('proxy-stopped');
    expect(r).toBe('noop');
    expect(installSpy).not.toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it('M1：applyStagedNow wasRunning + install 失败 → 仍恢复代理(start)，返回 failed', async () => {
    jest.useRealTimers(); // applyStagedNow 内 setTimeout(2000) 需真实定时器
    (globalThis as any).setTimeout = realSetTimeout; // 钉回真实 setTimeout（jest30 useRealTimers 不恢复 global）
    const { svc, proxy } = makeSvc({
      running: true,
      installImpl: async (_d, _v, onBackupDone) => {
        onBackupDone?.();
        throw new Error('mid-copy fail');
      },
    });
    const r = await svc.applyStagedNow();
    expect(r).toBe('failed');
    expect(proxy.stop).toHaveBeenCalled();
    expect(proxy.start).toHaveBeenCalled(); // 不留停止态
  });

  it('M1：applyStagedNow wasRunning + applied → 落位后重启代理', async () => {
    jest.useRealTimers(); // 同上：applyStagedNow 内 setTimeout 需真实定时器
    (globalThis as any).setTimeout = realSetTimeout; // 同上钉回
    const { svc, proxy } = makeSvc({ running: true });
    const r = await svc.applyStagedNow();
    expect(r).toBe('applied');
    expect(proxy.stop).toHaveBeenCalled();
    expect(proxy.start).toHaveBeenCalled();
  });
});

describe('B0：兼容版本带去硬编码 + verifiedCeiling', () => {
  // 真跑 checkUpdate 的兼容带闸，只 mock 网络/版本/状态依赖
  function rawSvc(opts: { current: string; latest: string; autoState: any; restrict?: boolean }) {
    const svc = new CoreUpdateService(makeLogManager());
    svc.setConfigProvider(() =>
      Promise.resolve({ restrictCoreUpdateToCompatibleMinor: opts.restrict ?? true } as any)
    );
    jest.spyOn(svc as any, 'getCurrentVersion').mockResolvedValue(opts.current);
    jest.spyOn(svc as any, 'loadAutoState').mockReturnValue(opts.autoState);
    jest.spyOn(svc as any, 'isKnownBad').mockReturnValue(false);
    jest
      .spyOn((svc as any).coreDownloader, 'fetchReleases')
      .mockResolvedValue([
        { tag_name: `v${opts.latest}`, prerelease: false, assets: [{ name: 'x' }] },
      ]);
    jest.spyOn((svc as any).coreDownloader, 'findSuitableAsset').mockReturnValue({
      browser_download_url: `http://x/sing-box-${opts.latest}.tar.gz`,
      // 真实 GitHub API 对每个 asset 恒返回 digest；缺它会被完整性门拒装（这正是该门的意图），
      // 故 mock 也要带上，否则测的是「拒装」而非本 suite 关心的调度/stage 逻辑。
      digest: `sha256:${'a'.repeat(64)}`,
    });
    return svc;
  }

  it('出厂带地板(=bundled 1.14)：current 1.14 + 无 verifiedCeiling → 高于地板的 1.15 跨带被拦', async () => {
    // WS-D 换核后 bundled=1.14 → 出厂带地板升至 1.14；原「1.13→1.14 被拦」过时（1.14 已是地板内、放行追平）。
    // 改测高于新地板的 1.15：无 verifiedCeiling 不放行跨带。
    const r = await rawSvc({ current: '1.14.0', latest: '1.15.0', autoState: {} }).checkUpdate();
    expect(r.hasUpdate).toBe(false);
    expect(r.latestVersion).toBe('1.15.0');
  });

  it('verifiedCeiling=1014（已实证 1.14）→ 1.14 放行', async () => {
    const r = await rawSvc({
      current: '1.13.13',
      latest: '1.14.0',
      autoState: { verifiedCeiling: 1014 },
    }).checkUpdate();
    expect(r.hasUpdate).toBe(true);
    expect(r.downloadUrl).toBeTruthy();
  });

  it('current 实跑 1.14（手动升过）→ 1.14 内 patch 放行（current 纳入有效上限）', async () => {
    const r = await rawSvc({ current: '1.14.0', latest: '1.14.5', autoState: {} }).checkUpdate();
    expect(r.hasUpdate).toBe(true);
  });

  it('关 restrict → 跨带不经兼容带闸，直接放行', async () => {
    const r = await rawSvc({
      current: '1.13.13',
      latest: '1.14.0',
      autoState: {},
      restrict: false,
    }).checkUpdate();
    expect(r.hasUpdate).toBe(true);
  });

  // recordSuccessfulVersion 已去 core-version.json 写（旧持久位废除，改 push 型 pendingChangeNotice）→ 无平台相关写盘、全平台可跑。
  it('verifiedCeiling 棘轮升：成功运行 1.14.0 → 写 verifiedCeiling=1014', async () => {
    const svc = new CoreUpdateService(makeLogManager());
    jest.spyOn(svc as any, 'getCurrentVersion').mockResolvedValue('1.14.0');
    jest.spyOn(svc as any, 'clearKnownBad').mockImplementation(() => {});
    let state: any = { verifiedCeiling: 1013 };
    jest.spyOn(svc as any, 'loadAutoState').mockImplementation(() => state);
    const saved: any[] = [];
    jest.spyOn(svc as any, 'saveAutoState').mockImplementation((p: any) => {
      saved.push(p);
      state = { ...state, ...p };
    });
    await svc.recordSuccessfulVersion();
    expect(saved).toContainEqual({ verifiedCeiling: 1014 });
  });

  it('verifiedCeiling 不降级：成功运行 1.13（低于已验证 1.14）→ 不覆盖', async () => {
    const svc = new CoreUpdateService(makeLogManager());
    jest.spyOn(svc as any, 'getCurrentVersion').mockResolvedValue('1.13.20');
    jest.spyOn(svc as any, 'clearKnownBad').mockImplementation(() => {});
    jest.spyOn(svc as any, 'loadAutoState').mockReturnValue({ verifiedCeiling: 1014 });
    const saved: any[] = [];
    jest.spyOn(svc as any, 'saveAutoState').mockImplementation((p: any) => saved.push(p));
    await svc.recordSuccessfulVersion();
    expect(saved.find((s) => 'verifiedCeiling' in s)).toBeUndefined();
  });
});
