// GA4 欄位盤點：實際查詢資料，列出哪些事件、欄位有在記錄、有值的比例與範例值。
// 全部唯讀、查詢項目固定；交易 ID 只回報數量，不回傳範例值。

import { Ga4Error } from './client.js';
import { parseTable, ratio } from './report.js';

const NOT_SET = new Set(['(not set)', '']);

// [欄位, 中文名稱, 分類, 用來計算覆蓋率的指標, 只看哪個事件（可省略）, 是否隱藏範例值]
const PROBES = [
  ['itemId', '商品 ID', '商品', 'itemsViewed'],
  ['itemName', '商品名稱', '商品', 'itemsViewed'],
  ['itemBrand', '品牌', '商品', 'itemsViewed'],
  ['itemCategory', '商品類別', '商品', 'itemsViewed'],
  ['itemCategory2', '商品類別 2', '商品', 'itemsViewed'],
  ['itemVariant', '商品規格／款式', '商品', 'itemsViewed'],
  ['itemListName', '商品清單名稱', '商品', 'itemsViewed'],
  ['itemPromotionName', '促銷活動名稱', '商品', 'itemsViewed'],
  ['transactionId', '交易 ID', '訂單', 'ecommercePurchases', null, true],
  ['orderCoupon', '訂單優惠券', '訂單', 'ecommercePurchases'],
  ['shippingTier', '配送方式', '訂單', 'eventCount', 'add_shipping_info'],
  ['sessionDefaultChannelGroup', '預設管道分組', '流量來源', 'sessions'],
  ['sessionSource', '來源（utm_source）', '流量來源', 'sessions'],
  ['sessionMedium', '媒介（utm_medium）', '流量來源', 'sessions'],
  ['sessionCampaignName', '活動名稱（utm_campaign）', '流量來源', 'sessions'],
  ['sessionManualAdContent', '廣告內容（utm_content）', '流量來源', 'sessions'],
  ['sessionManualTerm', '關鍵字（utm_term）', '流量來源', 'sessions'],
  ['sessionGoogleAdsCampaignName', 'Google Ads 廣告活動', '流量來源', 'sessions'],
  ['firstUserSource', '首次造訪來源', '流量來源', 'totalUsers'],
  ['landingPage', '到達網頁', '內容', 'sessions'],
  ['pagePath', '網頁路徑', '內容', 'screenPageViews'],
  ['pageTitle', '網頁標題', '內容', 'screenPageViews'],
  ['searchTerm', '站內搜尋字詞', '內容', 'eventCount', 'view_search_results'],
  ['deviceCategory', '裝置類別', '裝置與技術', 'sessions'],
  ['operatingSystem', '作業系統', '裝置與技術', 'sessions'],
  ['browser', '瀏覽器', '裝置與技術', 'sessions'],
  ['country', '國家', '地區', 'sessions'],
  ['region', '縣市（區域）', '地區', 'sessions'],
  ['city', '城市', '地區', 'sessions'],
  ['newVsReturning', '新舊訪客', '使用者', 'totalUsers'],
  ['userAgeBracket', '年齡層（需 Google 信號）', '使用者', 'totalUsers'],
  ['userGender', '性別（需 Google 信號）', '使用者', 'totalUsers'],
  ['language', '語言', '使用者', 'sessions'],
];

const PURCHASE_METRICS = [
  ['purchaseRevenue', '購買營收'],
  ['grossPurchaseRevenue', '購買總營收（含退款前）'],
  ['refundAmount', '退款金額'],
  ['shippingAmount', '運費'],
  ['taxAmount', '稅金'],
  ['ecommercePurchases', '購買次數'],
  ['totalPurchasers', '購買人數'],
  ['firstTimePurchasers', '首次購買人數'],
];

const statusOf = (coverage) => (coverage === null ? 'no_data' : coverage >= 0.8 ? 'has_data' : coverage > 0.05 ? 'partial' : 'empty');

export async function fieldInventory({ ga4, propertyId, current }) {
  const property = `properties/${propertyId}`;
  const dateRanges = [{ startDate: current.startDate, endDate: current.endDate }];

  async function probe([field, label, group, metric, eventName, hideSamples]) {
    try {
      const res = await ga4.runReport({
        property,
        dateRanges,
        dimensions: [{ name: field }],
        metrics: [{ name: metric }],
        ...(eventName ? { dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { value: eventName } } } } : {}),
        orderBys: [{ metric: { metricName: metric }, desc: true }],
        metricAggregations: ['TOTAL'],
        limit: 250,
      });
      const rows = parseTable(res);
      const total = Number(res.totals?.[0]?.metricValues?.[0]?.value ?? rows.reduce((s, r) => s + (r[metric] ?? 0), 0));
      const set = rows.filter((r) => !NOT_SET.has(r[field]));
      const coverage = total > 0 ? ratio(set.reduce((s, r) => s + (r[metric] ?? 0), 0), total, 3) : null;
      return {
        field,
        label,
        group,
        ...(eventName ? { only_event: eventName } : {}),
        status: statusOf(coverage),
        coverage,
        distinct_values: res.rowCount ?? rows.length,
        samples: hideSamples ? undefined : set.slice(0, 3).map((r) => r[field]),
      };
    } catch (err) {
      if (err instanceof Ga4Error && [3, 12].includes(err.code)) return { field, label, group, status: 'unsupported' };
      throw err;
    }
  }

  const [events, metricsRes, metadata, ...fields] = await Promise.all([
    ga4.runReport({
      property,
      dateRanges,
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
      limit: 200,
    }),
    ga4.runReport({ property, dateRanges, metrics: PURCHASE_METRICS.map(([name]) => ({ name })) }),
    ga4.getMetadata ? ga4.getMetadata(`${property}/metadata`).catch(() => null) : null,
    ...PROBES.map(probe),
  ]);

  // 自訂維度（GA4 管理介面自行建立的），逐一確認有沒有值
  const custom = (metadata?.dimensions ?? []).filter((d) => d.customDefinition).slice(0, 15);
  const customFields = await Promise.all(
    custom.map((d) => probe([d.apiName, d.uiName || d.apiName, '自訂維度', d.apiName.startsWith('customUser:') ? 'totalUsers' : 'eventCount'])),
  );
  const customMetrics = (metadata?.metrics ?? []).filter((m) => m.customDefinition).map((m) => ({ field: m.apiName, label: m.uiName }));

  const mv = metricsRes.rows?.[0]?.metricValues ?? [];
  return {
    property_id: propertyId,
    period: current,
    events: parseTable(events).map((r) => ({ event: r.eventName, count: r.eventCount, users: r.totalUsers })),
    purchase_metrics: PURCHASE_METRICS.map(([name, label], i) => ({ field: name, label, value: mv[i] ? Number(mv[i].value) : null })),
    fields: [...fields, ...customFields],
    custom_metrics: customMetrics,
    definitions: {
      coverage: '有值的比例（以括號內指標加權；例如商品欄位以商品瀏覽次數計算）',
      status: 'has_data＝8 成以上有值；partial＝部分有值；empty＝幾乎沒有值；unsupported＝這個資源不支援此欄位；no_data＝期間內沒有相關事件',
    },
  };
}
