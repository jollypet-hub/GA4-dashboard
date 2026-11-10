// 上游身分驗證：用 Google 登入確認使用者 email。
// 只要 openid / email 範圍，不向使用者要求任何 GA4 或其他 Google 資料權限。

import { OAuth2Client } from 'google-auth-library';

export function createGoogleLogin(config) {
  const client = new OAuth2Client({
    clientId: config.googleClientId,
    clientSecret: config.googleClientSecret,
    redirectUri: config.googleCallbackUrl,
  });

  return {
    authUrl(state) {
      return client.generateAuthUrl({
        access_type: 'online',
        scope: ['openid', 'email'],
        prompt: 'select_account',
        state,
      });
    },

    // 用 Google 回傳的授權碼換 ID token，驗證簽章與 audience 後取得 email
    async exchange(code) {
      const { tokens } = await client.getToken(code);
      if (!tokens.id_token) throw new Error('Google 沒有回傳 ID token');
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.googleClientId });
      const payload = ticket.getPayload();
      if (!payload?.email || payload.email_verified !== true) throw new Error('Google 帳號 email 未驗證');
      return { email: payload.email.toLowerCase() };
    },
  };
}
