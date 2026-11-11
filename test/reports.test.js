// 第 3 階段報表的單元測試：用假的 GA4 回應驗證解析、計算與異常判斷。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ga4Error } from '../src/ga4/client.js';
import { dataHealth, devices, funnel, products, trafficSources } from '../src/ga4/reports.js';

const current = { startDate: '2026-11-02', endDate: '2026-11-08', days: 7 };
const previous = { startDate: '2026-10-26', endDate: '2026-11-01', days: 7 };
const meta = { currencyCode: 'TWD', timeZone: 'Asia/Taipei' };
const mv = (...vals) => vals.map((v) => ({ value: String(v) }));
const dv = (...vals) => vals.map((v) => ({ value: v }));
const headers = (dims, mets) => ({ dimensionHeaders: dims.map((name) => ({ name })), metricHeaders: mets.map((name) => ({ name })) });
const SESSION = ['sessions', 'totalUsers', 'transactions', 'purchaseRevenue'];

test('流量來源：依增減排序並計算占比', async () => {
  const ga4 = {
    runReport: async (req) => {
      assert.equal(req.dateRanges.length, 2);
      return {
        ...headers(['sessionSourceMedium', 'dateRange'], SESSION),
        rows: [
          { dimensionValues: dv('google / organic', 'current'), metricValues: mv(3000, 2800, 5, 15000) },
          { dimensionValues: dv('google / organic', 'previous'), metricValues: mv(2900, 2700, 2, 2000) },
          { dimensionValues: dv('facebook / cpc', 'current'), metricValues: mv(5000, 4800, 10, 40000) },
          { dimensionValues: dv('facebook / cpc', 'previous'), metricValues: mv(400, 380, 0, 0) },
          { dimensionValues: dv('line / referral', 'current'), metricValues: mv(1407, 1093, 4, 9106) },
        ],
        metadata: meta,
      };
    },
  };
  const out = await trafficSources({ ga4, propertyId: '1', current, previous, limit: 15 });
  assert.equal(out.status, 'ok');
  assert.equal(out.rows[0].source_medium, 'facebook / cpc', '增加最多的來源排第一');
  assert.equal(out.rows[0].sessions_change, 4600);
  assert.equal(out.totals.sessions_change, 9407 - 3300);
  assert.equal(out.rows[0].share_of_sessions_change, Math.round((4600 / 6107) * 1000) / 1000);
  const line = out.rows.find((r) => r.source_medium === 'line / referral');
  assert.equal(line.previous.sessions, 0, '前期沒有的來源補 0');
  assert.equal(out.rows[0].current.avgOrderValue, 4000);
  assert.equal(out.currency, 'TWD');
});

test('裝置：沒有比較期間時依工作階段排序', async () => {
  const ga4 = {
    runReport: async () => ({
      ...headers(['deviceCategory'], SESSION),
      rows: [
        { dimensionValues: dv('desktop'), metricValues: mv(2000, 1900, 8, 30000) },
        { dimensionValues: dv('mobile'), metricValues: mv(7000, 6500, 10, 30000) },
      ],
      metadata: meta,
    }),
  };
  const out = await devices({ ga4, propertyId: '1', current, previous: null });
  assert.equal(out.rows[0].device, 'mobile');
  assert.equal(out.rows[0].current.purchaseRatePerSession, 0.0014);
  assert.equal(out.rows[0].previous, undefined);
});

test('沒有資料時回傳 no_data', async () => {
  const ga4 = { runReport: async () => ({ ...headers(['deviceCategory'], SESSION), rows: [], metadata: meta }) };
  const out = await devices({ ga4, propertyId: '1', current, previous: null });
  assert.equal(out.status, 'no_data');
  assert.match(out.message, /不代表數值為 0/);
});

test('商品：計算比例並標示高瀏覽低成交', async () => {
  const ga4 = {
    runReport: async (req) => {
      assert.equal(req.orderBys[0].metric.metricName, 'itemRevenue');
      return {
        ...headers(['itemName'], ['itemsViewed', 'itemsAddedToCart', 'itemsPurchased', 'itemRevenue']),
        rows: [
          { dimensionValues: dv('A'), metricValues: mv(1000, 50, 1, 500) },
          { dimensionValues: dv('B'), metricValues: mv(200, 40, 10, 20000) },
          { dimensionValues: dv('C'), metricValues: mv(100, 10, 5, 8000) },
          { dimensionValues: dv('D'), metricValues: mv(50, 5, 2, 3000) },
        ],
        totals: [{ metricValues: mv(1350, 105, 18, 31500) }],
        metadata: meta,
      };
    },
  };
  const out = await products({ ga4, propertyId: '1', current, limit: 20, sortBy: 'revenue' });
  const a = out.rows.find((r) => r.item_name === 'A');
  assert.equal(a.viewToPurchaseRate, 0.001);
  assert.equal(a.high_view_low_purchase, true);
  assert.equal(out.rows.find((r) => r.item_name === 'B').high_view_low_purchase, false);
  assert.equal(out.totals.viewToPurchaseRate, 0.0133);
});

test('漏斗：解析步驟與完成率', async () => {
  const ga4 = {
    runFunnelReport: async (req) => {
      assert.equal(req.funnel.isOpenFunnel, false);
      assert.deepEqual(req.funnel.steps.map((s) => s.filterExpression.funnelEventFilter.eventName), ['view_item', 'add_to_cart', 'begin_checkout', 'purchase']);
      return {
        funnelTable: {
          ...headers(['funnelStepName'], ['activeUsers', 'funnelStepCompletionRate', 'funnelStepAbandonments', 'funnelStepAbandonmentRate']),
          rows: [
            { dimensionValues: dv('1. 瀏覽商品'), metricValues: mv(3000, 0.05, 2850, 0.95) },
            { dimensionValues: dv('4. 完成購買'), metricValues: mv(19, 0, 0, 0) },
          ],
        },
      };
    },
  };
  const out = await funnel({ ga4, propertyId: '1', current });
  assert.equal(out.method, 'funnel');
  assert.equal(out.steps[0].completion_rate, 0.05);
  assert.equal(out.steps[1].active_users, 19);
});

