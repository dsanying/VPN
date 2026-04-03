/**
 * 应用分流预设列表
 * 每个应用对应一个或多个 geosite 标签，底层映射到 sing-box 的 rule_set 机制
 */

export interface AppPreset {
  /** 应用唯一 ID */
  id: string;
  /** i18n key，对应 rules.apps.XXX */
  labelKey: string;
  /** Emoji 图标 */
  emoji: string;
  /** 对应的 geosite 标签数组（可能有多个） */
  geositeTags: string[];
  /** 分类 */
  category: 'video' | 'social' | 'ai' | 'tools' | 'game';
}

export const APP_PRESETS: AppPreset[] = [
  // ── 视频 ──────────────────────────────────────────
  {
    id: 'youtube',
    labelKey: 'youtube',
    emoji: '▶️',
    geositeTags: ['youtube'],
    category: 'video',
  },
  {
    id: 'netflix',
    labelKey: 'netflix',
    emoji: '🎬',
    geositeTags: ['netflix'],
    category: 'video',
  },
  {
    id: 'tiktok',
    labelKey: 'tiktok',
    emoji: '🎵',
    geositeTags: ['tiktok'],
    category: 'video',
  },
  {
    id: 'bilibili',
    labelKey: 'bilibili',
    emoji: '📺',
    geositeTags: ['bilibili'],
    category: 'video',
  },
  // ── 社交 ──────────────────────────────────────────
  {
    id: 'telegram',
    labelKey: 'telegram',
    emoji: '✈️',
    geositeTags: ['telegram'],
    category: 'social',
  },
  {
    id: 'twitter',
    labelKey: 'twitter',
    emoji: '🐦',
    geositeTags: ['twitter'],
    category: 'social',
  },
  {
    id: 'instagram',
    labelKey: 'instagram',
    emoji: '📷',
    geositeTags: ['instagram'],
    category: 'social',
  },
  // ── AI ────────────────────────────────────────────
  {
    id: 'openai',
    labelKey: 'openai',
    emoji: '🤖',
    geositeTags: ['openai'],
    category: 'ai',
  },
  {
    id: 'anthropic',
    labelKey: 'anthropic',
    emoji: '🧠',
    geositeTags: ['anthropic'],
    category: 'ai',
  },
  {
    id: 'gemini',
    labelKey: 'gemini',
    emoji: '✨',
    geositeTags: ['google'],
    category: 'ai',
  },
  // ── 工具 ──────────────────────────────────────────
  {
    id: 'github',
    labelKey: 'github',
    emoji: '🐙',
    geositeTags: ['github'],
    category: 'tools',
  },
  {
    id: 'google',
    labelKey: 'google',
    emoji: '🔍',
    geositeTags: ['google'],
    category: 'tools',
  },
  {
    id: 'spotify',
    labelKey: 'spotify',
    emoji: '🎧',
    geositeTags: ['spotify'],
    category: 'tools',
  },
  {
    id: 'apple',
    labelKey: 'apple',
    emoji: '🍎',
    geositeTags: ['apple'],
    category: 'tools',
  },
  // ── 游戏 ──────────────────────────────────────────
  {
    id: 'steam',
    labelKey: 'steam',
    emoji: '🎮',
    geositeTags: ['steam'],
    category: 'game',
  },
  {
    id: 'disney',
    labelKey: 'disney',
    emoji: '🏰',
    geositeTags: ['disney'],
    category: 'video',
  },
];

/** 根据 appId 快速查找预设 */
export function getAppPreset(appId: string): AppPreset | undefined {
  return APP_PRESETS.find((p) => p.id === appId);
}

/** 获取某个 category 下的所有预设 */
export function getAppPresetsByCategory(category: AppPreset['category']): AppPreset[] {
  return APP_PRESETS.filter((p) => p.category === category);
}
