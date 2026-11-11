// MCP 工具定義。全部唯讀、欄位固定；每次呼叫都由伺服器檢查開關、資源白名單與日期。

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { audit } from './audit.js';
import { DateRangeError, previousPeriod, validateRange } from './ga4/dates.js';
import { Ga4Error } from './ga4/client.js';
import { buildOverviewRequest, parseOverview } from './ga4/overview.js';
import { dataHealth, devices, funnel, products, trafficSources } from './ga4/reports.js';
import { fieldInventory } from './ga4/inventory.js';

// 各工具共用的日期與資源參數
const RANGE_SCHEMA = {
  start_date: z.string().describe('開始日期 YYYY-MM-DD'),
  end_date: z.string().describe('結束日期 YYYY-MM-DD（含當天）'),
  property_id: z.string().regex(/^\d+$/).optional().describe('GA4 資源 ID，省略則用預設資源'),
};
const COMPARE_SCHEMA = { compare: z.boolean().default(true).describe('是否與緊接在前、天數相同的前期比較，預設 true') };
const DATE_HINT = '日期必須是 YYYY-MM-DD 絕對日期（請先換算「上週」等相對說法）。';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const text = (obj, isError = false) => ({
  content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

export function buildMcpServer({ config, store, ga4, authInfo }) {
  const email = authInfo?.extra?.email;
  const clientId = authInfo?.clientId;
  const server = new McpServer({ name: 'ga4-mcp', version: '0.1.0' });

  // 共用檢查：開關 → 資源白名單 → 執行 → 紀錄
  async function guarded(tool, args, run) {
    const started = Date.now();
    const propertyId = args.property_id || config.defaultPropertyId;
    const base = { event: 'tool_call', tool, email, clientId, propertyId, startDate: args.start_date, endDate: args.end_date, compare: args.compare };
    const fail = (reason, message) => {
      audit({ ...base, status: 'error', reason, ms: Date.now() - started });
      return text(message, true);
    };

    const sw = await store.getAccessSwitch();
    if (!sw.enabled) {
      return fail('access_off', `GA4 資料存取開關目前關閉，伺服器拒絕查詢。請由管理員到 ${config.baseUrl}/admin 開啟後再試。`);
    }
    if (!config.allowedPropertyIds.includes(propertyId)) {
      return fail('property_not_allowed', `GA4 資源 ${propertyId} 不在允許清單內。允許的資源：${config.allowedPropertyIds.join(', ')}`);
    }
    try {
      const result = await run(propertyId);
      audit({ ...base, status: 'ok', ms: Date.now() - started });
      return text(result);
    } catch (err) {
      if (err instanceof DateRangeError) return fail('bad_date', err.message);
      if (err instanceof Ga4Error) return fail(`ga4_${err.code ?? 'error'}`, `GA4 查詢失敗：${err.message}`);
      console.error(JSON.stringify({ severity: 'ERROR', message: 'tool_unexpected_error', tool, error: String(err?.message || err) }));
      return fail('internal', '服務內部錯誤，查詢未完成。');
    }
  }

  server.registerTool(
    'ga4_access_status',
    {
      title: 'GA4 存取狀態',
      description: '查看 GA4 資料存取開關是否開啟、可查詢的 GA4 資源。不會讀取任何報表資料。',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const sw = await store.getAccessSwitch();
      return text({
        access_enabled: sw.enabled,
        allowed_property_ids: config.allowedPropertyIds,
        default_property_id: config.defaultPropertyId,
        admin_page: `${config.baseUrl}/admin`,
      });
    },
  );

  server.registerTool(
    'ga4_overview',
    {
      title: 'GA4 經營總覽',
      description:
        '取得指定期間的經營總覽：工作階段、使用者、交易筆數、購買營收、總營收、客單價、購買轉換率（工作階段口徑），' +
        '可與緊接在前、天數相同的前期比較。日期必須是 YYYY-MM-DD 絕對日期（請先換算「上週」等相對說法）。' +
        '回傳含幣別、時區、指標定義與資料限制；沒有資料時會明確標示 no_data，不會以 0 代替。',
      inputSchema: {
        start_date: z.string().describe('開始日期 YYYY-MM-DD'),
        end_date: z.string().describe('結束日期 YYYY-MM-DD（含當天）'),
        compare: z.boolean().default(true).describe('是否與前期比較，預設 true'),
        property_id: z.string().regex(/^\d+$/).optional().describe('GA4 資源 ID，省略則用預設資源'),
      },
      annotations: READ_ONLY,
    },
    async (args) =>
      guarded('ga4_overview', args, async (propertyId) => {
        const current = validateRange(args.start_date, args.end_date, config.maxRangeDays);
        const previous = args.compare === false ? null : previousPeriod(current);
        const response = await ga4.runReport(buildOverviewRequest(propertyId, current, previous));
        return parseOverview(response, { propertyId, current, previous });
      }),
  );

  // 第 3 階段工具：共用「驗證日期 → 執行報表」流程
  const reportTool = (name, title, description, extraSchema, run) =>
    server.registerTool(
      name,
      { title, description: `${description}${DATE_HINT}`, inputSchema: { ...RANGE_SCHEMA, ...extraSchema }, annotations: READ_ONLY },
      async (args) =>
        guarded(name, args, async (propertyId) => {
          const current = validateRange(args.start_date, args.end_date, config.maxRangeDays);
          const previous = args.compare === true ? previousPeriod(current) : null;
          return run({ ga4, propertyId, current, previous, args });
        }),
    );

  reportTool(
    'ga4_traffic_sources',
    'GA4 流量來源',
    '依來源／媒介列出工作階段、使用者、交易、購買營收、購買轉換率、客單價；與前期比較時依工作階段增減排序，並標示各來源占整體增減的比例，用來找出流量或成交變化的原因。',
    { ...COMPARE_SCHEMA, limit: z.number().int().min(1).max(50).default(15).describe('最多列出幾個來源，預設 15') },
    ({ args, ...ctx }) => trafficSources({ ...ctx, limit: args.limit ?? 15 }),
  );

  reportTool(
    'ga4_devices',
    'GA4 裝置比較',
    '依裝置類別（手機、電腦、平板）比較工作階段、交易、購買營收、購買轉換率與客單價，可與前期比較。',
    COMPARE_SCHEMA,
    ({ args: _a, ...ctx }) => devices(ctx),
  );

  reportTool(
    'ga4_products',
    'GA4 商品表現',
    '依商品列出瀏覽、加入購物車、購買件數與商品營收，並計算瀏覽→加車、瀏覽→購買比例，標示「高瀏覽低成交」的商品。',
    {
      sort_by: z.enum(['views', 'add_to_carts', 'purchases', 'revenue']).default('views').describe('排序依據，預設瀏覽數'),
      limit: z.number().int().min(1).max(50).default(20).describe('最多列出幾個商品，預設 20'),
    },
    ({ args, ...ctx }) => products({ ...ctx, sortBy: args.sort_by ?? 'views', limit: args.limit ?? 20 }),
  );

  reportTool(
    'ga4_funnel',
    'GA4 購買流程',
    '封閉式使用者漏斗：瀏覽商品 → 加入購物車 → 開始結帳 → 完成購買，回傳各步驟人數、完成率與流失率。若漏斗 API 無法使用，會改回傳事件總量並明確標示不是逐步流失率。',
    {},
    ({ args: _a, ...ctx }) => funnel(ctx),
  );

  reportTool(
    'ga4_data_health',
    'GA4 資料健康檢查',
    '檢查期間內的資料品質：沒有流量的日子、工作階段異常波動、關鍵電商事件缺漏、purchase 事件重複觸發（可能重複計算營收）、缺少交易 ID、零營收交易。分析營收前建議先執行。',
    {},
    ({ args: _a, ...ctx }) => dataHealth(ctx),
  );

  reportTool(
    'ga4_field_inventory',
    'GA4 欄位盤點',
    '盤點 GA4 實際有記錄的資料：事件清單與次數、商品／訂單／流量來源／內容／裝置／地區／使用者等欄位是否有值（有值比例與範例值）、購買相關指標、自訂維度。用來判斷哪些分析做得到、哪些追蹤需要補。查詢量較大，建議期間 30 天。',
    {},
    ({ args: _a, ...ctx }) => fieldInventory(ctx),
  );

  return server;
}
