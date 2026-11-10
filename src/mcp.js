// MCP 工具定義。全部唯讀、欄位固定；每次呼叫都由伺服器檢查開關、資源白名單與日期。

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { audit } from './audit.js';
import { DateRangeError, previousPeriod, validateRange } from './ga4/dates.js';
import { Ga4Error } from './ga4/client.js';
import { buildOverviewRequest, parseOverview } from './ga4/overview.js';

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

  return server;
}
