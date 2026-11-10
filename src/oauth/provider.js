// 本服務自己的 OAuth 2.1 授權伺服器（給 Claude 自訂連接器用）。
// 流程：Claude → /authorize → 轉到 Google 登入 → /oauth/google/callback 檢查白名單
//      → 發授權碼回 Claude → Claude 用 PKCE 換 access token → 呼叫 /mcp。

import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidRequestError,
  InvalidScopeError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { isEmailAllowed } from '../config.js';
import { randomToken, toMillis } from '../store.js';
import { audit } from '../audit.js';

export function createOAuthProvider({ config, store, googleLogin }) {
  const redirectAllowed = (uri) => config.allowedRedirectUris.includes(uri);

  async function issueTokens({ clientId, email, scopes, grantId }) {
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const base = { clientId, email, scopes, grantId };
    await store.saveToken(accessToken, { ...base, type: 'access' }, config.accessTokenTtlSec);
    await store.saveToken(refreshToken, { ...base, type: 'refresh' }, config.refreshTokenTtlSec);
    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: config.accessTokenTtlSec,
      refresh_token: refreshToken,
      scope: scopes.join(' '),
    };
  }

  const clientsStore = {
    getClient: async (clientId) => (await store.getClient(clientId)) ?? undefined,
    async registerClient(client) {
      const uris = client.redirect_uris ?? [];
      if (uris.length === 0 || !uris.every(redirectAllowed)) {
        audit({ event: 'client_register_denied', redirectUris: uris });
        throw new InvalidClientMetadataError('redirect_uri 不在允許清單內');
      }
      await store.saveClient(client);
      audit({ event: 'client_registered', clientId: client.client_id, clientName: client.client_name });
      return client;
    },
  };

  const provider = {
    clientsStore,

    async authorize(client, params, res) {
      if (!redirectAllowed(params.redirectUri)) throw new InvalidRequestError('redirect_uri 不在允許清單內');
      const scopes = params.scopes?.length ? params.scopes : [config.scope];
      if (!scopes.every((s) => s === config.scope)) throw new InvalidScopeError(`只支援 scope：${config.scope}`);

      const pendingId = randomToken();
      await store.savePending(
        pendingId,
        {
          kind: 'mcp',
          clientId: client.client_id,
          redirectUri: params.redirectUri,
          codeChallenge: params.codeChallenge,
          state: params.state ?? null,
          scopes,
          resource: params.resource?.href ?? null,
        },
        config.pendingLoginTtlSec,
      );
      res.redirect(googleLogin.authUrl(pendingId));
    },

    async challengeForAuthorizationCode(client, authorizationCode) {
      const code = await store.peekCode(authorizationCode);
      if (!code || code.clientId !== client.client_id) throw new InvalidGrantError('授權碼無效或已過期');
      return code.codeChallenge;
    },

    async exchangeAuthorizationCode(client, authorizationCode, _codeVerifier, redirectUri) {
      const code = await store.takeCode(authorizationCode);
      if (!code || code.clientId !== client.client_id) throw new InvalidGrantError('授權碼無效或已過期');
      if (redirectUri && redirectUri !== code.redirectUri) throw new InvalidGrantError('redirect_uri 不一致');
      if (!isEmailAllowed(config, code.email)) throw new InvalidGrantError('帳號不在允許清單內');
      const tokens = await issueTokens({
        clientId: client.client_id,
        email: code.email,
        scopes: code.scopes,
        grantId: randomToken(16),
      });
      audit({ event: 'token_issued', email: code.email, clientId: client.client_id });
      return tokens;
    },

    async exchangeRefreshToken(client, refreshToken, scopes) {
      const old = await store.getToken(refreshToken);
      if (!old || old.type !== 'refresh' || old.clientId !== client.client_id) {
        throw new InvalidGrantError('更新權杖無效或已過期');
      }
      // 換發時作廢同一授權的舊權杖（權杖輪替）
      await store.deleteGrant(old.grantId);
      if (!isEmailAllowed(config, old.email)) throw new InvalidGrantError('帳號已不在允許清單內');
      if (scopes?.length && !scopes.every((s) => old.scopes.includes(s))) {
        throw new InvalidScopeError('不可擴大權限範圍');
      }
      return issueTokens({ clientId: old.clientId, email: old.email, scopes: old.scopes, grantId: old.grantId });
    },

    async verifyAccessToken(token) {
      const t = await store.getToken(token);
      if (!t || t.type !== 'access') throw new InvalidTokenError('Access token is invalid or expired');
      if (!isEmailAllowed(config, t.email)) throw new InvalidTokenError('Account is no longer allowed');
      return {
        token,
        clientId: t.clientId,
        scopes: t.scopes,
        expiresAt: Math.floor(toMillis(t.expireAt) / 1000),
        extra: { email: t.email },
      };
    },

    async revokeToken(client, request) {
      const t = await store.getToken(request.token);
      if (t && t.clientId === client.client_id) {
        await store.deleteGrant(t.grantId);
        audit({ event: 'token_revoked', email: t.email, clientId: client.client_id });
      }
    },
  };

  // Google 登入完成後的回呼，Claude 連線與管理頁共用
  async function googleCallback(req, res, { onAdminLogin }) {
    const { state, code, error } = req.query;
    const pending = typeof state === 'string' ? await store.takePending(state) : null;
    if (!pending) return res.status(400).type('text').send('登入逾時或連結無效，請重新操作。');

    const backToClient = (params) => {
      const u = new URL(pending.redirectUri);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      if (pending.state) u.searchParams.set('state', pending.state);
      return res.redirect(u.href);
    };
    const deny = (reason) => {
      audit({ event: 'login_denied', kind: pending.kind, reason });
      if (pending.kind === 'mcp') return backToClient({ error: 'access_denied', error_description: reason });
      return res.status(403).type('text').send(`無法登入：${reason}`);
    };

    if (error || typeof code !== 'string') return deny('已取消 Google 登入');

    let email;
    try {
      ({ email } = await googleLogin.exchange(code));
    } catch (e) {
      console.error(JSON.stringify({ severity: 'ERROR', message: 'google_login_failed', error: String(e?.message || e) }));
      return deny('Google 登入驗證失敗');
    }
    if (!isEmailAllowed(config, email)) return deny('此帳號沒有使用權限');

    if (pending.kind === 'admin') {
      audit({ event: 'admin_login', email });
      return onAdminLogin(res, email);
    }

    const authCode = randomToken();
    await store.saveCode(
      authCode,
      {
        clientId: pending.clientId,
        redirectUri: pending.redirectUri,
        codeChallenge: pending.codeChallenge,
        email,
        scopes: pending.scopes,
        resource: pending.resource,
      },
      config.authCodeTtlSec,
    );
    audit({ event: 'login_ok', email, clientId: pending.clientId });
    return backToClient({ code: authCode });
  }

  return { provider, googleCallback };
}
