import { CustomAppPreset } from './types';

/**
 * 应用分流预设列表
 * 每个应用对应一个或多个 geosite 标签，底层映射到 sing-box 的 rule_set 机制
 */

export interface AppPreset {
  /** 应用唯一 ID */
  id: string;
  /** i18n key，对应 rules.apps.XXX */
  labelKey: string;
  /** Emoji 图标（兜备用） */
  emoji: string;
  /** 图标 URL（Qure Color 彩色图标集） */
  iconUrl?: string;
  /** 对应的 geosite 标签数组（可能有多个） */
  geositeTags: string[];
  /** 对应的 geoip 标签数组（可能有多个，可选） */
  geoipTags?: string[];
  /** 分类 */
  category: 'video' | 'social' | 'ai' | 'tools' | 'game';
}

const QURE_BASE = 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color';

export const APP_PRESETS: AppPreset[] = [
  // ── 视频 ──────────────────────────────────────────
  {
    id: 'youtube',
    labelKey: 'youtube',
    emoji: '▶️',
    iconUrl: `${QURE_BASE}/YouTube.png`,
    geositeTags: ['youtube', 'googlevideo'],
    geoipTags: ['youtube'],
    category: 'video',
  },
  {
    id: 'netflix',
    labelKey: 'netflix',
    emoji: '🎬',
    iconUrl: `${QURE_BASE}/Netflix.png`,
    geositeTags: ['netflix'],
    geoipTags: ['netflix'],
    category: 'video',
  },
  {
    id: 'tiktok',
    labelKey: 'tiktok',
    emoji: '🎵',
    iconUrl: `${QURE_BASE}/TikTok.png`,
    geositeTags: ['tiktok'],
    geoipTags: ['tiktok'],
    category: 'video',
  },
  {
    id: 'bilibili',
    labelKey: 'bilibili',
    emoji: '📺',
    iconUrl: `${QURE_BASE}/bilibili.png`,
    geositeTags: ['bilibili'],
    category: 'video',
  },
  // ── 社交 ──────────────────────────────────────────
  {
    id: 'telegram',
    labelKey: 'telegram',
    emoji: '✈️',
    iconUrl: `${QURE_BASE}/Telegram.png`,
    geositeTags: ['telegram'],
    geoipTags: ['telegram'],
    category: 'social',
  },
  {
    id: 'twitter',
    labelKey: 'twitter',
    emoji: '🐦',
    iconUrl: `${QURE_BASE}/X.png`,
    geositeTags: ['twitter'],
    geoipTags: ['twitter'],
    category: 'social',
  },
  {
    id: 'instagram',
    labelKey: 'instagram',
    emoji: '📷',
    iconUrl: `${QURE_BASE}/Instagram.png`,
    geositeTags: ['instagram'],
    category: 'social',
  },
  // ── AI ────────────────────────────────────────────
  {
    id: 'openai',
    labelKey: 'openai',
    emoji: '🤖',
    iconUrl: `${QURE_BASE}/ChatGPT.png`,
    geositeTags: ['openai'],
    category: 'ai',
  },
  {
    id: 'anthropic',
    labelKey: 'anthropic',
    emoji: '🧠',
    iconUrl:
      'https://raw.githubusercontent.com/lige47/QuanX-icon-rule/main/icon/04ProxySoft/claude.png',
    geositeTags: ['anthropic'],
    category: 'ai',
  },
  {
    id: 'gemini',
    labelKey: 'gemini',
    emoji: '✨',
    iconUrl:
      'https://raw.githubusercontent.com/lige47/QuanX-icon-rule/main/icon/04ProxySoft/gemini.png',
    geositeTags: ['google-gemini', 'google-palm', 'google'],
    geoipTags: ['google'],
    category: 'ai',
  },
  // ── 工具 ──────────────────────────────────────────
  {
    id: 'github',
    labelKey: 'github',
    emoji: '🐙',
    iconUrl: `${QURE_BASE}/GitHub.png`,
    geositeTags: ['github'],
    category: 'tools',
  },
  {
    id: 'google',
    labelKey: 'google',
    emoji: '🔍',
    iconUrl: `${QURE_BASE}/Google_Search.png`,
    geositeTags: ['google'],
    geoipTags: ['google'],
    category: 'tools',
  },
  {
    id: 'spotify',
    labelKey: 'spotify',
    emoji: '🎧',
    iconUrl: `${QURE_BASE}/Spotify.png`,
    geositeTags: ['spotify'],
    category: 'tools',
  },
  {
    id: 'apple',
    labelKey: 'apple',
    emoji: '🍎',
    iconUrl: `${QURE_BASE}/Apple.png`,
    geositeTags: ['apple'],
    category: 'tools',
  },
  // ── 游戏 ──────────────────────────────────────────
  {
    id: 'steam',
    labelKey: 'steam',
    emoji: '🎮',
    iconUrl: `${QURE_BASE}/Steam.png`,
    geositeTags: ['steam'],
    category: 'game',
  },
  {
    id: 'disney',
    labelKey: 'disney',
    emoji: '🏰',
    iconUrl: `${QURE_BASE}/Disney.png`,
    geositeTags: ['disney'],
    category: 'video',
  },
];

/** 根据 appId 快速查找预设（支持从用户自定义列表中查找） */
export function getAppPreset(
  appId: string,
  customPresets?: CustomAppPreset[]
): AppPreset | undefined {
  const builtin = APP_PRESETS.find((p) => p.id === appId);
  if (builtin) return builtin;

  if (customPresets) {
    const custom = customPresets.find((p) => p.id === appId);
    if (custom) {
      // 将 CustomAppPreset 转换为 AppPreset 兼容格式
      return {
        id: custom.id,
        labelKey: custom.name, // 自定义应用直接存储名称
        emoji: custom.emoji,
        iconUrl: custom.iconUrl,
        geositeTags: custom.geositeTags,
        geoipTags: custom.geoipTags,
        category: 'tools', // 自定义应用默认归类到工具
      };
    }
  }

  return undefined;
}

/** 获取某个 category 下的所有预设 */
export function getAppPresetsByCategory(category: AppPreset['category']): AppPreset[] {
  return APP_PRESETS.filter((p) => p.category === category);
}
