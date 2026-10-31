import * as fs from 'fs';
import * as path from 'path';

/**
 * 更新重启状态标记（userData/update-restart.json）。
 *
 * 解决的问题：App 自更新 = 退出 → 换包 → 重启，代理随退出管线停止；重启后是否重连
 * 原本只看 autoConnect 开关——关着的用户（升级前明明在跑）升级完就莫名断网。
 * 安装更新退出前写入本标记（代理当时是否在跑），重启后恢复连接并删除标记。
 *
 * 新鲜窗口 15 分钟：更新失败回退旧版、或用户隔天手动重开等场景不再自动拉代理——
 * 标记只描述「更新重启后紧接着的那一次启动」。
 */
export interface UpdateRestartState {
  reason: 'app-update';
  /** 安装更新前代理是否在运行（恢复的唯一依据；配置本身在 config 里，无需另存）。 */
  proxyRunning: boolean;
  /** 目标版本（信息性，日志与排查用）。 */
  targetVersion: string;
  /** 写入时刻 ISO。 */
  at: string;
}

/** 标记新鲜窗口：超过即作废（防陈旧标记在无关启动里偷偷拉起代理）。 */
export const UPDATE_RESTART_FRESH_MS = 15 * 60 * 1000;

/**
 * 更新重启状态读写。失败安全（缺失/损坏→null）；原子写（tmp+rename）防进程崩在写盘中途留半截 JSON。
 * userDataDir 注入（非内部 app.getPath）：本 store 不依赖 electron，可独立单测。
 */
export class UpdateRestartStateStore {
  constructor(private readonly userDataDir: string) {}

  private get filePath(): string {
    return path.join(this.userDataDir, 'update-restart.json');
  }

  write(state: UpdateRestartState): void {
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
    fs.renameSync(tmp, this.filePath);
  }

  /** 读取（不删除）；缺失/损坏/过期返回 null。过期不在此删除——删除统一走 consume，避免两处写盘竞争。 */
  read(now = Date.now()): UpdateRestartState | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      return null;
    }
    const state = parsed as Partial<UpdateRestartState> | null;
    if (
      !state ||
      state.reason !== 'app-update' ||
      typeof state.at !== 'string' ||
      typeof state.proxyRunning !== 'boolean'
    )
      return null;
    const at = Date.parse(state.at);
    if (!Number.isFinite(at) || now - at > UPDATE_RESTART_FRESH_MS || now - at < 0) return null;
    return state as UpdateRestartState;
  }

  /** 读取并删除（无论新鲜与否都清掉，一次性语义）。返回新鲜且合法的标记，否则 null。 */
  consume(now = Date.now()): UpdateRestartState | null {
    const state = this.read(now);
    try {
      fs.rmSync(this.filePath, { force: true });
    } catch {
      // 删除失败不阻断恢复；标记新鲜窗口过期后自然作废。
    }
    return state;
  }
}
