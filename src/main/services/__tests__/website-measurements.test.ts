import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { WebsiteMeasurementStore } from '../WebsiteMeasurementStore';
it('restores real website outcomes across restart and clears a mismatched route context', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'website-measurements-'));
  const file = path.join(dir, 'measurements.sqlite');
  try {
    const result = {
      results: { Google: { status: 'ok' as const, httpStatus: 204 } },
      checkedAt: Date.now(),
      egress: null,
    };
    new WebsiteMeasurementStore(file).save('route1', result);
    expect(new WebsiteMeasurementStore(file).read('route1')).toEqual(result);
    expect(new WebsiteMeasurementStore(file).read('route2')).toBeNull();
    expect(new WebsiteMeasurementStore(file).read('route1')).toBeNull();
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
