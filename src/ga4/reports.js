// 第 3 階段報表：流量來源、裝置、商品、購買流程（漏斗）、資料健康。
// 每支報表的維度與指標都固定，口徑定義隨結果一起回傳。

import { Ga4Error } from './client.js';
import { NO_DATA_MESSAGE, dataNotes, dateRanges, envelope, parseTable, ratio, round } from './report.js';

const SESSION_METRICS = ['sessions', 'totalUsers', 'transactions', 'purchaseRevenue'];

const SESSION_DEFINITIONS = {
  sessions: '工作階段數',
  totalUsers: '使用者總數',
  transactions: '交易筆數',
  purchaseRevenue: '購買營收（purchase 事件營收）',
  purchaseRatePerSession: '購買轉換率（工作階段口徑）= 交易筆數 ÷ 工作階段數',
  avgOrderValue: '客單價 = 購買營收 ÷ 交易筆數',
  sessions_change: '工作階段增減（本期 − 前期）',
  share_of_sessions_change: '占整體工作階段增減的比例',
};

function derive(m) {
  if (!m) return null;
  return {
    ...m,
    purchaseRatePerSession: ratio(m.transactions, m.sessions),
    avgOrderValue: ratio(m.purchaseRevenue, m.transactions, 2),
  };
}

function sum(rows, keys) {
  const out = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const r of rows) for (const k of keys) out[k] += r?.[k] ?? 0;
  return out;
}

// 依單一維度分組的工作階段報表（流量來源、裝置），可與前期比較
async function groupedSessionReport({ ga4, propertyId, current, previous, dimension, label, limit }) {
  const response = await ga4.runReport({
    property: `properties/${propertyId}`,
    dateRanges: dateRanges(current, previous),
    dimensions: [{ name: dimension }],
    metrics: SESSION_METRICS.map((name) => ({ name })),
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 500,
    returnPropertyQuota: true,
  });
  const rows = parseTable(response);
  const base = envelope(response, { propertyId, current, previous });
  if (rows.length === 0) return { ...base, status: 'no_data', message: NO_DATA_MESSAGE };

  const groups = new Map();
  for (const r of rows) {
    const key = r[dimension] ?? '(not set)';
    const period = r.dateRange === 'previous' ? 'previous' : 'current';
    if (!groups.has(key)) groups.set(key, { current: null, previous: null });
    groups.get(key)[period] = Object.fromEntries(SESSION_METRICS.map((m) => [m, r[m]]));
  }

  const totalCur = sum([...groups.values()].map((g) => g.current), SESSION_METRICS);
  const totalPrev = previous ? sum([...groups.values()].map((g) => g.previous), SESSION_METRICS) : null;
  const totalChange = previous ? totalCur.sessions - totalPrev.sessions : null;

  let items = [...groups.entries()].map(([key, g]) => {
    const item = { [label]: key, current: derive(g.current ?? Object.fromEntries(SESSION_METRICS.map((m) => [m, 0]))) };
    if (previous) {
      item.previous = derive(g.previous ?? Object.fromEntries(SESSION_METRICS.map((m) => [m, 0])));
      item.sessions_change = item.current.sessions - item.previous.sessions;
      item.share_of_sessions_change = totalChange ? round(item.sessions_change / totalChange, 3) : null;
    }
    return item;
  });
  // 有比較期間時依「增減幅度」排序，最能說明變化的來源排前面
  items.sort((a, b) => (previous ? Math.abs(b.sessions_change) - Math.abs(a.sessions_change) : b.current.sessions - a.current.sessions));
  const omitted = Math.max(0, items.length - limit);
  items = items.slice(0, limit);

  return {
    ...base,
    status: 'ok',
    totals: { current: derive(totalCur), previous: derive(totalPrev), sessions_change: totalChange },
    rows: items,
    rows_omitted: omitted,
    sort: previous ? '依工作階段增減的絕對值排序' : '依工作階段數排序',
    definitions: SESSION_DEFINITIONS,
    data_notes: dataNotes(response.metadata, [
      '交易與營收歸屬於工作階段的來源（工作階段範圍），與 GA4 預設的「最後點擊」歸因報表可能不同。',
    ]),
  };
}

export const trafficSources = (ctx) =>
  groupedSessionReport({ ...ctx, dimension: 'sessionSourceMedium', label: 'source_medium' });

export const devices = (ctx) => groupedSessionReport({ ...ctx, dimension: 'deviceCategory', label: 'device', limit: 10 });

// 商品表現（商品範圍指標）
const PRODUCT_METRICS = ['itemsViewed', 'itemsAddedToCart', 'itemsPurchased', 'itemRevenue'];
const SORT_METRIC = { views: 'itemsViewed', add_to_carts: 'itemsAddedToCart', purchases: 'itemsPurchased', revenue: 'itemRevenue' };

