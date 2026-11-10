// 管理頁：手動開關 GA4 資料存取、撤銷所有連線。
// 需要 Google 登入且 email 在白名單內。開關不提供給 AI 工具呼叫。

import express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isAdmin, normalizeEmail, validateNewUserEmail } from './config.js';
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
    return isAdmin(config, email) ? email : null; // 管理頁只限管理員
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

  function page(email, sw, msg, users) {
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
form{display:inline}form.row{display:flex;gap:8px;margin-top:12px}
input[type=email]{flex:1;min-width:0;font:inherit;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg)}
ul.users{list-style:none;padding:0;margin:8px 0 0}ul.users li{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-top:1px solid var(--line)}
.tag{font-size:12px;padding:2px 8px;border-radius:999px;border:1px solid var(--line);color:var(--mute)}button.small{padding:6px 10px;font-size:14px}
.msg{padding:10px 12px;border-radius:8px;border:1px solid var(--line);margin-bottom:16px}
.back{display:inline-flex;align-items:center;gap:6px;margin-bottom:16px;padding:8px 14px;min-height:40px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);text-decoration:none;font-size:15px}
</style></head><body><main>
<a class="back" href="/dashboard">← 返回儀表板</a>
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
<div class="mute">可使用儀表板與 Claude 連接器的帳號</div>
<ul class="users">
${config.allowedEmails.map((e) => `<li><span>${esc(e)}</span><span class="tag">管理員</span></li>`).join('')}
${users.map((u) => `<li><span>${esc(u.id)}<br><span class="mute">${esc(u.addedAt?.slice(0, 10))} 由 ${esc(u.addedBy)} 加入</span></span>
<form method="post" action="/admin/users/remove"><input type="hidden" name="email" value="${esc(u.id)}"><button class="small" type="submit">移除</button></form></li>`).join('')}
</ul>
<form class="row" method="post" action="/admin/users/add">
<input type="email" name="email" required placeholder="name@${esc(config.allowedDomains[0] ?? '')}" autocomplete="off">
<button class="primary" type="submit">加入</button></form>
<p class="mute">只能加入 ${config.allowedDomains.map((d) => `@${esc(d)}`).join('、')} 的帳號。一般使用者可以看儀表板、透過 Claude 查詢，但不能進此管理頁；移除後立即失效。管理員需修改 Cloud Run 環境變數 ALLOWED_EMAILS。</p>
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
    const [sw, users] = await Promise.all([store.getAccessSwitch(), store.listUsers()]);
    res.type('html').send(page(email, sw, req.query.msg, users));
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

  const back = (res, msg) => res.redirect(303, `/admin?msg=${encodeURIComponent(msg)}`);

  router.post('/users/add', guard, async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const error = validateNewUserEmail(config, email);
    if (error) return back(res, `無法加入：${error}`);
    if (await store.getUser(email)) return back(res, `${email} 已在名單中`);
    await store.addUser(email, req.adminEmail);
    audit({ event: 'user_added', email: req.adminEmail, target: email });
    back(res, `已加入 ${email}`);
  });

  router.post('/users/remove', guard, async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    if (isAdmin(config, email)) return back(res, '管理員不能從管理頁移除');
    if (!(await store.getUser(email))) return back(res, `${email} 不在名單中`);
    await store.removeUser(email);
    const count = await store.deleteTokensByEmail(email); // 立即撤銷他已取得的權杖
    audit({ event: 'user_removed', email: req.adminEmail, target: email, count });
    back(res, `已移除 ${email}，並撤銷 ${count} 個權杖`);
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
