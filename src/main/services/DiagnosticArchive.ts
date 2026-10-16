import * as fs from 'fs/promises';
import path from 'path';
import { redactDeep } from '../../shared/diagnostic-redact';
import { redactLogText, redactLogValue } from '../../shared/log-redact';

/** Fixed file list only: no arbitrary directory traversal or imported credential stores. */
export async function collectLogArchive(directory: string) {
  const files = [];
  for (const name of ['app.5.log', 'app.4.log', 'app.3.log', 'app.2.log', 'app.1.log', 'app.log']) {
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(path.join(directory, name), 'r');
      const stat = await handle.stat();
      const budget = 256 * 1024;
      const start = Math.max(0, stat.size - budget);
      const buffer = Buffer.alloc(Math.min(stat.size, budget));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      let content = buffer.subarray(0, bytesRead).toString('utf8');
      if (start > 0)
        content = content.includes('\n') ? content.slice(content.indexOf('\n') + 1) : '';
      // A concurrent append may leave an incomplete JSONL record. Mark the loss explicitly.
      const incompleteTail = !!content && !content.endsWith('\n');
      if (incompleteTail) content = content.slice(0, content.lastIndexOf('\n') + 1);
      files.push({
        name,
        status: 'read',
        sizeBytes: stat.size,
        capturedBytes: Buffer.byteLength(content),
        truncated: start > 0,
        incompleteTail,
        modifiedAt: stat.mtime.toISOString(),
        content: content
          .split('\n')
          .map((line) => {
            if (!line) return line;
            try {
              return JSON.stringify(redactLogValue(redactDeep(JSON.parse(line))));
            } catch {
              return redactLogText(line);
            }
          })
          .join('\n'),
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? 'unknown';
      files.push({ name, status: code === 'ENOENT' ? 'missing' : 'unavailable', errorCode: code });
    } finally {
      await handle?.close();
    }
  }
  return files;
}
