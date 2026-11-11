// GA4 欄位盤點：有值比例、狀態、不支援的欄位、交易 ID 不回傳範例值。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldInventory } from '../src/ga4/inventory.js';
import { Ga4Error } from '../src/ga4/client.js';

const current = { startDate: '2026-10-11', endDate: '2026-11-09', days: 30 };
const dv = (...v) => v.map((value) => ({ value }));
const mv = (...v) => v.map((n) => ({ value: String(n) }));

const ga4 = {
  async runReport(req) {
    const dim = req.dimensions?.[0]?.name;
    const met = req.metrics[0].name;
    const hdr = (d, m) => ({ dimensionHeaders: d.map((name) => ({ name })), metricHeaders: m.map((name) => ({ name })) });
    if (!dim) return { ...hdr([], req.metrics.map((m) => m.name)), rows: [{ metricValues: req.metrics.map(() => ({ value: '10' })) }] };
    if (dim === 'eventName') return { ...hdr(['eventName'], ['eventCount', 'totalUsers']), rows: [{ dimensionValues: dv('page_view'), metricValues: mv(1000, 300) }] };
    if (dim === 'itemBrand') throw new Ga4Error('x', { code: 3 });
    const rows = {
      itemName: [['貓砂', 90], ['(not set)', 10]],
      itemCategory: [['(not set)', 100]],
      transactionId: [['T1', 1], ['T2', 1]],
      sessionCampaignName: [['(not set)', 70], ['雙11', 30]],
    }[dim] ?? [['x', 5]];
    return { ...hdr([dim], [met]), rows: rows.map(([v, n]) => ({ dimensionValues: dv(v), metricValues: mv(n) })), totals: [{ metricValues: mv(rows.reduce((s, r) => s + r[1], 0)) }], rowCount: rows.length };
  },
  async getMetadata() {
    return { dimensions: [{ apiName: 'customEvent:member_level', uiName: '會員等級', customDefinition: true }, { apiName: 'city', customDefinition: false }], metrics: [] };
  },
};

test('欄位盤點：有值比例與狀態', async () => {
  const out = await fieldInventory({ ga4, propertyId: '1', current });
  const f = Object.fromEntries(out.fields.map((x) => [x.field, x]));
  assert.equal(f.itemName.coverage, 0.9);
  assert.equal(f.itemName.status, 'has_data');
  assert.deepEqual(f.itemName.samples, ['貓砂']);
  assert.equal(f.itemCategory.status, 'empty');
  assert.equal(f.sessionCampaignName.status, 'partial');
  assert.equal(f.itemBrand.status, 'unsupported');
  assert.equal(f.transactionId.samples, undefined, '交易 ID 不回傳範例值');
  assert.equal(f.transactionId.distinct_values, 2);
  assert.ok(f['customEvent:member_level'], '自訂維度也會盤點');
  assert.equal(out.events[0].event, 'page_view');
  assert.equal(out.purchase_metrics.length, 8);
});