test('漏斗 API 不支援時退回事件總量並加警告', async () => {
  const ga4 = {
    runFunnelReport: async () => {
      throw new Ga4Error('GA4 不支援這個查詢功能', { code: 12 });
    },
    runReport: async () => ({
      ...headers(['eventName'], ['eventCount', 'totalUsers']),
      rows: [{ dimensionValues: dv('view_item'), metricValues: mv(5000, 3000) }],
      metadata: meta,
    }),
  };
  const out = await funnel({ ga4, propertyId: '1', current });
  assert.equal(out.method, 'event_totals_fallback');
  assert.match(out.warning, /不是依序的逐步流失率/);
  assert.equal(out.events.find((e) => e.event === 'purchase').event_count, 0);
});

test('漏斗：權限錯誤不退回，直接回報', async () => {
  const ga4 = {
    runFunnelReport: async () => {
      throw new Ga4Error('沒有權限', { code: 7 });
    },
  };
  await assert.rejects(funnel({ ga4, propertyId: '1', current }), /沒有權限/);
});

test('資料健康：找出缺漏日、缺少事件、重複與缺 ID 的交易', async () => {
  const ga4 = {
    runReport: async (req) => {
      const dim = req.dimensions[0].name;
      if (dim === 'date') {
        return {
          ...headers(['date'], ['sessions', 'transactions', 'purchaseRevenue', 'eventCount']),
          rows: ['20261102', '20261103', '20261104', '20261106', '20261107', '20261108'].map((d, i) => ({
            dimensionValues: dv(d),
            metricValues: mv(i === 5 ? 6000 : 1000, i === 0 ? 0 : 3, 9000, 20000),
          })),
          metadata: meta,
        };
      }
      if (dim === 'eventName') {
        return {
          ...headers(['eventName'], ['eventCount']),
          rows: [
            { dimensionValues: dv('page_view'), metricValues: mv(40000) },
            { dimensionValues: dv('view_item'), metricValues: mv(9000) },
            { dimensionValues: dv('add_to_cart'), metricValues: mv(300) },
            { dimensionValues: dv('purchase'), metricValues: mv(21) },
          ],
        };
      }
      return {
        ...headers(['transactionId'], ['eventCount', 'purchaseRevenue']),
        rows: [
          { dimensionValues: dv('A1001'), metricValues: mv(2, 6000) },
          { dimensionValues: dv('A1002'), metricValues: mv(1, 0) },
          { dimensionValues: dv('(not set)'), metricValues: mv(3, 900) },
        ],
        rowCount: 3,
      };
    },
  };
  const out = await dataHealth({ ga4, propertyId: '1', current });
  const checks = Object.fromEntries(out.findings.map((f) => [f.check, f]));
  assert.deepEqual(checks.missing_days.detail, ['20261105']);
  assert.ok(checks.session_anomaly, '6000 是中位數 1000 的 6 倍');
  assert.match(checks.missing_events.message, /begin_checkout/);
  assert.match(checks.missing_events.message, /add_payment_info/);
  assert.ok(checks.checkout_lt_purchase);
  assert.equal(checks.duplicate_transactions.detail[0].transaction_id, 'A1001');
  assert.match(checks.missing_transaction_id.message, /^3 次/);
  assert.match(checks.zero_revenue_purchase.message, /^1 筆/);
  assert.equal(out.days_with_traffic_but_no_sales, 1);
});

test('結帳跳轉來源：標示 checkout_redirect 並統計被誤歸的成交', async () => {
  const { trafficSources, isCheckoutRedirect } = await import('../src/ga4/reports.js');
  assert.equal(isCheckoutRedirect('cyberbizpay.com / referral'), true);
  assert.equal(isCheckoutRedirect('jollypet.cyberbiz.co / referral'), true);
  assert.equal(isCheckoutRedirect('access.line.me / referral'), true);
  assert.equal(isCheckoutRedirect('LINE / OA'), false);
  assert.equal(isCheckoutRedirect('google / organic'), false);
  const ga4 = {
    runReport: async () => ({
      dimensionHeaders: [{ name: 'sessionSourceMedium' }],
      metricHeaders: ['sessions', 'totalUsers', 'transactions', 'purchaseRevenue'].map((name) => ({ name })),
      rows: [
        ['google / organic', 100, 80, 5, 10000],
        ['cyberbizpay.com / referral', 20, 10, 3, 9000],
      ].map(([d, ...m]) => ({ dimensionValues: [{ value: d }], metricValues: m.map((v) => ({ value: String(v) })) })),
      metadata: {},
    }),
  };
  const out = await trafficSources({ ga4, propertyId: '1', current: { startDate: '2026-11-01', endDate: '2026-11-07', days: 7 }, previous: null, limit: 10 });
  const pay = out.rows.find((r) => r.source_medium.startsWith('cyberbizpay'));
  assert.equal(pay.checkout_redirect, true);
  assert.equal(out.rows[0].checkout_redirect, undefined);
  assert.deepEqual(out.checkout_redirect_summary, { sources: ['cyberbizpay.com / referral'], sessions: 20, transactions: 3, purchaseRevenue: 9000 });
  assert.ok(out.data_notes.some((n) => n.includes('結帳／付款／登入頁跳轉')));
});
