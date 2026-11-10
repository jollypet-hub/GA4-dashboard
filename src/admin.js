// 管理頁：手動開關 GA4 資料存取、撤銷所有連線。
// 需要 Google 登入且 email 在白名單內。開關不提供給 AI 工具呼叫。

import express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isEmailAllowed } from './config.js';
import { randomToken } from './store.js';
import { audit } from './audit.js';

const COOKIE = '__Host-ga4mcp_admin';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createAdmin({ config, store, googleLogin }) {
  const sign = (payload) => createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');

  function makeSession(email) {
    const exp = Math.floor(Date.now() / 1000) + config.adminSessionTtlSec;
    const payload = `${Buffer.from(email).toString('base64url')}.${exp}`;
    return `${payload}.${sign(payload)}`;
  }

  function readSession(req) {
    const raw = (req.headers.cookie || '')
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
    if (!raw) return null;
    const [emailB64, exp, sig] = raw.split('.');
    if (!emailB64 || !exp || !sig) return null;
    const expected = Buffer.from(sign(`${emailB64}.${exp}`));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    if (Number(exp) < Date.now() / 1000) return null;
    const email = Buffer.from(emailB64, 'base64url').toString();
    return isEmailAllowed(config, email) ? email : null;
  }

  function setSessionCookie(res, value, maxAge) {
    res.setHeader(
      'Set-Cookie',
      // Lax：從 Google 登入導回時才帶得到 cookie；POST 另以來源檢查防 CSRF
      `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`,
    );
  }

  // 防 CSRF：POST 必須來自本站
  function sameOrigin(req) {
    const origin = req.headers.origin || req.headers.referer || '';
    try {
      return new URL(origin).origin === new URL(config.baseUrl).origin;
    } catch {
      return false;
    }
  }

  function page(email, sw, msg) {
    const on = sw.enabled;
    return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>GA4 連接服務管理</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--fg:#1d2433;--mute:#5b6475;--on:#127a3a;--off:#b42318;--line:#dde1e8}
@media (prefers-color-scheme:dark){:root{--bg:#14171c;--card:#1d2129;--fg:#e8ebf0;--mute:#9aa3b2;--on:#4ade80;--off:#f87171;--line:#2e3440}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,"Noto Sans TC",sans-serif}
main{max-width:520px;margin:40px auto;padding:0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:16px}
h1{font-size:20px;margin:0 0 4px}.mute{color:var(--mute);font-size:14px}
.state{font-size:28px;font-weight:700;margin:8px 0}.on{color:var(--on)}.off{color:var(--off)}
button{font:inherit;padding:10px 16px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer}
button.primary{background:var(--fg);color:var(--card);border-color:var(--fg)}
form{display:inline}.msg{padding:10px 12px;border-radius:8px;border:1px solid var(--line);margin-bottom:16px}
</style></head><body><main>
<h1>GA4 連接服務管理</h1><p class="mute">登入：${esc(email)}</p>
${msg ? `<div class="msg">${esc(msg)}</div>` : ''}
<div class="card">
<div class="mute">GA4 資料存取開關</div>
<div class="state ${on ? 'on' : 'off'}">${on ? '開啟中' : '已關閉'}</div>
<p class="mute">${sw.updatedAt ? `最後變更：${esc(sw.updatedAt)}（${esc(sw.updatedBy)}）` : '尚未開啟過（預設關閉）'}</p>
<form method="post" action="/admin/access"><input type="hidden" name="enabled" value="${on ? 'off' : 'on'}">
<button class="primary" type="submit">${on ? '關閉存取' : '開啟存取'}</button></form>
</div>
<div class="card">
<div class="mute">允許的 GA4 資源</div><div>${config.allowedPropertyIds.map(esc).join('、')}</div>
</div>
<div class="card">
<div class="mute">撤銷所有連線</div>
<p class="mute">刪除所有已發出的權杖。Claude 需重新連接並登入才能再使用。</p>
<form method="post" action="/admin/revoke-all"><button type="submit">撤銷所有連線</button></form>
</div>
<form method="post" action="/admin/logout"><button type="submit">登出</button></form>
</main></body></html>`;
  }

  const router = express.Router();
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
    next();
  });
  router.use(express.urlencoded({ extended: false, limit: '2kb' }));

  router.get('/', async (req, res) => {
    const email = readSession(req);
    if (!email) {
      const pendingId = randomToken();
      await store.savePending(pendingId, { kind: 'admin' }, config.pendingLoginTtlSec);
      return res.redirect(googleLogin.authUrl(pendingId));
    }
    const sw = await store.getAccessSwitch();
    res.type('html').send(page(email, sw, req.query.msg));
  });

  const guard = (req, res, next) => {
    const email = readSession(req);
    if (!email) return res.status(401).type('text').send('請先登入 /admin');
    if (!sameOrigin(req)) return res.status(403).type('text').send('來源不符');
    req.adminEmail = email;
    next();
  };

  router.post('/access', guard, async (req, res) => {
    const enabled = req.body?.enabled === 'on';
    await store.setAccessSwitch(enabled, req.adminEmail);
    audit({ event: 'access_switch', email: req.adminEmail, enabled });
    res.redirect(303, `/admin?msg=${encodeURIComponent(enabled ? '已開啟資料存取' : '已關閉資料存取')}`);
  });

  router.post('/revoke-all', guard, async (req, res) => {
    const count = await store.deleteAllTokens();
    audit({ event: 'revoke_all', email: req.adminEmail, count });
    res.redirect(303, `/admin?msg=${encodeURIComponent(`已撤銷 ${count} 個權杖`)}`);
  });

  router.post('/logout', guard, (req, res) => {
    setSessionCookie(res, '', 0);
    res.redirect(303, '/');
  });

  return {
    router,
    onAdminLogin(res, email) {
      setSessionCookie(res, makeSession(email), config.adminSessionTtlSec);
      res.redirect('/admin');
    },
  };
}
