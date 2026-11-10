// 「問 AI」的備援：Claude 不可用時改用 Gemini。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChat, shouldFallback } from '../src/ai/chat.js';

const config = { defaultPropertyId: '123', maxRangeDays: 400 };
const ga4 = {
  runReport: async () => ({
    rows: [{ metricValues: ['100', '80', '2', '5000', '5000'].map((value) => ({ value })) }],
    metadata: { currencyCode: 'TWD', timeZone: 'Asia/Taipei' },
  }),
};
const ask = { messages: [{ role: 'user', content: '營收如何？' }], period: '2026-11-02 至 2026-11-08', today: '2026-11-10' };
const err = (status) => Object.assign(new Error(`status ${status}`), { status });
const claudeFails = (status) => ({ messages: { create: async () => { throw err(status); } } });

function fakeGemini() {
  const calls = [];
  return {
    calls,
    models: {
      async generateContent(req) {
        calls.push(req);
        const last = req.contents.at(-1);
        if (last.parts[0].functionResponse) {
          return { functionCalls: undefined, text: `Gemini 結論：${last.parts[0].functionResponse.response.result.slice(0, 20)}` };
        }
        const call = { id: 'g1', name: 'ga4_overview', args: { start_date: '2026-11-02', end_date: '2026-11-08' } };
        return { functionCalls: [call], candidates: [{ content: { role: 'model', parts: [{ functionCall: call }] } }] };
      },
    },
  };
}

test('哪些錯誤會改用備援', () => {
  for (const s of [429, 403, 404, 500, 503, 529]) assert.equal(shouldFallback(err(s)), true, String(s));
  assert.equal(shouldFallback(new Error('network')), true, '沒有狀態碼（連線失敗）');
  assert.equal(shouldFallback(err(400)), false, '請求本身有誤不改用備援');
});

test('Claude 配額不足時改用 Gemini，並可呼叫工具', async () => {
  const gemini = fakeGemini();
  const out = await createChat({ config, ga4, client: claudeFails(429), gemini }).ask(ask);
  assert.equal(out.provider, 'gemini');
  assert.equal(out.fallbackStatus, 429);
  assert.match(out.reply, /^Gemini 結論/);
  assert.deepEqual(out.tools, [{ name: 'ga4_overview', start_date: '2026-11-02', end_date: '2026-11-08' }]);
  const first = gemini.calls[0];
  assert.equal(first.model, 'gemini-3.5-flash');
  assert.equal(first.config.tools[0].functionDeclarations.length, 6);
  assert.ok(first.config.tools[0].functionDeclarations[0].parametersJsonSchema.properties.start_date);
  assert.match(first.config.systemInstruction, /2026-11-02 至 2026-11-08/);
  assert.deepEqual(first.contents, [{ role: 'user', parts: [{ text: '營收如何？' }] }]);
});

test('Claude 正常時不呼叫 Gemini', async () => {
  const gemini = fakeGemini();
  const client = { messages: { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Claude 回答' }] }) } };
  const out = await createChat({ config, ga4, client, gemini }).ask(ask);
  assert.equal(out.provider, 'claude');
  assert.equal(out.reply, 'Claude 回答');
  assert.equal(gemini.calls.length, 0);
});

test('進度回報：思考 → 查詢哪些資料 → 整理回答；同一輪多個工具一起查', async () => {
  const steps = [];
  let active = 0;
  let peak = 0;
  const slowGa4 = {
    runReport: async (req) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return ga4.runReport(req);
    },
  };
  const both = [
    { type: 'tool_use', id: 'a', name: 'ga4_overview', input: { start_date: '2026-11-02', end_date: '2026-11-08' } },
    { type: 'tool_use', id: 'b', name: 'ga4_overview', input: { start_date: '2026-10-26', end_date: '2026-11-01' } },
  ];
  let n = 0;
  const client = {
    messages: {
      create: async () => (n++ === 0 ? { stop_reason: 'tool_use', content: both } : { stop_reason: 'end_turn', content: [{ type: 'text', text: '好' }] }),
    },
  };
  const out = await createChat({ config, ga4: slowGa4, client }).ask({ ...ask, onStep: (s) => steps.push(s) });
  assert.equal(out.reply, '好');
  assert.deepEqual(steps, [
    { phase: 'thinking' },
    { phase: 'querying', tools: ['ga4_overview', 'ga4_overview'] },
    { phase: 'writing' },
  ]);
  assert.equal(peak, 2, '兩份資料同時查詢');
  assert.deepEqual(out.tools.map((t) => t.start_date), ['2026-11-02', '2026-10-26'], '順序維持不變');
});

test('請求錯誤（400）不改用備援', async () => {
  const gemini = fakeGemini();
  await assert.rejects(createChat({ config, ga4, client: claudeFails(400), gemini }).ask(ask), /status 400/);
  assert.equal(gemini.calls.length, 0);
});

test('兩邊都失敗時回報 Claude 原本的錯誤', async () => {
  const gemini = { models: { generateContent: async () => { throw err(500); } } };
  await assert.rejects(createChat({ config, ga4, client: claudeFails(429), gemini }).ask(ask), (e) => e.status === 429);
});
