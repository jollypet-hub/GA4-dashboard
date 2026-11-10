// 儀表板商品表現：排行、前期比較、標籤、集中度、類別。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merchandise } from '../src/ga4/merch.js';

const meta = { currencyCode: 'TWD', timeZone: 'Asia/Taipei' };
const dv = (...v) => v.map((value) => ({ value }));
const mv = (...v) => v.map((n) => ({ value: String(n) }));
const current = { startDate: '2026-11-02', endDate: '2026-11-08', days: 7 };
const previous = { startDate: '2026-10-26', endDate: '2026-11-01', days: 7 };

function fakeGa4({ categories }) {
  return {
    runReport: async (req) => {
      const dim = req.dimensions[0].name;
      if (dim === 'itemCategory') {
        return { dimensionHeaders: [{ name: 'itemCategory' }], metricHeaders: ['itemRevenue', 'itemsPurchased', 'itemsViewed'].map((name) => ({ name })), rows: categories, metadata: meta };
      }
      const hdr = { dimensionHeaders: [{ name: 'itemName' }, { name: 'dateRange' }], metricHeaders: ['itemsViewed', 'itemsAddedToCart', 'itemsPurchased', 'itemRevenue'].map((name) => ({ name })) };
      return {
        ...hdr,
        metadata: meta,
        rows: [
          { dimensionValues: dv('貓砂', 'current'), metricValues: mv(2000, 50, 30, 30000) },
          { dimensionValues: dv('飲水機', 'current'), metricValues: mv(5000, 5, 1, 9000) },
          { dimensionValues: dv('濾芯', 'current'), metricValues: mv(40, 20, 10, 3000) },
          { dimensionValues: dv('新品', 'current'), metricValues: mv(100, 5, 2, 2000) },
          { dimensionValues: dv('冷門', 'current'), metricValues: mv(10, 0, 0, 0) },
          { dimensionValues: dv('貓砂', 'previous'), metricValues: mv(1500, 40, 20, 20000) },
          { dimensionValues: dv('飲水機', 'previous'), metricValues: mv(4000, 5, 2, 18000) },
        ],
      };
    },
  };
}

test('商品排行：依營收排序、占比、前期比較、標籤與集中度', async () => {
  const ga4 = fakeGa4({ categories: [{ dimensionValues: dv('貓砂'), metricValues: mv(30000, 30, 2000) }, { dimensionValues: dv('餵食飲水'), metricValues: mv(12000, 11, 5040) }] });
  const out = await merchandise({ ga4, propertyId: '1', current, previous });
  assert.equal(out.status, 'ok');
  assert.deepEqual(out.items.map((i) => i.name), ['貓砂', '飲水機', '濾芯', '新品', '冷門']);
  const [litter, fountain, filter, fresh] = out.items;
  assert.equal(out.totals.revenue, 44000);
  assert.equal(litter.revenueShare, 0.6818);
  assert.equal(litter.revenueChange, 0.5);
  assert.equal(fountain.revenueChange, -0.5);
  assert.equal(fresh.isNew, true);
  assert.equal(fresh.revenueChange, null);
  assert.deepEqual(out.items.filter((i) => i.star).map((i) => i.name), ['貓砂', '飲水機', '濾芯']);
  assert.equal(fountain.highViewLowPurchase, true, '瀏覽最多但幾乎沒買');
  assert.equal(filter.highViewLowPurchase, false);
  assert.equal(out.concentration.top3Share, 0.9545);
  assert.equal(out.totals.prevRevenue, 38000);
  assert.equal(out.totals.itemsWithSales, 4);
  assert.equal(out.categories.status, 'ok');
  assert.equal(out.categories.rows[0].revenueShare, 0.7143);
});

test('類別大多是 (not set) 時標示沒有類別資料', async () => {
  const ga4 = fakeGa4({ categories: [{ dimensionValues: dv('(not set)'), metricValues: mv(40000, 40, 7000) }, { dimensionValues: dv('貓砂'), metricValues: mv(1000, 1, 10) }] });
  const out = await merchandise({ ga4, propertyId: '1', current, previous: null });
  assert.equal(out.categories.status, 'not_set');
  assert.equal(out.items[0].revenueChange, undefined, '沒有比較期間就不給變化');
});
