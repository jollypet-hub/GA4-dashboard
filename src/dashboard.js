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
import { dailyTrend, dataHealth, devices, trafficSources } from './ga4/reports.js';

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
  const session = createSessionCookie({ name: '__Host-ga4mcp_view', secret: config.sessionSecret, ttlSec: config.adminSessionTtlSec });
  const isAllowed = async (email) => isAdmin(config, email) || !!(await store.getUser(normalizeEmail(email)));
  const cache = new Map();

  async function cached(key, fn) {
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return { ...hit.value, cached: true };
    const value = await fn();
    cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return value;
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

  router.post('/api/dashboard/chat', requireViewer, express.json({ limit: '64kb' }), async (req, res) => {
    const started = Date.now();
    if (!isSameOrigin(req, config.baseUrl)) return res.status(403).json({ error: 'origin' });
    const sw = await store.getAccessSwitch();
    if (!sw.enabled) {
      audit({ event: 'ai_chat', email: req.viewerEmail, status: 'error', reason: 'access_off' });
      return res.status(403).json({ error: 'ai_off', message: 'AI 資料存取開關目前關閉，請聯絡管理員開啟。' });
    }
    try {
      const { current } = parseRange(req.body ?? {});
      const period = `${current.startDate} 至 ${current.endDate}`;
      const out = await chat.ask({ messages: req.body?.messages, period, today: taipeiToday() });
      audit({ event: 'ai_chat', email: req.viewerEmail, status: 'ok', count: out.tools.length, ms: Date.now() - started });
      res.json(out);
    } catch (err) {
      audit({ event: 'ai_chat', email: req.viewerEmail, status: 'error', reason: String(err?.status ?? err?.constructor?.name), ms: Date.now() - started });
      if (err?.status === 403 || err?.status === 404) {
        return res.status(502).json({ error: 'model', message: 'AI 模型尚未啟用或沒有使用權限，請管理員確認 Vertex AI 的 Claude 設定。' });
      }
      if (err?.status === 429) return res.status(429).json({ error: 'rate', message: 'AI 使用量暫時達到上限，請稍後再試。' });
      if (err?.message === '沒有問題內容') return res.status(400).json({ error: 'empty', message: '請輸入問題' });
      fail(res, err);
    }
  });

  return {
    router,
    onDashboardLogin(res, email) {
      session.set(res, session.make(email));
      res.redirect('/dashboard');
    },
  };
}
