// GA4 查詢的同時數量限制與「同時查詢太多」重試。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, createLimiter, Ga4Error } from '../src/ga4/client.js';

const concurrentErr = () => Object.assign(new Error('x'), { code: 8, details: 'Exhausted concurrent requests quota.' });
const tokenErr = () => Object.assign(new Error('x'), { code: 8, details: 'Exhausted property tokens per hour.' });

test('同時最多只跑指定數量的查詢', async () => {
  const limit = createLimiter(4);
  let active = 0;
  let peak = 0;
  const job = () => limit(async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 10));
    active--;
    return 1;
  });
  const out = await Promise.all(Array.from({ length: 14 }, job));
  assert.equal(out.length, 14);
  assert.equal(peak, 4);
});

test('同時查詢太多時自動重試', async () => {
  let n = 0;
  const res = await call(async () => {
    n++;
    if (n < 3) throw concurrentErr();
    return [{ ok: true }];
  }, { delays: [1, 1] });
  assert.deepEqual(res, { ok: true });
  assert.equal(n, 3);
});

test('重試用完後回報看得懂的訊息', async () => {
  await assert.rejects(
    call(async () => { throw concurrentErr(); }, { delays: [1] }),
    (e) => e instanceof Ga4Error && /同時查詢太多/.test(e.message),
  );
});

test('每小時／每日配額用完不重試', async () => {
  let n = 0;
  await assert.rejects(
    call(async () => { n++; throw tokenErr(); }, { delays: [1, 1] }),
    (e) => /每小時或每日配額/.test(e.message),
  );
  assert.equal(n, 1);
});
