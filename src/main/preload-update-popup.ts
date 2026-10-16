/**
 * preload-update-popup.ts — 独立更新弹窗窗口的 preload（UpdateService.createUpdatePopup）。
 *
 * contextIsolation:true → 经 contextBridge 暴露最小 API：接主进程推送的四态状态载荷 + 回传按钮/关闭动作。
 * 不引 React、不暴露 Node/其它 ipc。编译入 dist/main/main/preload-update-popup.js（rootDir=src / outDir=dist/main，
 * 与 dashboard-preload 同路径规律）。
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import type { UpdatePopupState, UpdatePopupAction } from '../shared/types/update';

// 界面语言注入（主进程 additionalArguments `--shadowvpn-popup-lang=<code>`）：据此设 <html lang/dir>，
// 修弹窗页 lang 写死 zh-CN（fa 需 rtl）。DOMContentLoaded 后设，覆盖 HTML 静态 lang 属性。
const LANG_PREFIX = '--shadowvpn-popup-lang=';
const langArg = process.argv.find((a) => a.startsWith(LANG_PREFIX));
if (langArg) {
  const code = langArg.slice(LANG_PREFIX.length);
  const applyLang = () => {
    const el = (globalThis as { document?: { documentElement?: { lang: string; dir: string } } })
      .document?.documentElement;
    if (!el || !code) return;
    el.lang = code;
    el.dir = code === 'fa' ? 'rtl' : 'ltr';
  };
  const doc = (
    globalThis as {
      document?: { readyState: string; addEventListener: (t: string, cb: () => void) => void };
    }
  ).document;
  if (doc && doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', applyLang);
  else applyLang();
}

// 主进程在 did-finish-load 重放状态；React effect 可能尚未订阅。缓存最后一帧，避免空白更新窗口。
let latestState: UpdatePopupState | undefined;
const subscribers = new Set<(state: UpdatePopupState) => void>();
ipcRenderer.on(
  IPC_CHANNELS.UPDATE_POPUP_STATE,
  (_event: IpcRendererEvent, state: UpdatePopupState) => {
    latestState = state;
    for (const callback of subscribers) callback(state);
  }
);
contextBridge.exposeInMainWorld('shadowvpnUpdatePopup', {
  onState(callback: (state: UpdatePopupState) => void): () => void {
    subscribers.add(callback);
    if (latestState) callback(latestState);
    return () => {
      subscribers.delete(callback);
    };
  },
  sendAction(action: UpdatePopupAction): void {
    ipcRenderer.send(IPC_CHANNELS.UPDATE_POPUP_ACTION, action);
  },
});