export async function products({ ga4, propertyId, current, limit, sortBy = 'views' }) {
  const response = await ga4.runReport({
    property: `properties/${propertyId}`,
    dateRanges: dateRanges(current),
    dimensions: [{ name: 'itemName' }],
    metrics: PRODUCT_METRICS.map((name) => ({ name })),
    orderBys: [{ metric: { metricName: SORT_METRIC[sortBy] }, desc: true }],
    limit,
    metricAggregations: ['TOTAL'],
    returnPropertyQuota: true,
  });
  const rows = parseTable(response);
  const base = envelope(response, { propertyId, current });
  if (rows.length === 0) return { ...base, status: 'no_data', message: NO_DATA_MESSAGE };

  const t = response.totals?.[0]?.metricValues;
  const totals = t
    ? Object.fromEntries(PRODUCT_METRICS.map((m, i) => [m, Number(t[i]?.value ?? 0)]))
    : sum(rows, PRODUCT_METRICS);
  const overallPurchaseRate = ratio(totals.itemsPurchased, totals.itemsViewed);
  const viewsSorted = rows.map((r) => r.itemsViewed ?? 0).sort((a, b) => a - b);
  const p75 = viewsSorted[Math.floor(viewsSorted.length * 0.75)] ?? 0;

  return {
    ...base,
    status: 'ok',
    sort: `依 ${SORT_METRIC[sortBy]} 由高到低`,
    totals: { ...totals, viewToCartRate: ratio(totals.itemsAddedToCart, totals.itemsViewed), viewToPurchaseRate: overallPurchaseRate },
    rows: rows.map((r) => {
      const viewToPurchaseRate = ratio(r.itemsPurchased, r.itemsViewed);
      return {
        item_name: r.itemName,
        itemsViewed: r.itemsViewed,
        itemsAddedToCart: r.itemsAddedToCart,
        itemsPurchased: r.itemsPurchased,
        itemRevenue: r.itemRevenue,
        viewToCartRate: ratio(r.itemsAddedToCart, r.itemsViewed),
        viewToPurchaseRate,
        high_view_low_purchase:
          (r.itemsViewed ?? 0) >= p75 && (r.itemsViewed ?? 0) > 0 && overallPurchaseRate !== null &&
          (viewToPurchaseRate ?? 0) < overallPurchaseRate * 0.5,
      };
    }),
    definitions: {
      itemsViewed: '商品被瀏覽次數（view_item 事件中的商品數）',
      itemsAddedToCart: '商品加入購物車件數',
      itemsPurchased: '商品購買件數',
      itemRevenue: '商品營收（不含運費與稅）',
      viewToCartRate: '加車件數 ÷ 瀏覽次數（商品範圍，非使用者轉換率）',
      viewToPurchaseRate: '購買件數 ÷ 瀏覽次數（商品範圍）',
      high_view_low_purchase: '瀏覽數在本次列表前 25%，且購買率低於整體的一半',
    },
    data_notes: dataNotes(response.metadata, [
      '商品指標需要 Cyberbiz 在電子商務事件中送出 items 參數；若商品名稱是 (not set)，代表事件沒有帶商品資料。',
    ]),
  };
}

// 購買流程：封閉式、依序的使用者漏斗
const FUNNEL_STEPS = [
  { name: '1. 瀏覽商品', event: 'view_item' },
  { name: '2. 加入購物車', event: 'add_to_cart' },
  { name: '3. 開始結帳', event: 'begin_checkout' },
  { name: '4. 完成購買', event: 'purchase' },
];

