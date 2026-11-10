// 經營總覽＋期間比較：購買營收、總營收、交易數、客單價、購買轉換率。
// 口徑固定，並把定義一起回傳，避免分析時混用。

const METRICS = ['sessions', 'totalUsers', 'transactions', 'purchaseRevenue', 'totalRevenue'];

export const OVERVIEW_DEFINITIONS = {
  sessions: '工作階段數',
  totalUsers: '使用者總數',
  transactions: '交易筆數（purchase 事件中不重複的交易 ID 數）',
  purchaseRevenue: '購買營收：purchase 事件營收，不含應用程式內購與廣告收益',
  totalRevenue: '總營收：購買營收＋訂閱＋廣告收益，可能大於購買營收',
  avgOrderValue: '客單價 = 購買營收 ÷ 交易筆數（分子分母同為 purchase 口徑）',
  purchaseRatePerSession: '購買轉換率（工作階段口徑）= 交易筆數 ÷ 工作階段數；同一工作階段多筆交易時會略為高估',
};

export function buildOverviewRequest(propertyId, current, previous) {
  const dateRanges = [{ startDate: current.startDate, endDate: current.endDate, name: 'current' }];
  if (previous) dateRanges.push({ startDate: previous.startDate, endDate: previous.endDate, name: 'previous' });
  return {
    property: `properties/${propertyId}`,
    dateRanges,
    metrics: METRICS.map((name) => ({ name })),
    returnPropertyQuota: true,
  };
}

function derive(m) {
  return {
    ...m,
    avgOrderValue: m.transactions > 0 ? round(m.purchaseRevenue / m.transactions) : null,
    purchaseRatePerSession: m.sessions > 0 ? round(m.transactions / m.sessions, 4) : null,
  };
}

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

function changePct(cur, prev) {
  if (!cur || !prev) return null;
  const out = {};
  for (const k of Object.keys(cur)) {
    const a = cur[k];
    const b = prev[k];
    out[k] = typeof a === 'number' && typeof b === 'number' && b !== 0 ? round(((a - b) / b) * 100, 1) : null;
  }
  return out;
}

export function parseOverview(response, { propertyId, current, previous }) {
  const byRange = {};
  for (const row of response.rows ?? []) {
    // 多個日期區間時 GA4 會自動加上 dateRange 維度；單一區間則沒有維度
    const name = row.dimensionValues?.[0]?.value || 'current';
    const values = {};
    METRICS.forEach((metric, i) => {
      const raw = row.metricValues?.[i]?.value;
      values[metric] = raw === undefined || raw === null || raw === '' ? null : Number(raw);
    });
    byRange[name] = derive(values);
  }

  const meta = response.metadata ?? {};
  const notes = [
    'GA4 資料通常延遲 24–48 小時，最近兩天的數字可能仍會變動。',
    'GA4 受 Cookie 同意設定與追蹤阻擋影響，與 Cyberbiz 訂單數可能不一致；對帳需另取訂單彙總。',
  ];
  if (meta.subjectToThresholding) notes.push('部分資料因 GA4 門檻設定被隱藏，數字可能偏低。');
  if (meta.samplingMetadatas?.length) notes.push('此報表使用了抽樣資料。');
  if (meta.dataLossFromOtherRow) notes.push('部分資料被歸入 (other) 列。');

  const status = (name) => (byRange[name] ? 'ok' : 'no_data');
  const result = {
    property_id: propertyId,
    currency: meta.currencyCode || null,
    time_zone: meta.timeZone || null,
    period: { ...current, status: status('current') },
    comparison_period: previous ? { ...previous, status: status('previous') } : null,
    current: byRange.current ?? null,
    previous: previous ? byRange.previous ?? null : undefined,
    change_pct: previous ? changePct(byRange.current, byRange.previous) : undefined,
    definitions: OVERVIEW_DEFINITIONS,
    data_notes: notes,
    quota_tokens_remaining_today: response.propertyQuota?.tokensPerDay?.remaining ?? null,
  };
  if (!byRange.current) {
    result.message = '查詢期間 GA4 沒有回傳任何資料列。這代表沒有資料，不代表數值為 0；請確認日期或追蹤設定。';
  }
  return result;
}
