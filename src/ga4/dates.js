// 日期檢查與比較期間計算。只接受 YYYY-MM-DD，避免模糊的相對日期造成誤判。

const DAY = 86_400_000;
const GA4_MIN_DATE = '2015-08-14';

function parse(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s) return null;
  return t;
}
const fmt = (t) => new Date(t).toISOString().slice(0, 10);

export class DateRangeError extends Error {}

export function validateRange(startDate, endDate, maxDays) {
  const s = parse(startDate);
  const e = parse(endDate);
  if (s === null) throw new DateRangeError(`start_date 格式錯誤，需為 YYYY-MM-DD：${startDate}`);
  if (e === null) throw new DateRangeError(`end_date 格式錯誤，需為 YYYY-MM-DD：${endDate}`);
  if (s > e) throw new DateRangeError('start_date 不可晚於 end_date');
  if (startDate < GA4_MIN_DATE) throw new DateRangeError(`GA4 最早只能查到 ${GA4_MIN_DATE}`);
  // 容許一天誤差（台灣時間與 UTC 換日不同步）
  if (e > Date.now() + DAY) throw new DateRangeError('end_date 不可是未來日期');
  const days = Math.round((e - s) / DAY) + 1;
  if (days > maxDays) throw new DateRangeError(`查詢區間 ${days} 天，超過上限 ${maxDays} 天`);
  return { startDate, endDate, days };
}

// 前期：緊接在本期之前、天數相同
export function previousPeriod({ startDate, days }) {
  const s = parse(startDate);
  const prevEnd = s - DAY;
  const prevStart = prevEnd - (days - 1) * DAY;
  return { startDate: fmt(prevStart), endDate: fmt(prevEnd), days };
}
