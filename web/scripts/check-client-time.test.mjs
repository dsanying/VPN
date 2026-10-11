import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { checkTimeSource } from './check-client-time.mjs';
test('拒绝硬编码展示时区、原样时间字段和 ISO 可见值', () => {
  for (const text of ['const BUSINESS_TIME_ZONE="UTC";', 'dayjs(value).tz("Asia/Shanghai")', '<AtomicValue text={log.timestamp}/>', '<p>{now().toISOString()}</p>', 'const c={dataIndex:"updatedAt"}']) assert.ok(checkTimeSource(ts, text).length, text);
});
test('设备时区、统一 formatter、明确来源时区与存储 ISO 合法', () => {
  const text = `const zone=getDeviceTimeZone(); const parsed=dayjs(value).tz(zone); const stamp=now().toISOString();
  const known=parseServerTime(value,'Asia/Shanghai'); const x=<AtomicValue text={formatDateTime(log.timestamp)}/>;
  const c={dataIndex:'updatedAt',render:(_,r)=>formatDateTime(r.updatedAt)};`;
  assert.deepEqual(checkTimeSource(ts, text), []);
});
