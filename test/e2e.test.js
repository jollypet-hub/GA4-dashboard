// 端到端測試：記憶體儲存＋假 Google 登入＋假 GA4，驗證授權、開關、白名單與工具輸出。
// 執行：npm test

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

process.env.USE_MEMORY_STORE = '1';
const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
const CLAUDE_CB = 'https://claude.ai/api/mcp/auth_callback';
const ALLOWED = 'allowed.user@example.com';

Object.assign(process.env, {
  PUBLIC_BASE_URL: BASE,
  GOOGLE_OAUTH_CLIENT_ID: 'test-client',
  GOOGLE_OAUTH_CLIENT_SECRET: 'test-secret',
  SESSION_SECRET: 'x'.repeat(40),
  ALLOWED_EMAILS: ALLOWED,
  ALLOWED_PROPERTY_IDS: '123456789',
  ALLOWED_REDIRECT_URIS: `${CLAUDE_CB},https://claude.com/api/mcp/auth_callback`,
});

const { loadConfig } = await import('../src/config.js');
const { createStore } = await import('../src/store.js');
const { createApp } = await import('../src/app.js');

const config = loadConfig();
const store = createStore();
// 假 Google 登入：授權碼本身就是 email
const googleLogin = {
  authUrl: (state) => `https://accounts.google.test/auth?state=${encodeURIComponent(state)}`,
  exchange: async (code) => ({ email: code.toLowerCase() }),
};
const ga4Calls = [];
const ga4 = {
  async runReport(req) {
    ga4Calls.push(req);
    return {
      rows: [
        { dimensionValues: [{ value: 'current' }], metricValues: ['1000', '800', '20', '50000', '50000'].map((value) => ({ value })) },
        { dimensionValues: [{ value: 'previous' }], metricValues: ['800', '700', '10', '30000', '30000'].map((value) => ({ value })) },
      ],
      metadata: { currencyCode: 'TWD', timeZone: 'Asia/Taipei' },
      propertyQuota: { tokensPerDay: { remaining: 24000 } },
    };
  },
};

let server;
before(async () => {
  server = createApp({ config, store, googleLogin, ga4 }).listen(PORT);
  await new Promise((r) => server.once('listening', r));
});
after(() => server.close());

const get = (path, init = {}) => fetch(BASE + path, { redirect: 'manual', ...init });
const post = (path, body, headers = {}) =>
  fetch(BASE + path, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(body).toString(),
  });

async function mcp(token, method, params = {}) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const raw = await res.text();
  let body = null;
  const dataLine = raw.split('\n').find((l) => l.startsWith('data: '));
  try {
    body = JSON.parse(dataLine ? dataLine.slice(6) : raw);
  } catch {}
  return { status: res.status, headers: res.headers, body };
}

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
};

let clientId;
async function loginAs(email) {
  const { verifier, challenge } = pkce();
  const auth = await get(
    `/authorize?${new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: CLAUDE_CB,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'claude-state',
      scope: 'ga4.read',
    })}`,
  );
  assert.equal(auth.status, 302, '授權端點應轉到 Google');
  const pendingState = new URL(auth.headers.get('location')).searchParams.get('state');
  const cb = await get(`/oauth/google/callback?state=${encodeURIComponent(pendingState)}&code=${encodeURIComponent(email)}`);
  assert.equal(cb.status, 302);
  return { back: new URL(cb.headers.get('location')), verifier };
}

async function exchange(code, verifier) {
  const res = await post('/token', { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: CLAUDE_CB });
  return { status: res.status, body: await res.json() };
}

let accessToken;
let refreshToken;

test('OAuth 中繼資料可取得', async () => {
  const as = await (await get('/.well-known/oauth-authorization-server')).json();
  assert.equal(as.issuer, `${BASE}/`);
  assert.ok(as.registration_endpoint);
  const pr = await (await get('/.well-known/oauth-protected-resource/mcp')).json();
  assert.equal(pr.resource, `${BASE}/mcp`);
});

test('沒有權杖呼叫 /mcp 被拒絕', async () => {
  const r = await mcp(null, 'tools/list');
  assert.equal(r.status, 401);
  assert.match(r.headers.get('www-authenticate') || '', /resource_metadata/);
});

test('不在允許清單的 redirect_uri 無法註冊', async () => {
  const res = await fetch(`${BASE}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect_uris: ['https://evil.example/cb'], token_endpoint_auth_method: 'none' }),
  });
  assert.equal(res.status, 400);
});

test('Claude 回呼網址可註冊', async () => {
  const res = await fetch(`${BASE}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: [CLAUDE_CB], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
  });
  assert.equal(res.status, 201);
  clientId = (await res.json()).client_id;
  assert.ok(clientId);
});

test('白名單外的 email 登入被拒', async () => {
  const { back } = await loginAs('someone@else.com');
  assert.equal(back.origin + back.pathname, CLAUDE_CB);
  assert.equal(back.searchParams.get('error'), 'access_denied');
  assert.equal(back.searchParams.get('code'), null);
});

test('白名單 email 登入取得權杖，授權碼不可重複使用', async () => {
  const { back, verifier } = await loginAs('Allowed.User@example.com');
  const code = back.searchParams.get('code');
  assert.ok(code);
  assert.equal(back.searchParams.get('state'), 'claude-state');

  const bad = await exchange(code, 'wrong-verifier-wrong-verifier-wrong-verifier-123');
  assert.equal(bad.status, 400, 'PKCE 錯誤應被拒');

  const { back: back2, verifier: v2 } = await loginAs(ALLOWED);
  const ok = await exchange(back2.searchParams.get('code'), v2);
  assert.equal(ok.status, 200);
  accessToken = ok.body.access_token;
  refreshToken = ok.body.refresh_token;
  assert.ok(accessToken && refreshToken);

  const replay = await exchange(back2.searchParams.get('code'), v2);
  assert.equal(replay.status, 400, '授權碼重複使用應被拒');
  void verifier;
});

