// GA4 Data API 用戶端。憑證來自 Cloud Run 的執行身分（ga4-mcp-runner），不使用金鑰檔。
// 只包裝 runReport 與 runFunnelReport（皆為唯讀），不提供任何寫入或任意 API 轉送。

export class Ga4Error extends Error {
  constructor(message, { code } = {}) {
    super(message);
    this.code = code;
  }
}

// GA4 標準資源同時最多 10 個查詢；本服務每個執行個體最多同時送 4 個，其餘排隊
export const MAX_CONCURRENT = 4;
const RETRY_DELAYS_MS = [800, 2000];

const isConcurrentQuota = (err) => err?.code === 8 && /concurrent/i.test(String(err?.details || err?.message || ''));

// gRPC 錯誤碼轉成看得懂的說明
function explain(err) {
  const code = err?.code;
  if (isConcurrentQuota(err)) return new Ga4Error('GA4 同時查詢太多，請過幾秒再試', { code });
  const map = {
    3: 'GA4 拒絕這個查詢（參數不正確）',
    5: '找不到這個 GA4 資源',
    7: '服務帳號沒有這個 GA4 資源的檢視權限（請確認已在 GA4 資源存取管理加入 ga4-mcp-runner）',
    8: 'GA4 API 每小時或每日配額已用完，請稍後再試',
    12: 'GA4 不支援這個查詢功能',
    14: 'GA4 服務暫時無法連線，請稍後再試',
    16: '服務帳號驗證失敗',
  };
  return new Ga4Error(map[code] || 'GA4 查詢失敗', { code });
}

export function createLimiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 同時查詢配額不足時稍等重試；其他錯誤直接回報
export async function call(fn, { limit = (f) => f(), delays = RETRY_DELAYS_MS } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const [response] = await limit(fn);
      return response;
    } catch (err) {
      if (isConcurrentQuota(err) && attempt < delays.length) {
        await sleep(delays[attempt]);
        continue;
      }
      console.error(JSON.stringify({ severity: 'ERROR', message: 'ga4_api_error', code: err?.code, detail: String(err?.details || err?.message || '') }));
      throw explain(err);
    }
  }
}

export function createGa4Client() {
  let beta;
  let alpha;
  const getBeta = () => (beta ??= import('@google-analytics/data').then((m) => new m.BetaAnalyticsDataClient()));
  // 漏斗報表目前只在 v1alpha 提供
  const getAlpha = () => (alpha ??= import('@google-analytics/data').then((m) => new m.v1alpha.AlphaAnalyticsDataClient()));

  const limit = createLimiter(MAX_CONCURRENT);

  return {
    async runReport(request) {
      const client = await getBeta();
      return call(() => client.runReport(request), { limit });
    },
    // 欄位清單（含自訂維度／指標定義），唯讀
    async getMetadata(name) {
      const client = await getBeta();
      return call(() => client.getMetadata({ name }), { limit });
    },
    async runFunnelReport(request) {
      const client = await getAlpha();
      return call(() => client.runFunnelReport(request), { limit });
    },
  };
}
