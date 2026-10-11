import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { closeMeasurementDatabases, measurementDatabase } from '../MeasurementDatabase';

it('releases one profile while preserving its persisted measurements and other profiles', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'measurement-lifecycle-'));
  const firstFile = path.join(directory, 'first.sqlite');
  const secondFile = path.join(directory, 'second.sqlite');
  try {
    const first = measurementDatabase(firstFile);
    const second = measurementDatabase(secondFile);
    const record = { node: { fingerprint: 'fixture', latency: 12 } };
    first.replace('nodes', record);
    second.replace('nodes', record);
    closeMeasurementDatabases(firstFile);
    closeMeasurementDatabases(firstFile);
    expect(() => first.read('nodes')).toThrow('closed');
    expect(second.read('nodes')).toEqual(record);
    const reopened = measurementDatabase(firstFile);
    expect(reopened).not.toBe(first);
    expect(reopened.read('nodes')).toEqual(record);
    closeMeasurementDatabases(firstFile);
    fs.rmSync(firstFile);
    expect(fs.existsSync(firstFile)).toBe(false);
  } finally {
    closeMeasurementDatabases(firstFile);
    closeMeasurementDatabases(secondFile);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
