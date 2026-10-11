import dayjs, { type Dayjs } from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import relativeTime from "dayjs/plugin/relativeTime.js";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(relativeTime);

export type TimeInput = string | number | Date | Dayjs | null | undefined;

/** 每次读取设备时区，不缓存语言、旧偏移或启动时的猜测。 */
export function getDeviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** 当前实际时刻，使用设备时区展示。 */
export const now = (): Dayjs => dayjs().tz(getDeviceTimeZone());

const TIME_TEXT = /^(\d{4}-\d{2}(?:-\d{2})?)(?:[ T](\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const CIVIL_FORMAT = "YYYY-MM-DD HH:mm:ss.SSS";

/**
 * 数字明确为 Unix 毫秒；ISO 偏移、Date、Dayjs 保留绝对时刻后换算到设备时区。
 * 无偏移字符串默认设备本地时间；来源有明确时区契约时由调用方传 sourceTimeZone。
 * 日期/月标签按其本地日历解析，缺失、非法日期返回无效值，不当成当前时间。
 */
export function parseServerTime(value: TimeInput, sourceTimeZone?: string): Dayjs {
  const deviceZone = getDeviceTimeZone();
  if (value == null || value === "" || typeof value === "number" && !Number.isFinite(value)) return dayjs(NaN);
  if (typeof value !== "string") {
    const parsed = dayjs(value);
    return parsed.isValid() ? parsed.tz(deviceZone) : dayjs(NaN);
  }
  const match = TIME_TEXT.exec(value.trim());
  if (!match) return dayjs(NaN);
  const [, date, time, seconds, fraction, offset] = match;
  if (time && date.length !== 10 || offset && !time) return dayjs(NaN);
  const civil = `${date.length === 7 ? `${date}-01` : date} ${time ?? "00:00"}:${seconds ?? "00"}.${(fraction ?? "0").padEnd(3, "0").slice(0, 3)}`;
  if (!dayjs.utc(civil, CIVIL_FORMAT, true).isValid()) return dayjs(NaN);
  if (offset) {
    if (offset !== "Z") {
      const digits = offset.slice(1).replace(":", "");
      if (Number(digits.slice(0, 2)) > 23 || Number(digits.slice(2)) > 59) return dayjs(NaN);
    }
    return dayjs(`${civil.replace(" ", "T")}${offset}`).tz(deviceZone);
  }
  const parsed = dayjs.tz(civil, CIVIL_FORMAT, sourceTimeZone ?? deviceZone);
  // 夏令时跳过的本地时刻不能悄悄改成另一个时刻。
  if (parsed.format(CIVIL_FORMAT) !== civil) return dayjs(NaN);
  return parsed.tz(deviceZone);
}

/** 传输用显式本地偏移，保留时刻；界面禁止直接显示这个序列化结果。 */
export const toOffsetDateTime = (value: Dayjs) => {
  if (!value.isValid()) return "";
  const local = value.tz(getDeviceTimeZone());
  return local.format(local.millisecond() === 0 ? "YYYY-MM-DDTHH:mm:ssZ" : "YYYY-MM-DDTHH:mm:ss.SSSZ");
};

export const DATE_FORMAT = "YYYY/MM/DD";
export const MONTH_FORMAT = "YYYY/MM";
export const YEAR_FORMAT = "YYYY";
export const DATE_TIME_FORMAT = `${DATE_FORMAT} HH:mm:ss`;
export const DATE_TIME_MINUTE_FORMAT = `${DATE_FORMAT} HH:mm`;
export const CLOCK_TIME_FORMAT = "HH:mm:ss";
export const MONTH_DAY_FORMAT = "MM/DD";
export const MONTH_DAY_TIME_FORMAT = `${MONTH_DAY_FORMAT} HH:mm`;

function formatTime(value: TimeInput, pattern: string): string {
  const parsed = parseServerTime(value);
  return parsed.isValid() ? parsed.format(pattern) : "—";
}

export const formatClockMinute = (value: TimeInput) => formatTime(value, "HH:mm");
export const formatClockTime = (value: TimeInput) => formatTime(value, CLOCK_TIME_FORMAT);
export const formatDateTime = (value: TimeInput) => formatTime(value, DATE_TIME_FORMAT);
export const formatDateTimeMinute = (value: TimeInput) => formatTime(value, DATE_TIME_MINUTE_FORMAT);
export const formatDate = (value: TimeInput) => formatTime(value, DATE_FORMAT);
export const formatMonthDay = (value: TimeInput) => formatTime(value, MONTH_DAY_FORMAT);
export const formatMonthDayTime = (value: TimeInput) => formatTime(value, MONTH_DAY_TIME_FORMAT);
export const formatRelativeTime = (value: TimeInput) => {
  const parsed = parseServerTime(value);
  return parsed.isValid() ? parsed.locale(dayjs.locale()).from(now()) : "—";
};

/** 日期桶是日历标签，完整时间串是事件时刻；后者不能原样露出 T/Z。 */
export const formatDateLabel = (value: string) => {
  if (/^\d{4}-\d{2}$/.test(value)) return formatTime(value, MONTH_FORMAT);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
  if (/^\d{4}-\d{2}-\d{2}[ T]/.test(value)) return formatDateTime(value);
  return value;
};

export const formatCompactDate = (value: string) => {
  const parsed = parseServerTime(value);
  return parsed.isValid() ? parsed.format("YYMMDD") : "unknown";
};

/** 设备本地日界；起止各自计算偏移，跨夏令时不能按固定 24 小时拼接。 */
export const rangeOfRecentDays = (days: number, anchor: TimeInput = now()) => {
  if (!Number.isInteger(days) || days < 1) throw new RangeError("days must be a positive integer");
  const end = parseServerTime(anchor);
  return {
    startTime: toOffsetDateTime(end.subtract(days - 1, "day").startOf("day")),
    endTime: toOffsetDateTime(end.endOf("day")),
  };
};
export const getDefaultRange = () => rangeOfRecentDays(30);
