import { dirsEquivalent, plistFlagValue, xmlUnescape } from '../helper-plist';

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>Label</key><string>com.dsanying.shadowvpn.helper</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Library/PrivilegedHelperTools/com.dsanying.shadowvpn.helper</string>
    <string>--singbox</string><string>/Library/Application Support/ShadowVPN/core/sing-box</string>
    <string>--confdir</string><string>/Users/alice/Library/Application Support/ShadowVPN</string>
    <string>--support</string><string>/Library/Application Support/ShadowVPN</string>
    <string>--coredir</string><string>/Library/Application Support/ShadowVPN/core</string>
  </array>
</dict>
</plist>`;

describe('plistFlagValue', () => {
  it('提取已烧录的 flag 值', () => {
    expect(plistFlagValue(PLIST, '--confdir')).toBe(
      '/Users/alice/Library/Application Support/ShadowVPN'
    );
    expect(plistFlagValue(PLIST, '--singbox')).toBe(
      '/Library/Application Support/ShadowVPN/core/sing-box'
    );
  });

  it('flag 缺席返回 null（旧版 plist）', () => {
    expect(plistFlagValue(PLIST, '--missing')).toBeNull();
    expect(plistFlagValue('<plist><dict></dict></plist>', '--confdir')).toBeNull();
  });

  it('值内 xml 实体被还原', () => {
    const xml =
      '<string>--confdir</string><string>/Users/a&amp;b/Library/Application Support/ShadowVPN</string>';
    expect(plistFlagValue(xml, '--confdir')).toBe(
      '/Users/a&b/Library/Application Support/ShadowVPN'
    );
  });
});

describe('dirsEquivalent（与 helper cfgAllowed 同口径）', () => {
  const identity = (p: string) => p;

  it('字面相同即等价', () => {
    expect(dirsEquivalent('/a/b', '/a/b', identity)).toBe(true);
    expect(dirsEquivalent('/a/b/', '/a/b', identity)).toBe(true);
    expect(dirsEquivalent('/A/B', '/a/b', identity)).toBe(true);
  });

  it('目录已改名 → 字面不等且 realpath 失败 → 判不等（config-path-denied 场景）', () => {
    const realpath = (p: string) => {
      if (p === '/data/ShadowVPN-FlowZ') throw new Error('ENOENT');
      return p;
    };
    expect(dirsEquivalent('/data/ShadowVPN-FlowZ', '/data/ShadowVPN', realpath)).toBe(false);
  });

  it('软链接两侧归一后相同 → 等价', () => {
    const realpath = (p: string) => (p === '/link/data' ? '/real/data' : p);
    expect(dirsEquivalent('/link/data', '/real/data', realpath)).toBe(true);
    expect(dirsEquivalent('/link/data', '/other/data', realpath)).toBe(false);
  });
});

describe('xmlUnescape', () => {
  it('还原四种实体且不二次替换', () => {
    expect(xmlUnescape('&quot;&gt;&lt;&amp;')).toBe('"><&');
    expect(xmlUnescape('&amp;lt;')).toBe('&lt;');
  });
});