export async function funnel({ ga4, propertyId, current }) {
  const request = {
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate: current.startDate, endDate: current.endDate }],
    funnel: {
      isOpenFunnel: false,
      steps: FUNNEL_STEPS.map((s) => ({ name: s.name, filterExpression: { funnelEventFilter: { eventName: s.event } } })),
    },
    returnPropertyQuota: true,
  };

  try {
    const response = await ga4.runFunnelReport(request);
    const rows = parseTable(response.funnelTable ?? {});
    const base = { property_id: propertyId, period: current, quota_tokens_remaining_today: response.propertyQuota?.tokensPerDay?.remaining ?? null };
    if (rows.length === 0) return { ...base, status: 'no_data', method: 'funnel', message: NO_DATA_MESSAGE };
    return {
      ...base,
      status: 'ok',
      method: 'funnel',
      steps: rows.map((r) => ({
        step: r.funnelStepName,
        active_users: r.activeUsers,
        completion_rate: round(r.funnelStepCompletionRate, 4),
        abandonments: r.funnelStepAbandonments,
        abandonment_rate: round(r.funnelStepAbandonmentRate, 4),
      })),
      definitions: {
        method: '封閉式漏斗：使用者必須依序完成前一步，才會計入下一步；計算單位是使用者；時間窗口為查詢期間',
        completion_rate: '進到下一步的使用者 ÷ 本步驟使用者',
        abandonment_rate: '沒有進到下一步的比例',
        steps: FUNNEL_STEPS.map((s) => `${s.name}：${s.event}`).join('；'),
      },
      data_notes: [
        ...dataNotes({}),
        'GA4 漏斗報表 API 目前為 alpha 版本，數字以 GA4 後台「探索 > 漏斗」為準交叉確認。',
      ],
    };
  } catch (err) {
    // 漏斗 API 不可用時退回事件總量，但明確標示不是逐步流失率
    if (!(err instanceof Ga4Error) || ![3, 12].includes(err.code)) throw err;
    const response = await ga4.runReport({
      property: `properties/${propertyId}`,
      dateRanges: dateRanges(current),
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
      dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: FUNNEL_STEPS.map((s) => s.event) } } },
      returnPropertyQuota: true,
    });
    const rows = parseTable(response);
    const byEvent = Object.fromEntries(rows.map((r) => [r.eventName, r]));
    return {
      ...envelope(response, { propertyId, current }),
      status: rows.length ? 'ok' : 'no_data',
      method: 'event_totals_fallback',
      warning: '漏斗 API 無法使用，以下只是各事件的總量與觸發人數，不是依序的逐步流失率，不能直接相除當成流失率。',
      events: FUNNEL_STEPS.map((s) => ({
        step: s.name,
        event: s.event,
        event_count: byEvent[s.event]?.eventCount ?? 0,
        users: byEvent[s.event]?.totalUsers ?? 0,
      })),
      data_notes: dataNotes(response.metadata),
    };
  }
}

// 資料健康：每日異常、關鍵事件缺漏、可能重複交易
const KEY_EVENTS = ['page_view', 'view_item', 'add_to_cart', 'begin_checkout', 'add_payment_info', 'purchase'];

const DAY = 86_400_000;
function eachDate(start, end) {
  const out = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += DAY) {
    out.push(new Date(t).toISOString().slice(0, 10).replaceAll('-', ''));
  }
  return out;
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export async function dataHealth({ ga4, propertyId, current }) {
  const property = `properties/${propertyId}`;
  const ranges = dateRanges(current);
  const [daily, events, purchases] = await Promise.all([
    ga4.runReport({
      property,
      dateRanges: ranges,
      dimensions: [{ name: 'date' }],
      metrics: ['sessions', 'transactions', 'purchaseRevenue', 'eventCount'].map((name) => ({ name })),
      orderBys: [{ dimension: { dimensionName: 'date' } }],
      limit: 1000,
      returnPropertyQuota: true,
    }),
    ga4.runReport({
      property,
      dateRanges: ranges,
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: KEY_EVENTS } } },
    }),
    ga4.runReport({
      property,
      dateRanges: ranges,
      dimensions: [{ name: 'transactionId' }],
      metrics: [{ name: 'eventCount' }, { name: 'purchaseRevenue' }],
      dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'purchase' } } },
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
      limit: 10000,
    }),
  ]);

  const findings = [];
  const add = (severity, check, message, detail) => findings.push({ severity, check, message, ...(detail ? { detail } : {}) });

  // 1) 每日流量：缺資料的日子與異常波動
  const dailyRows = parseTable(daily);
  const byDate = Object.fromEntries(dailyRows.map((r) => [r.date, r]));
  const dates = eachDate(current.startDate, current.endDate);
  const missingDays = dates.filter((d) => !byDate[d] || !byDate[d].sessions);
  if (missingDays.length) add('high', 'missing_days', `${missingDays.length} 天沒有任何工作階段，可能是追蹤中斷`, missingDays);
  const med = median(dates.map((d) => byDate[d]?.sessions ?? 0).filter((v) => v > 0));
  const spikes = dates
    .filter((d) => byDate[d]?.sessions && med > 0 && (byDate[d].sessions > med * 3 || byDate[d].sessions < med * 0.3))
    .map((d) => ({ date: d, sessions: byDate[d].sessions, median: med }));
  if (spikes.length) add('medium', 'session_anomaly', '有日子的工作階段高於中位數 3 倍或低於 30%，請確認是否有活動、廣告或追蹤異常', spikes);
  const noSaleDays = dates.filter((d) => (byDate[d]?.sessions ?? 0) > 0 && !byDate[d]?.transactions);

  // 2) 關鍵事件是否存在、順序是否合理
  const ev = Object.fromEntries(parseTable(events).map((r) => [r.eventName, r.eventCount ?? 0]));
  const eventCounts = Object.fromEntries(KEY_EVENTS.map((e) => [e, ev[e] ?? 0]));
  const missingEvents = KEY_EVENTS.filter((e) => !eventCounts[e]);
  if (missingEvents.length) add('high', 'missing_events', `以下關鍵事件在期間內完全沒有出現：${missingEvents.join(', ')}`);
  if (eventCounts.purchase > 0 && eventCounts.begin_checkout < eventCounts.purchase) {
    add('medium', 'checkout_lt_purchase', 'begin_checkout 次數少於 purchase，結帳事件可能漏記');
  }
  if (eventCounts.purchase > 0 && eventCounts.add_to_cart < eventCounts.purchase) {
    add('medium', 'cart_lt_purchase', 'add_to_cart 次數少於 purchase，加車事件可能漏記');
  }

  // 3) 交易 ID：重複、缺漏、零營收
  const purchaseRows = parseTable(purchases);
  const isUnset = (id) => !id || id === '(not set)';
  const dupes = purchaseRows.filter((r) => !isUnset(r.transactionId) && (r.eventCount ?? 0) > 1);
  if (dupes.length) {
    add('high', 'duplicate_transactions', `${dupes.length} 筆交易 ID 的 purchase 事件觸發超過一次，營收可能重複計算`, dupes.slice(0, 10).map((r) => ({ transaction_id: r.transactionId, purchase_events: r.eventCount })));
  }
  const unset = purchaseRows.filter((r) => isUnset(r.transactionId)).reduce((n, r) => n + (r.eventCount ?? 0), 0);
  if (unset) add('high', 'missing_transaction_id', `${unset} 次 purchase 事件沒有交易 ID，無法去重也無法與訂單對帳`);
  const zeroRev = purchaseRows.filter((r) => !isUnset(r.transactionId) && !r.purchaseRevenue).length;
  if (zeroRev) add('medium', 'zero_revenue_purchase', `${zeroRev} 筆交易的營收為 0，可能沒有帶 value 參數`);
  if ((purchases.rowCount ?? 0) > purchaseRows.length) add('low', 'truncated', '交易筆數超過檢查上限，只檢查了前 10,000 筆');

  return {
    ...envelope(daily, { propertyId, current }),
    status: dailyRows.length ? 'ok' : 'no_data',
    ...(dailyRows.length ? {} : { message: NO_DATA_MESSAGE }),
    summary: findings.length ? `發現 ${findings.length} 項需要檢查的問題` : '沒有發現明顯的資料問題',
    findings,
    key_event_counts: eventCounts,
    transactions_checked: purchaseRows.filter((r) => !isUnset(r.transactionId)).length,
    days_with_traffic_but_no_sales: noSaleDays.length,
    daily_session_median: med,
    data_notes: dataNotes(daily.metadata, ['這是 GA4 內部一致性檢查；確認是否漏記訂單，仍需與 Cyberbiz 後台訂單數比對。']),
  };
}

