// 讀取並驗證環境變數。缺必要設定時直接啟動失敗，避免以不安全的預設值執行。

function list(name, { lower = false } = {}) {
  return (process.env[name] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (lower ? s.toLowerCase() : s));
}

function required(name) {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`缺少必要環境變數 ${name}`);
  return v.trim();
}

export function loadConfig() {
  const baseUrl = required('PUBLIC_BASE_URL').replace(/\/+$/, '');
  const sessionSecret = required('SESSION_SECRET');
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET 至少需要 32 字元');

  const allowedEmails = list('ALLOWED_EMAILS', { lower: true });
  if (allowedEmails.length === 0) throw new Error('ALLOWED_EMAILS 不可為空');

  const allowedPropertyIds = list('ALLOWED_PROPERTY_IDS');
  if (allowedPropertyIds.length === 0) throw new Error('ALLOWED_PROPERTY_IDS 不可為空');
  for (const id of allowedPropertyIds) {
    if (!/^\d+$/.test(id)) throw new Error(`GA4 資源 ID 必須是純數字：${id}`);
  }

  const allowedRedirectUris = list('ALLOWED_REDIRECT_URIS');
  if (allowedRedirectUris.length === 0) throw new Error('ALLOWED_REDIRECT_URIS 不可為空');

  return Object.freeze({
    baseUrl,
    mcpUrl: `${baseUrl}/mcp`,
    googleClientId: required('GOOGLE_OAUTH_CLIENT_ID'),
    googleClientSecret: required('GOOGLE_OAUTH_CLIENT_SECRET'),
    googleCallbackUrl: `${baseUrl}/oauth/google/callback`,
    sessionSecret,
    allowedEmails,
    allowedPropertyIds,
    defaultPropertyId: allowedPropertyIds[0],
    allowedRedirectUris,
    maxRangeDays: Number(process.env.MAX_RANGE_DAYS || 400),
    port: Number(process.env.PORT || 8080),
    scope: 'ga4.read',
    accessTokenTtlSec: 60 * 60, // 1 小時
    refreshTokenTtlSec: 30 * 24 * 60 * 60, // 30 天
    authCodeTtlSec: 5 * 60,
    pendingLoginTtlSec: 10 * 60,
    adminSessionTtlSec: 8 * 60 * 60,
  });
}

export function isEmailAllowed(config, email) {
  return !!email && config.allowedEmails.includes(String(email).toLowerCase());
}
