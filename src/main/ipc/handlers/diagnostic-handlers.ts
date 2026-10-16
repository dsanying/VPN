import { formatDeviceDate } from '../../../shared/device-time';
import { dialog } from 'electron';
import * as fs from 'fs/promises';
import { IPC_CHANNELS } from '../../../shared/ipc-channels';
import { registerIpcHandler } from '../ipc-handler';
import { getMainLanguage } from '../../i18n';
import type { DiagnosticService } from '../../services/DiagnosticService';

interface ExportResult {
  success: boolean;
  filePath?: string;
  error?: string;
}
const flights = new WeakMap<DiagnosticService, Promise<ExportResult>>();
/** Same native exporter for the renderer and recovery tray; repeated clicks share one picker. */
export function exportDiagnosticReport(service: DiagnosticService): Promise<ExportResult> {
  const existing = flights.get(service);
  if (existing) return existing;
  const task = (async () => {
    const report = await service.buildReport();
    const english = getMainLanguage().startsWith('en');
    const result = await dialog.showSaveDialog({
      title: english ? 'Export Shadow VPN diagnostics' : '导出暗影VPN诊断报告',
      defaultPath: `shadowvpn-diagnostic-${formatDeviceDate(new Date())}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, error: 'cancelled' };
    await fs.writeFile(result.filePath, report, { encoding: 'utf-8', mode: 0o600 });
    return { success: true, filePath: result.filePath };
  })().finally(() => flights.delete(service));
  flights.set(service, task);
  return task;
}
export function registerDiagnosticHandlers(service: DiagnosticService): void {
  registerIpcHandler<void, ExportResult>(IPC_CHANNELS.DIAGNOSTIC_EXPORT, () =>
    exportDiagnosticReport(service)
  );
}
