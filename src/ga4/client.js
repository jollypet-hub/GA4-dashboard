// GA4 Data API 用戶端。憑證來自 Cloud Run 的執行身分（ga4-mcp-runner），不使用金鑰檔。
// 只包裝 runReport 與 runFunnelReport（皆為唯讀），不提供任何寫入或任意 API 轉送。

export class Ga4Error extends Error {
  constructor(message, { code } = {}) {
    super(message);
    this.code = code;
  }
}

// gRPC 錯誤碼轉成看得懂的說明
function explain(err) {
  const code = err?.code;
  const map = {
    3: 'GA4 拒絕這個查詢（參數不正確）',
    5: '找不到這個 GA4 資源',
    7: '服務帳號沒有這個 GA4 資源的檢視權限（請確認已在 GA4 資源存取管理加入 ga4-mcp-runner）',
    8: 'GA4 API 配額已用完，請稍後再試',
    12: 'GA4 不支援這個查詢功能',
    14: 'GA4 服務暫時無法連線，請稍後再試',
    16: '服務帳號驗證失敗',
  };
  return new Ga4Error(map[code] || 'GA4 查詢失敗', { code });
}

async function call(fn) {
  try {
    const [response] = await fn();
    return response;
  } catch (err) {
    console.error(JSON.stringify({ severity: 'ERROR', message: 'ga4_api_error', code: err?.code, detail: String(err?.details || err?.message || '') }));
    throw explain(err);
  }
}

export function createGa4Client() {
  let beta;
  let alpha;
  const getBeta = () => (beta ??= import('@google-analytics/data').then((m) => new m.BetaAnalyticsDataClient()));
  // 漏斗報表目前只在 v1alpha 提供
  const getAlpha = () => (alpha ??= import('@google-analytics/data').then((m) => new m.v1alpha.AlphaAnalyticsDataClient()));

  return {
    async runReport(request) {
      const client = await getBeta();
      return call(() => client.runReport(request));
    },
    async runFunnelReport(request) {
      const client = await getAlpha();
      return call(() => client.runFunnelReport(request));
    },
  };
}
