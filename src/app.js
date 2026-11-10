// 組裝 Express 應用程式。相依物件由外部傳入，方便測試時替換。

import express from 'express';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createOAuthProvider } from './oauth/provider.js';
import { createAdmin } from './admin.js';
import { buildMcpServer } from './mcp.js';

export function createApp({ config, store, googleLogin, ga4 }) {
  const app = express();
  app.set('trust proxy', 1); // Cloud Run 前面有一層 Google 前端代理
  app.disable('x-powered-by');

  const { provider, googleCallback } = createOAuthProvider({ config, store, googleLogin });
  const admin = createAdmin({ config, store, googleLogin });
  const mcpUrl = new URL(config.mcpUrl);

  app.get('/healthz', (_req, res) => res.type('text').send('ok'));
  app.get('/', (_req, res) => res.type('text').send('GA4 MCP 連接服務。管理頁：/admin'));

  // OAuth 授權伺服器：/authorize /token /register /revoke 與 .well-known 中繼資料
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: new URL(config.baseUrl),
      resourceServerUrl: mcpUrl,
      scopesSupported: [config.scope],
      resourceName: 'GA4 MCP（唯讀）',
    }),
  );

  app.get('/oauth/google/callback', (req, res, next) =>
    googleCallback(req, res, { onAdminLogin: admin.onAdminLogin }).catch(next),
  );

  app.use('/admin', admin.router);

  // MCP 端點：必須帶有效的 Bearer 權杖
  const bearer = requireBearerAuth({
    verifier: provider,
    requiredScopes: [config.scope],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl),
  });

  app.post('/mcp', bearer, express.json({ limit: '100kb' }), async (req, res, next) => {
    try {
      // 無狀態模式：每個請求建立獨立的 MCP 伺服器，請求結束即釋放
      const server = buildMcpServer({ config, store, ga4, authInfo: req.auth });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      next(err);
    }
  });
  const notAllowed = (_req, res) =>
    res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
  app.get('/mcp', bearer, notAllowed);
  app.delete('/mcp', bearer, notAllowed);

  // 錯誤處理：不把內部細節回傳給呼叫者
  app.use((err, _req, res, _next) => {
    console.error(JSON.stringify({ severity: 'ERROR', message: 'unhandled_error', error: String(err?.message || err) }));
    if (!res.headersSent) res.status(500).type('text').send('服務內部錯誤');
  });

  return app;
}
