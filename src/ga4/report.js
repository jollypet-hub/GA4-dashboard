// 共用的 GA4 回應解析：依欄位標頭把資料列轉成物件，並整理資料限制說明。

export const round = (n, d = 2) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);
export const ratio = (a, b, d = 4) => (typeof a === 'number' && typeof b === 'number' && b > 0 ? round(a / b, d) : null);

// 把 GA4 回應轉成 [{ 維度: 值, 指標: 數字 }]；多日期區間時會有 dateRange 欄位
export function parseTable(response) {
  const dims = (response.dimensionHeaders ?? []).map((h) => h.name);
  const mets = (response.metricHeaders ?? []).map((h) => h.name);
  return (response.rows ?? []).map((row) => {
    const out = {};
    dims.forEach((name, i) => {
      out[name] = row.dimensionValues?.[i]?.value ?? null;
    });
    mets.forEach((name, i) => {
      const raw = row.metricValues?.[i]?.value;
      out[name] = raw === undefined || raw === null || raw === '' ? null : Number(raw);
    });
    return out;
  });
}

export function dataNotes(meta = {}, extra = []) {
  const notes = [
    'GA4 資料通常延遲 24–48 小時，最近兩天的數字可能仍會變動。',
    'GA4 受 Cookie 同意設定與追蹤阻擋影響，與 Cyberbiz 訂單數可能不一致；對帳需另取訂單彙總。',
    ...extra,
  ];
  if (meta.subjectToThresholding) notes.push('部分資料因 GA4 門檻設定被隱藏，數字可能偏低。');
  if (meta.samplingMetadatas?.length) notes.push('此報表使用了抽樣資料。');
  if (meta.dataLossFromOtherRow) notes.push('部分資料被歸入 (other) 列。');
  return notes;
}

export function envelope(response, { propertyId, current, previous }) {
  const meta = response?.metadata ?? {};
  return {
    property_id: propertyId,
    currency: meta.currencyCode || null,
    time_zone: meta.timeZone || null,
    period: current,
    comparison_period: previous ?? null,
    quota_tokens_remaining_today: response?.propertyQuota?.tokensPerDay?.remaining ?? null,
  };
}

export const NO_DATA_MESSAGE = '查詢期間 GA4 沒有回傳任何資料列。這代表沒有資料，不代表數值為 0；請確認日期或追蹤設定。';

export function dateRanges(current, previous) {
  const r = [{ startDate: current.startDate, endDate: current.endDate, name: 'current' }];
  if (previous) r.push({ startDate: previous.startDate, endDate: previous.endDate, name: 'previous' });
  return r;
}
