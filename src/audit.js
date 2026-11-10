// 操作紀錄：輸出 JSON 到 stdout，由 Cloud Logging 收集。
// 只記錄呼叫者、時間、事件、資源、查詢範圍與成功/失敗；不記錄報表內容、權杖或密鑰。

const ALLOWED_FIELDS = new Set([
  'event', 'email', 'clientId', 'clientName', 'tool', 'propertyId', 'startDate', 'endDate',
  'compare', 'status', 'reason', 'target', 'kind', 'ms', 'redirectUris', 'enabled', 'count',
]);

export function audit(fields) {
  const entry = { severity: fields.status === 'error' ? 'WARNING' : 'INFO', logType: 'audit', time: new Date().toISOString() };
  for (const [k, v] of Object.entries(fields)) {
    if (ALLOWED_FIELDS.has(k) && v !== undefined) entry[k] = v;
  }
  console.log(JSON.stringify(entry));
}
