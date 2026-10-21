/**
 * helper LaunchDaemon plist 的烧录参数读取与目录等价判定（纯函数，供 HelperManager.computeStatus 用）。
 */

/** xmlEscape 的逆（plist 由 HelperManager 生成，仅这四个实体；&amp; 最后解，避免二次替换）。 */
export function xmlUnescape(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

/**
 * 从 LaunchDaemon plist XML 提取 ProgramArguments 中指定 flag 的烧录值。
 * 返回 null = 文件可读但该 flag 缺席（旧版 helper）；调用方自行区分「读文件失败」。
 */
export function plistFlagValue(xml: string, flag: string): string | null {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = xml.match(new RegExp(`<string>${escaped}</string>\\s*<string>([^<]*)</string>`));
  return m ? xmlUnescape(m[1]) : null;
}

function lexicalNorm(p: string): string {
  return p
    .split(/[\\/]+/)
    .filter(Boolean)
    .join('/')
    .toLowerCase();
}

/**
 * 与 helper cfgAllowed 同口径的目录等价判定：
 * 字面规范化相等（含尾斜杠/分隔符差异）直接判等；否则双方经 realpath 归一后再比——
 * realpath 失败的一侧（目录已不存在，如改名迁移后的旧目录）退化为字面规范化值。
 */
export function dirsEquivalent(a: string, b: string, realpath: (p: string) => string): boolean {
  if (lexicalNorm(a) === lexicalNorm(b)) return true;
  const norm = (p: string): string => {
    try {
      return realpath(p);
    } catch {
      return lexicalNorm(p);
    }
  };
  return norm(a).toLowerCase() === norm(b).toLowerCase();
}
