/**
 * TrayManager 菜单映射回归（#75）。
 *
 * 守护「托盘状态头 / 启停开关 / 图标」三者恒与 isProxyRunning 一致」——即同一次渲染内不可能出现
 * 「状态头=已连接 而 开关=连接代理」这种自相矛盾（截图里的现象其实是托盘整体停在断开态、未随
 * 代理 started 刷新；根因修复在 index.ts on('started') 补刷，本测守住菜单映射这一半）。
 *
 * 仅依赖 electron / ResourceManager mock；不拉主进程 bootstrap。
 */

// ── electron mock：捕获 Menu.buildFromTemplate 传入的模板以做断言 ──────────────
let lastTemplate: any[] = [];
const buildFromTemplate = jest.fn((tpl: any[]) => {
  lastTemplate = tpl;
  return { __menu: true, template: tpl };
});
const imgStub: any = { resize: () => imgStub, setTemplateImage: jest.fn(), isEmpty: () => false };

jest.mock('electron', () => ({
  // currentLanguage 初值改用 getPreferredSystemLanguages（getLocale 恒返 app bundle locale=en 不可用）→ mock 返中文偏好。
  app: {
    getLocale: () => 'zh-CN',
    getPreferredSystemLanguages: () => ['zh-Hans-CN'],
    isPackaged: false,
    dock: { setMenu: jest.fn() },
  },
  BrowserWindow: class {},
  Tray: class {
    setToolTip = jest.fn();
    setImage = jest.fn();
    setContextMenu = jest.fn();
    destroy = jest.fn();
    on = jest.fn();
  },
  Menu: { buildFromTemplate: (tpl: any[]) => buildFromTemplate(tpl) },
  nativeImage: {
    createFromPath: () => imgStub,
    createFromDataURL: () => imgStub,
    createFromBuffer: () => imgStub,
    createEmpty: () => imgStub,
  },
}));

// loadTrayIcon 内 require('./ResourceManager')，给个返回固定路径的桩（真实 fs.existsSync 对该路径返回 false
// → 走 createDefaultTrayIcon → nativeImage.createFromDataURL，全部命中上面的桩）。
const getTrayIconPath = jest.fn((_connected?: boolean) => '/nonexistent/tray-icon.png');
jest.mock('../ResourceManager', () => ({
  resourceManager: { getTrayIconPath: (connected?: boolean) => getTrayIconPath(connected) },
}));

import { TrayManager, type TrayMenuData } from '../TrayManager';
import { app } from 'electron';
import { setMainLanguage } from '../../i18n';

const makeLogger = () => ({ addLog: jest.fn() }) as any;

const baseData = (isProxyRunning: boolean): TrayMenuData => ({
  isProxyRunning,
  servers: [],
  subscriptions: [],
  selectedServerId: null,
  proxyMode: 'smart',
  proxyModeType: 'tun',
});

/** 从最近一次模板里取「状态头」label 与「启停开关」label。 */
function readMenu(): { status: string; toggle: string } {
  const status = String(lastTemplate[0]?.label ?? '');
  const toggleItem = lastTemplate.find((i) => i?.label === '连接代理' || i?.label === '断开代理');
  return { status, toggle: String(toggleItem?.label ?? '') };
}

function makeTray(): TrayManager {
  const tm = new TrayManager(null, makeLogger(), {});
  tm.createTray();
  return tm;
}

beforeEach(() => {
  lastTemplate = [];
  buildFromTemplate.mockClear();
  getTrayIconPath.mockClear();
  // 托盘文案改走主进程 i18n（mt 读中央语言持有点）。真机由 index.ts 启动按系统偏好初始化；
  // 测试显式设中文（对应本套 mock 的 zh-Hans-CN 系统偏好），以断言中文标签。
  setMainLanguage('zh-CN');
});

describe('TrayManager 菜单状态映射 (#75)', () => {
  it('代理运行中 → 状态头「已连接」且开关「断开代理」', () => {
    const tm = makeTray();
    tm.updateFullTrayMenu(baseData(true));

    const { status, toggle } = readMenu();
    expect(status).toBe('已连接');
    expect(toggle).toBe('断开代理');
    // 状态头带圆点图标（connected）
    expect(lastTemplate[0]?.icon).toBe(imgStub);
  });

  it('代理已停止 → 状态头「已断开」且开关「连接代理」', () => {
    const tm = makeTray();
    tm.updateFullTrayMenu(baseData(false));

    const { status, toggle } = readMenu();
    expect(status).toBe('已断开');
    expect(toggle).toBe('连接代理');
  });

  it('hasError → 状态头「连接异常」（开关仍按运行态）', () => {
    const tm = makeTray();
    tm.updateFullTrayMenu({ ...baseData(false), hasError: true });
    expect(readMenu().status).toBe('连接异常');
  });

  it('不变量：状态头与开关恒一致，绝不出现「已连接 + 连接代理」', () => {
    const tm = makeTray();
    for (const running of [true, false, true, false]) {
      tm.updateFullTrayMenu(baseData(running));
      const { status, toggle } = readMenu();
      if (status === '已连接') expect(toggle).toBe('断开代理');
      if (status === '已断开') expect(toggle).toBe('连接代理');
    }
  });

  it('updateTrayMenu(true) 简化入口也渲染连接态', () => {
    const tm = makeTray();
    tm.updateTrayMenu(true);
    expect(readMenu()).toEqual({ status: '已连接', toggle: '断开代理' });
  });

  it('updateTrayIcon(connected) 取彩色图标并 setImage', () => {
    const tm = makeTray();
    tm.updateTrayIcon('connected');
    // getTrayIconPath(connected=true)
    expect(getTrayIconPath).toHaveBeenCalledWith(true);
  });

  describe('updateSpeedTestResults keepTestingState（出口伴测合并不复位在飞测速态）', () => {
    it('keepTestingState:true → isSpeedTesting 不复位、结果仍合并', () => {
      const tm = makeTray();
      const priv = tm as unknown as {
        isSpeedTesting: boolean;
        speedTestResults: Map<string, number | null>;
      };
      tm.setSpeedTesting(true);
      tm.updateSpeedTestResults(new Map([['a', 42]]), [], { keepTestingState: true });
      expect(priv.isSpeedTesting).toBe(true); // 未复位（在飞全量测速托盘态不被伴测熄灭）
      expect(priv.speedTestResults.get('a')).toBe(42); // 仍合并入延迟表
    });

    it('缺省（无 keepTestingState）→ isSpeedTesting 复位（既有测速入口行为不变）', () => {
      const tm = makeTray();
      const priv = tm as unknown as { isSpeedTesting: boolean };
      tm.setSpeedTesting(true);
      tm.updateSpeedTestResults(new Map([['b', 7]]), []);
      expect(priv.isSpeedTesting).toBe(false);
    });
  });
});

