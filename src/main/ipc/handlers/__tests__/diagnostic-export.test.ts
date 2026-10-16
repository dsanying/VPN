import { exportDiagnosticReport } from '../diagnostic-handlers';
import type { DiagnosticService } from '../../../services/DiagnosticService';
import { dialog } from 'electron';
import * as fs from 'fs/promises';
jest.mock('electron', () => ({
  app: { getPreferredSystemLanguages: () => ['en-US'] },
  dialog: { showSaveDialog: jest.fn() },
}));
jest.mock('fs/promises', () => ({ writeFile: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../ipc-handler', () => ({ registerIpcHandler: jest.fn() }));

test('native and renderer export share one picker, preserve cancellation and retry', async () => {
  const service = {
    buildReport: jest.fn(async () => 'sanitized report'),
  } as unknown as DiagnosticService;
  const picker = jest.mocked(dialog.showSaveDialog);
  picker.mockResolvedValueOnce({ canceled: true, filePath: '' });
  const first = exportDiagnosticReport(service);
  expect(exportDiagnosticReport(service)).toBe(first);
  expect(await first).toEqual({ success: false, error: 'cancelled' });
  expect(fs.writeFile).not.toHaveBeenCalled();
  picker.mockResolvedValueOnce({ canceled: false, filePath: '/tmp/fixture-report.md' });
  expect(await exportDiagnosticReport(service)).toMatchObject({ success: true });
  expect(fs.writeFile).toHaveBeenCalledWith('/tmp/fixture-report.md', 'sanitized report', {
    encoding: 'utf-8',
    mode: 0o600,
  });
  expect(service.buildReport).toHaveBeenCalledTimes(2);
});
