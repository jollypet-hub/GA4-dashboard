import { loadConfig } from './config.js';
import { createStore } from './store.js';
import { createGoogleLogin } from './oauth/google.js';
import { createGa4Client } from './ga4/client.js';
import { createApp } from './app.js';

const config = loadConfig();
const app = createApp({
  config,
  store: createStore(),
  googleLogin: createGoogleLogin(config),
  ga4: createGa4Client(),
});

app.listen(config.port, () => {
  console.log(JSON.stringify({ severity: 'INFO', message: 'ga4-mcp started', port: config.port, baseUrl: config.baseUrl }));
});
