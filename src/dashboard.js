// 儀表板：/dashboard（前端頁面）與 /api/dashboard/*（資料 API）。
// 登入：Google 登入＋白名單（管理員或管理頁加入的使用者）。儀表板本身不受資料存取開關影響；
// 「問 AI」屬於 AI 分析，受開關控管。

import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAdmin, normalizeEmail } from './config.js';
import { randomToken } from './store.js';
import { audit } from './audit.js';
import { createSessionCookie, isSameOrigin } from './session.js';
import { DateRangeError, previousPeriod, validateRange } from './ga4/dates.js';
import { Ga4Error } from './ga4/client.js';
import { buildOverviewRequest, parseOverview } from './ga4/overview.js';
import { dailyTrend, dataHealth, devices, funnel, trafficSources } from './ga4/reports.js';
import { merchandise } from './ga4/merch.js';

const WEB_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web/dist');
const CACHE_TTL_MS = 60 * 60 * 1000;
const DAY = 86_400_000;

// 台北時間的今天與「最近 N 個完整日」
export function taipeiToday(now = Date.now()) {
  return new Date(now + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
export function lastDays(n, now = Date.now()) {
  const today = Date.parse(`${taipeiToday(now)}T00:00:00Z`);
  const end = new Date(today - DAY).toISOString().slice(0, 10);
  const start = new Date(today - n * DAY).toISOString().slice(0, 10);
  return { start, end };
}

export function createDashboard({ config, store, ga4, googleLogin, chat }) {
  const session = createSessionCookie({ name: '__Host-ga4mcp_view', secret: config.sessionSecret, ttlSec: config.viewerSessionTtlSec });
  const isAllowed = async (email) => isAdmin(config, email) || !!(await store.getUser(normalizeEmail(email)));
  const cache = new Map();
  const inflight = new Map();

  // 同一期間的請求正在查詢時，共用同一份結果，不重複打 GA4
  async function cached(key, fn) {
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return { ...hit.value, cached: true };
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      const value = await fn();
      cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
      if (cache.size > 200) cache.delete(cache.keys().next().value);
      return value;
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  // 每次請求都重新檢查白名單，移除使用者立即生效
  async function requireViewer(req, res, next) {
    const email = session.read(req);
    if (!email || !(await isAllowed(email))) return res.status(401).json({ error: 'login_required' });
    req.viewerEmail = email;
    next();
  }

  function parseRange(q) {
    const def = lastDays(7);
    const current = validateRange(q.start || def.start, q.end || def.end, config.maxRangeDays);
    const previous = q.compare === '0' ? null : previousPeriod(current);
    return { current, previous };
  }

  const fail = (res, err) => {
    if (err instanceof DateRangeError) return res.status(400).json({ error: 'bad_date', message: err.message });
    if (err instanceof Ga4Error) return res.status(502).json({ error: 'ga4', message: err.message });
    console.error(JSON.stringify({ severity: 'ERROR', message: 'dashboard_error', error: String(err?.message || err) }));
    return res.status(500).json({ error: 'internal', message: '服務內部錯誤' });
  };

  const router = express.Router();
  router.use(['/dashboard', '/api/dashboard'], (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  // ---- 頁面 ----
  router.get('/dashboard/login', async (req, res) => {
    const pendingId = randomToken();
    await store.savePending(pendingId, { kind: 'dashboard' }, config.pendingLoginTtlSec);
    res.redirect(googleLogin.authUrl(pendingId));
  });

  router.post('/dashboard/logout', (req, res) => {
    if (!isSameOrigin(req, config.baseUrl)) return res.status(403).type('text').send('來源不符');
    session.clear(res);
    res.redirect(303, '/dashboard/login');
  });

  // 主畫面 App 用的圖示與 manifest（不需登入，手機取 manifest 時不帶 cookie）
  router.use('/dashboard/pwa', express.static(path.join(WEB_DIST, 'pwa'), { maxAge: '1d', fallthrough: false }));

  router.use(
    '/dashboard/assets',
    express.static(path.join(WEB_DIST, 'assets'), { immutable: true, maxAge: '365d', fallthrough: false }),
  );

  router.get(['/dashboard', '/dashboard/'], async (req, res) => {
    const email = session.read(req);
    if (!email || !(await isAllowed(email))) return res.redirect('/dashboard/login');
    if (!existsSync(path.join(WEB_DIST, 'index.html'))) return res.status(503).type('text').send('儀表板尚未建置');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'",
    );
    res.sendFile(path.join(WEB_DIST, 'index.html'));
  });

  // ---- API ----
  router.get('/api/dashboard/me', requireViewer, async (req, res) => {
    const sw = await store.getAccessSwitch();
    res.json({
      email: req.viewerEmail,
      isAdmin: isAdmin(config, req.viewerEmail),
      aiEnabled: sw.enabled,
      propertyId: config.defaultPropertyId,
      today: taipeiToday(),
      defaultRange: lastDays(7),
    });
  });

  router.get('/api/dashboard/summary', requireViewer, async (req, res) => {
    const started = Date.now();
    try {
      const { current, previous } = parseRange(req.query);
      const propertyId = config.defaultPropertyId;
      const key = `summary:${propertyId}:${current.startDate}:${current.endDate}:${previous ? 1 : 0}`;
      const result = await cached(key, async () => {
        const ctx = { ga4, propertyId, current, previous };
        const [overviewRes, trend, sources, device, health] = await Promise.all([
          ga4.runReport(buildOverviewRequest(propertyId, current, previous)),
          dailyTrend(ctx),
          trafficSources({ ...ctx, limit: 8 }),
          devices(ctx),
          dataHealth({ ga4, propertyId, current }),
        ]);
        return {
          generatedAt: new Date().toISOString(),
          overview: parseOverview(overviewRes, { propertyId, current, previous }),
          trend,
          sources,
          devices: device,
          health,
        };
      });
      audit({ event: 'dashboard_view', email: req.viewerEmail, startDate: current.startDate, endDate: current.endDate, status: 'ok', ms: Date.now() - started });
      res.json(result);
    } catch (err) {
      audit({ event: 'dashboard_view', email: req.viewerEmail, status: 'error', reason: err?.constructor?.name, ms: Date.now() - started });
      fail(res, err);
    }
  });

  // 商品表現＋購買流程：與總覽分開載入，總覽先出來，商品區塊隨後補上
  router.get('/api/dashboard/products', requireViewer, async (req, res) => {
    const started = Date.now();
    try {
      const { current, previous } = parseRange(req.query);
      const propertyId = config.defaultPropertyId;
      const key = `products:${propertyId}:${current.startDate}:${current.endDate}:${previous ? 1 : 0}`;
      const result = await cached(key, async () => {
        const ctx = { ga4, propertyId, current, previous };
        const [merch, flow] = await Promise.all([merchandise(ctx), funnel({ ga4, propertyId, current })]);
        return { generatedAt: new Date().toISOString(), merch, funnel: flow };
      });
      audit({ event: 'dashboard_view', email: req.viewerEmail, kind: 'products', startDate: current.startDate, endDate: current.endDate, status: 'ok', ms: Date.now() - started });
      res.json(result);
    } catch (err) {
      audit({ event: 'dashboard_view', email: req.viewerEmail, kind: 'products', status: 'error', reason: err?.constructor?.name, ms: Date.now() - started });
      fail(res, err);
    }
  });

  // 「問 AI」：回答可能要 20～60 秒。前端帶一個工作編號送出，同時用 GET 查進度；
  // 手機切到別的 App 導致連線中斷時，回來仍可用工作編號拿到答案。
  const JOB_ID = /^[A-Za-z0-9_-]{16,64}$/;
  const JOB_TTL_SEC = 30 * 60;

  function chatError(err) {
    if (err?.status === 403 || err?.status === 404) {
      return [502, { error: 'model', message: 'AI 模型尚未啟用或沒有使用權限，請管理員確認 Vertex AI 的 Claude 設定。' }];
    }
    if (err?.status === 429) return [429, { error: 'rate', message: 'AI 使用量暫時達到上限，請稍後再試。' }];
    if (err?.message === '沒有問題內容') return [400, { error: 'empty', message: '請輸入問題' }];
    if (err instanceof DateRangeError) return [400, { error: 'bad_date', message: err.message }];
    if (err instanceof Ga4Error) return [502, { error: 'ga4', message: err.message }];
    console.error(JSON.stringify({ severity: 'ERROR', message: 'dashboard_error', error: String(err?.message || err) }));
    return [500, { error: 'internal', message: '服務內部錯誤' }];
  }

  router.post('/api/dashboard/chat', requireViewer, express.json({ limit: '64kb' }), async (req, res) => {
    const started = Date.now();
    if (!isSameOrigin(req, config.baseUrl)) return res.status(403).json({ error: 'origin' });
    const jobId = req.body?.jobId;
    if (jobId !== undefined && !(typeof jobId === 'string' && JOB_ID.test(jobId))) {
      return res.status(400).json({ error: 'bad_job', message: '工作編號格式不正確' });
    }
    const email = req.viewerEmail;
    const sw = await store.getAccessSwitch();
    if (!sw.enabled) {
      audit({ event: 'ai_chat', email, status: 'error', reason: 'access_off' });
      return res.status(403).json({ error: 'ai_off', message: 'AI 資料存取開關目前關閉，請聯絡管理員開啟。' });
    }

    // 進度依序寫入；寫入失敗不影響回答
    let chain = Promise.resolve();
    const save = (data) => {
      if (!jobId) return chain;
      chain = chain.then(() => store.saveChatJob(email, jobId, { ...data, updatedAt: new Date().toISOString() }, JOB_TTL_SEC)).catch(() => {});
      return chain;
    };
    if (jobId && (await store.getChatJob(email, jobId))) return res.status(409).json({ error: 'dup_job', message: '這個問題已經送出過了' });
    save({ status: 'running', step: { phase: 'thinking' } });

    try {
      const { current } = parseRange(req.body ?? {});
      const period = `${current.startDate} 至 ${current.endDate}`;
      const out = await chat.ask({
        messages: req.body?.messages,
        period,
        today: taipeiToday(),
        onStep: (step) => save({ status: 'running', step }),
      });
      await save({ status: 'done', result: out });
      audit({ event: 'ai_chat', email, status: 'ok', kind: out.provider, count: out.tools.length, ms: Date.now() - started });
      res.json(out);
    } catch (err) {
      audit({ event: 'ai_chat', email, status: 'error', reason: String(err?.status ?? err?.constructor?.name), ms: Date.now() - started });
      const [status, body] = chatError(err);
      await save({ status: 'error', ...body });
      res.status(status).json(body);
    }
  });

  router.get('/api/dashboard/chat/:jobId', requireViewer, async (req, res) => {
    if (!JOB_ID.test(req.params.jobId)) return res.status(400).json({ error: 'bad_job' });
    const job = await store.getChatJob(req.viewerEmail, req.params.jobId);
    if (!job) return res.status(404).json({ error: 'not_found', message: '找不到這個問題的進度（可能已超過 30 分鐘）' });
    const { status, step, result, error, message } = job;
    res.json({ status, step, result, error, message });
  });

  return {
    router,
    onDashboardLogin(res, email) {
      session.set(res, session.make(email));
      res.redirect('/dashboard');
    },
  };
}