// 每日趨勢：本期每天的工作階段、交易、營收；有比較期間時依「第幾天」對齊前期
const TREND_METRICS = ['sessions', 'transactions', 'purchaseRevenue'];

export async function dailyTrend({ ga4, propertyId, current, previous }) {
  const response = await ga4.runReport({
    property: `properties/${propertyId}`,
    dateRanges: dateRanges(current, previous),
    dimensions: [{ name: 'date' }],
    metrics: TREND_METRICS.map((name) => ({ name })),
    orderBys: [{ dimension: { dimensionName: 'date' } }],
    limit: 1000,
    returnPropertyQuota: true,
  });
  const rows = parseTable(response);
  const base = envelope(response, { propertyId, current, previous });
  if (rows.length === 0) return { ...base, status: 'no_data', message: NO_DATA_MESSAGE, days: [] };

  const pick = (period) =>
    Object.fromEntries(rows.filter((r) => (r.dateRange === 'previous' ? 'previous' : 'current') === period).map((r) => [r.date, r]));
  const cur = pick('current');
  const prev = previous ? pick('previous') : {};
  const curDates = eachDate(current.startDate, current.endDate);
  const prevDates = previous ? eachDate(previous.startDate, previous.endDate) : [];

  const days = curDates.map((d, i) => {
    const c = cur[d];
    const p = previous ? prev[prevDates[i]] : null;
    return {
      date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
      // GA4 不回傳沒有流量的日子；標示 missing，讓畫面顯示為缺口而不是正常的 0
      missing: !c,
      sessions: c?.sessions ?? 0,
      transactions: c?.transactions ?? 0,
      purchaseRevenue: c?.purchaseRevenue ?? 0,
      ...(previous ? { prev_date: prevDates[i], prev_sessions: p?.sessions ?? 0, prev_purchaseRevenue: p?.purchaseRevenue ?? 0 } : {}),
    };
  });
  return { ...base, status: 'ok', days, data_notes: dataNotes(response.metadata) };
}