test('工具清單只有唯讀工具', async () => {
  const r = await mcp(accessToken, 'tools/list');
  assert.equal(r.status, 200);
  const names = r.body.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['ga4_access_status', 'ga4_overview']);
  for (const t of r.body.result.tools) assert.equal(t.annotations.readOnlyHint, true);
});

const overviewArgs = { start_date: '2026-11-02', end_date: '2026-11-08' };

test('開關預設關閉，查詢被伺服器拒絕且不呼叫 GA4', async () => {
  const r = await mcp(accessToken, 'tools/call', { name: 'ga4_overview', arguments: overviewArgs });
  assert.equal(r.body.result.isError, true);
  assert.match(r.body.result.content[0].text, /開關目前關閉/);
  assert.equal(ga4Calls.length, 0);
});

test('管理頁：需登入、POST 檢查來源、可開啟開關', async () => {
  const first = await get('/admin');
  assert.equal(first.status, 302);
  const pendingState = new URL(first.headers.get('location')).searchParams.get('state');
  const cb = await get(`/oauth/google/callback?state=${encodeURIComponent(pendingState)}&code=${ALLOWED}`);
  assert.equal(cb.status, 302);
  const cookie = cb.headers.get('set-cookie').split(';')[0];

  const page = await get('/admin', { headers: { cookie } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /已關閉/);

  const noOrigin = await post('/admin/access', { enabled: 'on' }, { cookie });
  assert.equal(noOrigin.status, 403, '缺少來源應被拒');
  const forged = await post('/admin/access', { enabled: 'on' }, { cookie, origin: 'https://evil.example' });
  assert.equal(forged.status, 403);

  const ok = await post('/admin/access', { enabled: 'on' }, { cookie, origin: BASE });
  assert.equal(ok.status, 303);
  assert.equal((await store.getAccessSwitch()).enabled, true);

  const fakeCookie = await get('/admin', { headers: { cookie: `${cookie.split('=')[0]}=abc.123.xyz` } });
  assert.equal(fakeCookie.status, 302, '偽造 cookie 應重新登入');
});

test('開關開啟後可查詢，輸出含口徑與比較', async () => {
  const r = await mcp(accessToken, 'tools/call', { name: 'ga4_overview', arguments: overviewArgs });
  assert.notEqual(r.body.result.isError, true, r.body.result.content[0].text);
  const out = JSON.parse(r.body.result.content[0].text);
  assert.equal(out.currency, 'TWD');
  assert.equal(out.time_zone, 'Asia/Taipei');
  assert.deepEqual(out.comparison_period, { startDate: '2026-10-26', endDate: '2026-11-01', days: 7, status: 'ok' });
  assert.equal(out.current.avgOrderValue, 2500);
  assert.equal(out.current.purchaseRatePerSession, 0.02);
  assert.equal(out.change_pct.purchaseRevenue, 66.7);
  assert.ok(out.definitions.purchaseRatePerSession);
  assert.equal(ga4Calls.at(-1).property, 'properties/123456789');
});

test('白名單外的 GA4 資源與錯誤日期被拒', async () => {
  const n = ga4Calls.length;
  const p = await mcp(accessToken, 'tools/call', { name: 'ga4_overview', arguments: { ...overviewArgs, property_id: '123456' } });
  assert.match(p.body.result.content[0].text, /不在允許清單/);
  const d = await mcp(accessToken, 'tools/call', { name: 'ga4_overview', arguments: { start_date: '2026-11-08', end_date: '2026-11-01' } });
  assert.match(d.body.result.content[0].text, /不可晚於/);
  const f = await mcp(accessToken, 'tools/call', { name: 'ga4_overview', arguments: { start_date: '2099-01-01', end_date: '2099-01-02' } });
  assert.match(f.body.result.content[0].text, /未來日期/);
  assert.equal(ga4Calls.length, n, '被拒的查詢不應呼叫 GA4');
});

test('沒有資料時標示 no_data，不以 0 代替', async () => {
  const orig = ga4.runReport;
  ga4.runReport = async () => ({ rows: [], metadata: { currencyCode: 'TWD', timeZone: 'Asia/Taipei' } });
  const r = await mcp(accessToken, 'tools/call', { name: 'ga4_overview', arguments: overviewArgs });
  ga4.runReport = orig;
  const out = JSON.parse(r.body.result.content[0].text);
  assert.equal(out.period.status, 'no_data');
  assert.equal(out.current, null);
  assert.match(out.message, /不代表數值為 0/);
});

test('更新權杖可換發，舊權杖作廢', async () => {
  const res = await post('/token', { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId });
  assert.equal(res.status, 200);
  const body = await res.json();
  const old = await mcp(accessToken, 'tools/list');
  assert.equal(old.status, 401, '輪替後舊 access token 應失效');
  accessToken = body.access_token;
  assert.equal((await mcp(accessToken, 'tools/list')).status, 200);
});

test('撤銷所有連線後無法再取資料', async () => {
  await store.deleteAllTokens();
  const r = await mcp(accessToken, 'tools/list');
  assert.equal(r.status, 401);
});
