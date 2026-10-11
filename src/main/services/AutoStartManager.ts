import { app } from 'electron';
import type { LogLevel } from '../../shared/types';
import type { LogManager } from './LogManager';

export interface IAutoStartManager {
  setAutoStart(enabled: boolean): Promise<boolean>;
  isAutoStartEnabled(): Promise<boolean>;
  setLogManager(lm: LogManager): void;
}

/**
 * 两个实现共用的日志混入：注入 LogManager（由主流程在 index.ts 统一注入）；
 * 注入前走 console fallback。Source 固定 'AutoStart'。
 */
abstract class AutoStartLogBase {
  protected logManager?: LogManager;

  setLogManager(lm: LogManager): void {
    this.logManager = lm;
  }

  protected log(level: LogLevel, message: string): void {
    if (this.logManager) {
      this.logManager.addLog(level, message, 'AutoStart');
      return;
    }
    if (level === 'error' || level === 'fatal') console.error(message);
    else if (level === 'warn') console.warn(message);
    else console.log(message);
  }
}

class ElectronAutoStart extends AutoStartLogBase implements IAutoStartManager {
  async setAutoStart(enabled: boolean): Promise<boolean> {
    try {
      // Startup reconciliation must not rewrite an already-correct OS registration.
      if ((await this.isAutoStartEnabled()) === enabled) return true;
      app.setLoginItemSettings({
        openAtLogin: enabled,
        path: app.getPath('exe'),
        ...(process.platform === 'win32' ? { enabled } : {}),
      });
      // Read the OS registration, including Windows Startup Apps' disabled state.
      const actual = await this.isAutoStartEnabled();
      if (actual !== enabled) return false;
      this.log('info', `Set openAtLogin: ${enabled}`);
      return true;
    } catch {
      return false;
    }
  }

  async isAutoStartEnabled(): Promise<boolean> {
    // Electron 44 parses the lookup path as a command line on Windows.
    // Quote it so custom installation directories containing spaces remain intact.
    // Newer Electron versions also accept surrounding quotes (upstream #54364).
    const executable = app.getPath('exe');
    const settings = app.getLoginItemSettings({
      path: process.platform === 'win32' ? `"${executable}"` : executable,
    });
    return (
      settings.openAtLogin &&
      (process.platform !== 'win32' || settings.executableWillLaunchAtLogin !== false)
    );
  }
}

class LinuxAutoStart extends AutoStartLogBase implements IAutoStartManager {
  private get autostartDir(): string {
    const home = process.env.HOME || '';
    return require('path').join(home, '.config', 'autostart');
  }

  private get desktopFilePath(): string {
    return require('path').join(this.autostartDir, 'shadow-vpn.desktop');
  }

  async setAutoStart(enabled: boolean): Promise<boolean> {
    const fs = require('fs/promises');

    try {
      if (enabled) {
        await fs.mkdir(this.autostartDir, { recursive: true });

        const desktopContent = `[Desktop Entry]
Type=Application
Version=1.0
Name=暗影VPN
Comment=ShadowVPN Proxy Client
Exec="${app.getPath('exe')}" --hidden
Icon=${require('./ResourceManager').resourceManager.getAppIconPath()}
Terminal=false
Categories=Network;Proxy;
X-GNOME-Autostart-enabled=true
`;
        await fs.writeFile(this.desktopFilePath, desktopContent, 'utf-8');
      } else {
        await fs.unlink(this.desktopFilePath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
      return (await this.isAutoStartEnabled()) === enabled;
    } catch (error) {
      this.log('error', `Failed to set Linux autostart: ${error}`);
      return false;
    }
  }

  async isAutoStartEnabled(): Promise<boolean> {
    const fs = require('fs/promises');
    try {
      await fs.access(this.desktopFilePath);
      return true;
    } catch {
      return false;
    }
  }
}

export function createAutoStartManager(): IAutoStartManager {
  if (process.platform === 'linux') {
    return new LinuxAutoStart();
  }
  return new ElectronAutoStart();
}
