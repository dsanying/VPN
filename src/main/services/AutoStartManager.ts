import { app } from 'electron';

export interface IAutoStartManager {
  setAutoStart(enabled: boolean): Promise<boolean>;
  isAutoStartEnabled(): Promise<boolean>;
}

class ElectronAutoStart implements IAutoStartManager {
  async setAutoStart(enabled: boolean): Promise<boolean> {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: app.getPath('exe'),
    });
    console.log(`[AutoStart] Set openAtLogin: ${enabled}`);
    return true;
  }

  async isAutoStartEnabled(): Promise<boolean> {
    const settings = app.getLoginItemSettings();
    return settings.openAtLogin;
  }
}

class LinuxAutoStart implements IAutoStartManager {
  private get autostartDir(): string {
    const home = process.env.HOME || '';
    return require('path').join(home, '.config', 'autostart');
  }

  private get desktopFilePath(): string {
    return require('path').join(this.autostartDir, 'flowz.desktop');
  }

  async setAutoStart(enabled: boolean): Promise<boolean> {
    const fs = require('fs/promises');

    try {
      if (enabled) {
        // 确保目录存在
        await fs.mkdir(this.autostartDir, { recursive: true });

        // 创建 .desktop 文件
        const desktopContent = `[Desktop Entry]
Type=Application
Version=1.0
Name=FlowZ
Comment=FlowZ Proxy Client
Exec="${app.getPath('exe')}" --hidden
Icon=${require('./ResourceManager').resourceManager.getAppIconPath()}
Terminal=false
Categories=Network;Proxy;
X-GNOME-Autostart-enabled=true
`;
        await fs.writeFile(this.desktopFilePath, desktopContent, 'utf-8');
      } else {
        // 删除 .desktop 文件
        await fs.unlink(this.desktopFilePath).catch(() => {});
      }
      return true;
    } catch (error) {
      console.error('[AutoStart] Failed to set Linux autostart:', error);
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