it('托盘节点名称复用测量地区，刷新和失效不改写原始名称', () => {
  const tm = makeTray();
  const servers = [
    { id: 'region-node', name: '日本名称', protocol: 'vmess' },
  ] as TrayMenuData['servers'];
  const labels = (): string[] => {
    const collect = (items: any[]): string[] =>
      items.flatMap((item) => [
        String(item.label ?? ''),
        ...collect(Array.isArray(item.submenu) ? item.submenu : []),
      ]);
    return collect(lastTemplate);
  };
  tm.updateFullTrayMenu({ ...baseData(true), servers, nodeRegions: { 'region-node': 'SG' } });
  expect(labels().some((label) => label.startsWith('自建节点 / 🇸🇬 日本名称'))).toBe(true);
  tm.updateSpeedTestResults(new Map(), servers, { nodeRegions: { 'region-node': 'JP' } });
  expect(labels().some((label) => label.startsWith('自建节点 / 🇯🇵 日本名称'))).toBe(true);
  tm.updateFullTrayMenu({ ...baseData(true), servers, nodeRegions: {} });
  expect(labels().some((label) => label.startsWith('自建节点 / 🌐 日本名称'))).toBe(true);
  expect(servers[0].name).toBe('日本名称');
});

it('Dock 与托盘共用当前功能，Dock 不重复系统退出项', () => {
  const tm = makeTray();
  tm.updateFullTrayMenu(baseData(false));
  const templates = buildFromTemplate.mock.calls.slice(-2).map((call) => call[0]);
  if (process.platform === 'darwin') {
    expect(app.dock?.setMenu).toHaveBeenCalled();
    expect(templates[1]).toEqual(templates[0].slice(0, -2));
  }
  const labels = lastTemplate.map((item) => item.label).filter(Boolean);
  expect(labels).toEqual(
    expect.arrayContaining([
      '打开暗影VPN',
      '连接代理',
      '选择节点',
      '分流方式',
      '打开设置',
      '全部测速',
    ])
  );
  expect(labels).not.toEqual(expect.arrayContaining(['进入轻量模式']));
  expect(labels).not.toContain('检查更新');
  expect(lastTemplate.find((item) => item.label === '连接代理').enabled).toBe(false);
  expect(lastTemplate.find((item) => item.label === '全部测速').enabled).toBe(false);
});

it('仅显示实际节点来源；选用节点后可以连接', () => {
  const onStartProxy = jest.fn();
  const onManageServers = jest.fn();
  const tm = new TrayManager(null, makeLogger(), { onStartProxy, onManageServers });
  tm.createTray();
  tm.updateFullTrayMenu({
    ...baseData(false),
    selectedServerId: 'a',
    servers: [
      { id: 'a', name: '示例', address: 'example.com', protocol: 'vmess', subscriptionId: 's' },
    ] as any,
    subscriptions: [{ id: 's', name: '示例订阅' }] as any,
  });
  const nodes = lastTemplate.find((item) => item.label === '选择节点').submenu;
  expect(
    nodes.some(
      (item: any) => item.label === '直连' || item.label === '自建节点' || item.label === '组网'
    )
  ).toBe(false);
  lastTemplate.find((item) => item.label === '管理节点组').click();
  expect(onManageServers).toHaveBeenCalledTimes(1);
  const connect = lastTemplate.find((item) => item.label === '连接代理');
  expect(connect.enabled).toBe(true);
  connect.click();
  expect(onStartProxy).toHaveBeenCalledTimes(1);
});

it('测速或排序刷新不会清除异常状态，断开仍保留已知测速结果', () => {
  const tm = makeTray();
  tm.updateFullTrayMenu({ ...baseData(false), hasError: true });
  tm.setSortByLatency(true);
  expect(readMenu().status).toBe('连接异常');
  tm.updateSpeedTestResults(new Map([['a', 42]]), []);
  tm.updateTrayIcon('idle');
  expect((tm as any).speedTestResults.get('a')).toBe(42);
});
