/**
 * LAN 解析器「活体探测 + 漂移跟随」单测（2026-10-30 内网 API 反复中断的收尾修复）。
 *
 * 背景：dns-lan 弃 type:'dhcp'（校园网对已租约客户端的 DHCP 重发现不应答，真机单日「初次成功 3 次、
 * 重取超时 103 次」，核启动数秒后内网解析即死）改 udp 直指启动时实测的解析器 IP。换网跟随改由
 * 链路变化 watcher 的漂移检测负责——这一组测试钉住漂移判定的纯函数语义、mac 免劫持探测的解析、
 * 以及 getLanResolverForDns 的「新鲜值优先、marker 回退」合并顺序。
 */
jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  const util = jest.requireActual('util');
  const execFile = jest.fn();
  const exec = jest.fn();
  // promisify 认 fn[util.promisify.custom]；真 execFile/exec 自带，jest.fn 不带 → 不补的话 promisify
  // 会退回「回调首值」语义，{ stdout } 解构直接拿到 undefined，测出来的是夹具的毛病而不是被测代码的。
  for (const fn of [execFile, exec]) {
    Object.defineProperty(fn, util.promisify.custom, {
      value: (...args: unknown[]) =>
        new Promise((resolve, reject) => {
          (fn as unknown as jest.Mock)(...args, (err: unknown, stdout: string, stderr: string) =>
            err ? reject(err) : resolve({ stdout, stderr })
          );
        }),
    });
  }
  return { ...actual, execFile, exec };
});

import { exec, execFile } from 'child_process';
import { MacOSSystemDns, SystemDnsBase } from '../SystemDnsManager';
import { shouldFollowLanResolverDrift } from '../DnsInterfaceWatcher';

type Cb = (e: Error | null, stdout: string, stderr: string) => void;

/** exec/execFile 按命令首词给输出（undefined = 抛错）。 */
function stubChildProcess(plan: Record<string, string | undefined>): void {
  const impl = (bin: string, ...rest: unknown[]) => {
    const cb = rest.find((a) => typeof a === 'function') as Cb | undefined;
    const out = plan[String(bin)];
    if (cb) {
      if (out === undefined) cb(new Error(`${bin} failed`), '', '');
      else cb(null, out, '');
    }
    return undefined as never;
  };
  (exec as unknown as jest.Mock).mockImplementation((cmd: string, ...rest: unknown[]) =>
    impl(String(cmd).trim().split(/\s+/)[0], ...rest)
  );
  (execFile as unknown as jest.Mock).mockImplementation((bin: string, ...rest: unknown[]) =>
    impl(String(bin), ...rest)
  );
}

beforeEach(() => {
  (exec as unknown as jest.Mock).mockReset();
  (execFile as unknown as jest.Mock).mockReset();
  jest.restoreAllMocks();
});

describe('shouldFollowLanResolverDrift（漂移判定纯函数）', () => {
  it('无信息（null/空数组）→ null：探测失败是常态噪音，不得据此重启断流', () => {
    expect(shouldFollowLanResolverDrift(null, '10.20.220.50')).toBeNull();
    expect(shouldFollowLanResolverDrift([], '10.20.220.50')).toBeNull();
  });

  it('候选里无私网 IPv4 → null（公网解析器不满足 dns-lan 内网语义）', () => {
    expect(shouldFollowLanResolverDrift(['8.8.8.8', '240e::1'], '10.20.220.50')).toBeNull();
  });

  it('与当前一致 → null（同网噪音事件 RA/DHCP renew 绝不能重启核）', () => {
    expect(shouldFollowLanResolverDrift(['10.20.220.50'], '10.20.220.50')).toBeNull();
  });

  it('新私网解析器 ≠ 当前 → 返回新 IP（调用方重启核重生成配置）', () => {
    expect(shouldFollowLanResolverDrift(['10.20.221.240'], '10.20.220.50')).toBe('10.20.221.240');
  });

  it('当前为 null（旧网络无内网解析器）而新网络有 → 跟随', () => {
    expect(shouldFollowLanResolverDrift(['10.20.220.50'], null)).toBe('10.20.220.50');
  });

  it('受控 IP 即便出现也被跳过（接管残留态不误判）', () => {
    expect(shouldFollowLanResolverDrift(['8.8.8.8'], null)).toBeNull();
  });
});

