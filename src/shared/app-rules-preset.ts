import { CustomAppPreset } from './types';

/** 应用身份来自已安装应用的可执行路径，不通过网站清单猜测应用。 */

export interface AppPreset {
  id: string;
  /** i18n key，对应 rules.apps.XXX */
  labelKey: string;
  /** iconUrl 加载失败时的兜底图标 */
  emoji: string;
  /** Qure Color 彩色图标集 */
  iconUrl?: string;
  processPaths?: string[];
  processPathRegex?: string[];
  category: 'video' | 'social' | 'ai' | 'tools' | 'game';
}

export function getAppPreset(
  appId: string,
  customPresets?: CustomAppPreset[]
): AppPreset | undefined {
  if (customPresets) {
    const custom = customPresets.find((p) => p.id === appId);
    if (custom) {
      return {
        id: custom.id,
        labelKey: custom.name, // 自定义应用直接存储名称
        emoji: custom.emoji,
        iconUrl: custom.iconUrl,
        // 只传递应用的实际路径和辅助进程路径表达式。
        processPaths: custom.processPaths,
        processPathRegex: custom.processPathRegex,
        category: 'tools', // 后端不消费 category；分组呈现由渲染层直接读 custom.category（此处仅占位满足类型）
      };
    }
  }

  return undefined;
}
