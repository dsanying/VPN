import { BrowserWindow, WebContents } from 'electron';

export class IpcEventEmitter {
  private windows: Set<BrowserWindow> = new Set();

  registerWindow(window: BrowserWindow): void {
    this.windows.add(window);

    window.on('closed', () => {
      this.windows.delete(window);
    });
  }

  unregisterWindow(window: BrowserWindow): void {
    this.windows.delete(window);
  }

  sendToAll<T = any>(channel: string, data: T): void {
    for (const window of this.windows) {
      // webContents 可在 window 仍存活时先死（render-process-gone/GPU 崩溃/退出竞态），
      // 对死 wc send 会同步 throw——判 webContents.isDestroyed 而不只是 window.isDestroyed。
      const wc = window.isDestroyed() ? null : window.webContents;
      if (wc && !wc.isDestroyed()) {
        wc.send(channel, data);
      }
    }
  }

  sendToWindow<T = any>(window: BrowserWindow, channel: string, data: T): void {
    const wc = window.isDestroyed() ? null : window.webContents;
    if (wc && !wc.isDestroyed()) {
      wc.send(channel, data);
    }
  }

  sendToWebContents<T = any>(webContents: WebContents, channel: string, data: T): void {
    if (!webContents.isDestroyed()) {
      webContents.send(channel, data);
    }
  }

  getWindowCount(): number {
    return this.windows.size;
  }

  clear(): void {
    this.windows.clear();
  }
}

export const ipcEventEmitter = new IpcEventEmitter();

export function broadcastEvent<T = any>(channel: string, data: T): void {
  ipcEventEmitter.sendToAll(channel, data);
}