describe('MacOSSystemDns.readLanResolversLive（免劫持活体探测）', () => {
  it('netstat 字面 default 表项定位物理网卡 → ipconfig getoption 直读 DHCP lease（核运行中 /1 路由不干扰）', async () => {
    // 模拟核运行中的真实路由表：auto_route 拆出的 0/1、128.0/1 经 utun，字面 default 仍指 en0，
    // 另有 Internet 共享桥（gateway=link#N）与其它 VPN 的 utun 字面 default 干扰项。
    stubChildProcess({
      netstat: [
        'Routing tables',
        '',
        'Internet:',
        'Destination        Gateway            Flags               Netif Expire',
        'default            10.31.15.254       UGScg                 en0',
        'default            link#22            UCSIg           bridge100      !',
        'default            198.18.0.1         UGScg                utun9',
        '0/1                198.18.0.1         UGScg                utun9',
        '128.0/1            198.18.0.1         UGScg                utun9',
      ].join('\n'),
      ipconfig: '{ 10.20.220.50, 10.20.220.51 }',
    });
    const dns = new MacOSSystemDns();
    await expect(dns.readLanResolversLive()).resolves.toEqual(['10.20.220.50', '10.20.220.51']);
    // 只对过滤后存活的物理接口读 lease：bridge/utun 全部剔除
    expect((execFile as unknown as jest.Mock).mock.calls.map((c) => c[1])).toEqual([
      ['getoption', 'en0', 'domain_name_server'],
    ]);
  });

  it('netstat 失败 → 回退 route -n get default（核停止时二者等价，旧路径兼容）', async () => {
    stubChildProcess({
      netstat: undefined,
      route: '   gateway: 10.31.15.254\ninterface: en0\n',
      ipconfig: '{ 10.20.220.50, 10.20.220.51 }',
    });
    const dns = new MacOSSystemDns();
    await expect(dns.readLanResolversLive()).resolves.toEqual(['10.20.220.50', '10.20.220.51']);
    expect((execFile as unknown as jest.Mock).mock.calls[0][1]).toEqual([
      'getoption',
      'en0',
      'domain_name_server',
    ]);
  });

  it('路由均读不到 / ipconfig 失败 → 空数组（fail-soft，调用方按无信息处理）', async () => {
    stubChildProcess({ netstat: undefined, route: undefined, ipconfig: '10.20.220.50' });
    await expect(new MacOSSystemDns().readLanResolversLive()).resolves.toEqual([]);

    stubChildProcess({ netstat: undefined, route: 'interface: en0', ipconfig: undefined });
    await expect(new MacOSSystemDns().readLanResolversLive()).resolves.toEqual([]);
  });
});

describe('getLanResolverForDns（新鲜值优先、marker 回退）', () => {
  const markerOf = (original: Record<string, string[]>) =>
    JSON.stringify({ controlledIp: '8.8.8.8', original, at: Date.now() });

  function makeDns(scutilOut: string | undefined): MacOSSystemDns {
    stubChildProcess({ scutil: scutilOut ?? '' });
    const dns = new MacOSSystemDns();
    if (scutilOut === undefined) {
      jest
        .spyOn(
          dns as unknown as { readEffectiveResolvers: () => Promise<string[]> },
          'readEffectiveResolvers'
        )
        .mockRejectedValue(new Error('scutil down'));
    }
    return dns;
  }

  it('新鲜值优先：scutil 的当前网络解析器压过旧 marker（换网后旧 marker 不得把 dns-lan 指回旧网关）', async () => {
    jest
      .spyOn(SystemDnsBase, 'readMarker')
      .mockReturnValue(JSON.parse(markerOf({ 'Wi-Fi': ['10.20.221.240'] })));
    const dns = makeDns('resolver #1\n  nameserver[0] : 10.20.220.50\n');
    await expect(dns.getLanResolverForDns()).resolves.toBe('10.20.220.50');
  });

  it('系统 DNS 已被接管（scutil 仅受控 IP）→ 自然落 marker 的真实原始值', async () => {
    jest
      .spyOn(SystemDnsBase, 'readMarker')
      .mockReturnValue(JSON.parse(markerOf({ 'Wi-Fi': ['10.20.221.240'] })));
    const dns = makeDns('resolver #1\n  nameserver[0] : 8.8.8.8\n');
    await expect(dns.getLanResolverForDns()).resolves.toBe('10.20.221.240');
  });

  it('mid-session 重启（2026-11-01 内网 API 断真机场景）：scutil=受控 IP、marker 因 DHCP 模式返空 → DHCP lease 直读兜住', async () => {
    // 更新 apply 停→立刻起：stop 腿不还原 DNS → scutil 只剩受控 8.8.8.8；
    // 校园网 DHCP 模式 → marker.original 是空数组（networksetup 对 DHCP 返空，setDns 捕获时即空）；
    // 唯一能给出校园解析器的是接管免疫的 ipconfig getoption（DHCP lease 直读）。
    jest.spyOn(SystemDnsBase, 'readMarker').mockReturnValue(JSON.parse(markerOf({ 'Wi-Fi': [] })));
    stubChildProcess({
      scutil: 'resolver #1\n  nameserver[0] : 8.8.8.8\n',
      ipconfig: '10.20.221.240',
      // netstat -rn -f inet（readLanResolversLive 先读字面 default 表项定位接入网接口）
      netstat: '   default            10.31.15.254       UGScg                 en0\n',
    });
    const dns = new MacOSSystemDns();
    await expect(dns.getLanResolverForDns()).resolves.toBe('10.20.221.240');
  });

  it('读 marker 抛错/无 marker 且 scutil 失败 → null（退回 dns-local，不 brick 起核）', async () => {
    jest.spyOn(SystemDnsBase, 'readMarker').mockImplementation(() => {
      throw new Error('fs broken');
    });
    const dns = makeDns(undefined);
    await expect(dns.getLanResolverForDns()).resolves.toBeNull();
  });
});
