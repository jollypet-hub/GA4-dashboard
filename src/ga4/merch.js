// 儀表板「商品表現」：商品排行（含前期比較與標籤）、商品類別、營收集中度。
// 商品資料來自 Cyberbiz 送進 GA4 電子商務事件的 items 參數。

import { NO_DATA_MESSAGE, dataNotes, dateRanges, envelope, parseTable, ratio, round } from './report.js';

const ITEM_METRICS = ['itemsViewed', 'itemsAddedToCart', 'itemsPurchased', 'itemRevenue'];
const MAX_ITEMS = 250;
const STAR_COUNT = 3;
const MIN_VIEWS_FOR_FLAG = 100;
const NOT_SET = new Set(['(not set)', '', null, undefined]);

const pctChange = (cur, prev) => (typeof prev === 'number' && prev > 0 ? round((cur - prev) / prev, 4) : null);

export async function merchandise({ ga4, propertyId, current, previous }) {
  const [itemsRes, catRes] = await Promise.all([
    ga4.runReport({
      property: `properties/${propertyId}`,
      dateRanges: dateRanges(current, previous),
      dimensions: [{ name: 'itemName' }],
      metrics: ITEM_METRICS.map((name) => ({ name })),
      orderBys: [{ metric: { metricName: 'itemRevenue' }, desc: true }],
      limit: MAX_ITEMS * (previous ? 2 : 1),
      returnPropertyQuota: true,
    }),
    ga4.runReport({
      property: `properties/${propertyId}`,
      dateRanges: dateRanges(current),
      dimensions: [{ name: 'itemCategory' }],
      metrics: [{ name: 'itemRevenue' }, { name: 'itemsPurchased' }, { name: 'itemsViewed' }],
      orderBys: [{ metric: { metricName: 'itemRevenue' }, desc: true }],
      limit: 30,
      returnPropertyQuota: true,
    }),
  ]);

  const base = envelope(itemsRes, { propertyId, current, previous });
  const all = parseTable(itemsRes);
  const inPeriod = (p) => all.filter((r) => (r.dateRange === 'previous' ? 'previous' : 'current') === p);
  const cur = inPeriod('current');
  const prevByName = new Map(inPeriod('previous').map((r) => [r.itemName, r]));

  const categories = summarizeCategories(parseTable(catRes));
  if (cur.length === 0) return { ...base, status: 'no_data', message: NO_DATA_MESSAGE, items: [], categories };

  const totals = Object.fromEntries(ITEM_METRICS.map((m) => [m, cur.reduce((s, r) => s + (r[m] ?? 0), 0)]));
  const overallBuyRate = ratio(totals.itemsPurchased, totals.itemsViewed);
  const viewed = cur.map((r) => r.itemsViewed ?? 0).filter((v) => v > 0).sort((a, b) => a - b);
  const p75 = viewed[Math.floor(viewed.length * 0.75)] ?? Infinity;
  const notSetRevenue = cur.filter((r) => NOT_SET.has(r.itemName)).reduce((s, r) => s + (r.itemRevenue ?? 0), 0);

  const byRevenue = [...cur].sort((a, b) => (b.itemRevenue ?? 0) - (a.itemRevenue ?? 0));
  const stars = new Set(byRevenue.filter((r) => (r.itemRevenue ?? 0) > 0 && !NOT_SET.has(r.itemName)).slice(0, STAR_COUNT).map((r) => r.itemName));

  const items = byRevenue.map((r) => {
    const p = prevByName.get(r.itemName);
    const viewToPurchase = ratio(r.itemsPurchased, r.itemsViewed);
    const views = r.itemsViewed ?? 0;
    return {
      name: r.itemName,
      revenue: round(r.itemRevenue ?? 0, 0),
      purchased: r.itemsPurchased ?? 0,
      views,
      carts: r.itemsAddedToCart ?? 0,
      revenueShare: ratio(r.itemRevenue ?? 0, totals.itemRevenue),
      viewToCart: ratio(r.itemsAddedToCart, r.itemsViewed),
      viewToPurchase,
      ...(previous
        ? {
            prevRevenue: round(p?.itemRevenue ?? 0, 0),
            prevPurchased: p?.itemsPurchased ?? 0,
            revenueChange: pctChange(r.itemRevenue ?? 0, p?.itemRevenue),
            purchasedChange: pctChange(r.itemsPurchased ?? 0, p?.itemsPurchased),
            isNew: !p || !(p.itemRevenue > 0),
          }
        : {}),
      star: stars.has(r.itemName),
      highViewLowPurchase:
        views >= p75 && views >= MIN_VIEWS_FOR_FLAG && overallBuyRate !== null && (viewToPurchase ?? 0) < overallBuyRate * 0.5,
    };
  });

  const top3 = byRevenue.slice(0, 3).reduce((s, r) => s + (r.itemRevenue ?? 0), 0);
  return {
    ...base,
    status: 'ok',
    totals: {
      revenue: round(totals.itemRevenue, 0),
      purchased: totals.itemsPurchased,
      views: totals.itemsViewed,
      carts: totals.itemsAddedToCart,
      viewToCart: ratio(totals.itemsAddedToCart, totals.itemsViewed),
      viewToPurchase: overallBuyRate,
      itemsWithSales: cur.filter((r) => (r.itemsPurchased ?? 0) > 0).length,
      ...(previous ? { prevRevenue: round([...prevByName.values()].reduce((s, r) => s + (r.itemRevenue ?? 0), 0), 0) } : {}),
    },
    concentration: { top3Share: ratio(top3, totals.itemRevenue), top3Names: byRevenue.slice(0, 3).map((r) => r.itemName) },
    notSetShare: ratio(notSetRevenue, totals.itemRevenue),
    truncated: cur.length >= MAX_ITEMS,
    items,
    categories,
    definitions: {
      revenue: '商品營收（itemRevenue，不含運費與稅）',
      purchased: '購買件數',
      viewToCart: '加入購物車件數 ÷ 商品瀏覽次數',
      viewToPurchase: '購買件數 ÷ 商品瀏覽次數',
      star: `營收前 ${STAR_COUNT} 名`,
      highViewLowPurchase: `瀏覽次數在前 25% 且至少 ${MIN_VIEWS_FOR_FLAG} 次，購買率低於整體的一半`,
    },
    data_notes: dataNotes(itemsRes.metadata, ['商品營收不含運費，加總會和整體購買營收、Cyberbiz 後台有差異。']),
  };
}

function summarizeCategories(rows) {
  const total = rows.reduce((s, r) => s + (r.itemRevenue ?? 0), 0);
  const named = rows.filter((r) => !NOT_SET.has(r.itemCategory));
  const notSet = rows.filter((r) => NOT_SET.has(r.itemCategory)).reduce((s, r) => s + (r.itemRevenue ?? 0), 0);
  if (!rows.length) return { status: 'no_data', rows: [] };
  // 大部分營收沒有類別時，代表 Cyberbiz 沒有送 item_category
  if (!named.length || (total > 0 && notSet / total > 0.8)) {
    return { status: 'not_set', message: 'Cyberbiz 送進 GA4 的商品資料沒有類別（item_category），無法依類別統計。', rows: [] };
  }
  return {
    status: 'ok',
    notSetShare: ratio(notSet, total),
    rows: named.map((r) => ({
      category: r.itemCategory,
      revenue: round(r.itemRevenue ?? 0, 0),
      purchased: r.itemsPurchased ?? 0,
      views: r.itemsViewed ?? 0,
      revenueShare: ratio(r.itemRevenue ?? 0, total),
    })),
  };
}
