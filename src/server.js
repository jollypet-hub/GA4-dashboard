import { loadConfig } from './config.js';
import { createStore } from './store.js';
import { createGoogleLogin } from './oauth/google.js';
import { createGa4Client } from './ga4/client.js';
import { createApp } from './app.js';
import { createChat, createGeminiClient, createVertexClient } from './ai/chat.js';

const config = loadConfig();
const ga4 = createGa4Client();
// Vertex 用戶端延遲建立：第一次有人問 AI 時才初始化
let vertexPromise;
const lazyClient = { messages: { create: async (body) => (await (vertexPromise ??= createVertexClient())).messages.create(body) } };
let geminiPromise;
const lazyGemini = { models: { generateContent: async (req) => (await (geminiPromise ??= createGeminiClient())).models.generateContent(req) } };
const app = createApp({
  config,
  store: createStore(),
  googleLogin: createGoogleLogin(config),
  ga4,
  chat: createChat({ config, ga4, client: lazyClient, gemini: lazyGemini }),
});

app.listen(config.port, () => {
  console.log(JSON.stringify({ severity: 'INFO', message: 'ga4-mcp started', port: config.port, baseUrl: config.baseUrl }));
});
