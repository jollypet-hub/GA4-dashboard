// 簽章 cookie 工作階段（HMAC-SHA256）。內容只有 email 與到期時間，不存任何權杖。

import { createHmac, timingSafeEqual } from 'node:crypto';

export function createSessionCookie({ name, secret, ttlSec }) {
  const sign = (payload) => createHmac('sha256', `${name}:${secret}`).update(payload).digest('base64url');

  return {
    make(email) {
      const exp = Math.floor(Date.now() / 1000) + ttlSec;
      const payload = `${Buffer.from(email).toString('base64url')}.${exp}`;
      return `${payload}.${sign(payload)}`;
    },
    // 回傳 email；簽章錯誤或過期回傳 null
    read(req) {
      const raw = (req.headers.cookie || '')
        .split(';')
        .map((s) => s.trim())
        .find((s) => s.startsWith(`${name}=`))
        ?.slice(name.length + 1);
      if (!raw) return null;
      const [emailB64, exp, sig] = raw.split('.');
      if (!emailB64 || !exp || !sig) return null;
      const expected = Buffer.from(sign(`${emailB64}.${exp}`));
      const given = Buffer.from(sig);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
      if (Number(exp) < Date.now() / 1000) return null;
      return Buffer.from(emailB64, 'base64url').toString();
    },
    set(res, value, maxAge = ttlSec) {
      res.append('Set-Cookie', `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
    },
    clear(res) {
      res.append('Set-Cookie', `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    },
  };
}

// 防 CSRF：寫入類請求必須來自本站
export function isSameOrigin(req, baseUrl) {
  const origin = req.headers.origin || req.headers.referer || '';
  try {
    return new URL(origin).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}
