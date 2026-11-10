# ga4-mcp：GA4 唯讀連接服務

讓 Claude 透過自訂連接器（遠端 MCP）讀取 GA4 彙總報表。部署在 Google Cloud Run（區域 `asia-east1`）。

## 架構

```
Claude 自訂連接器 ──OAuth 2.1 + PKCE──► Cloud Run「ga4-mcp」
                                         ├─ Google 登入＋email 白名單
                                         ├─ Firestore：開關、OAuth 權杖（只存雜湊）
                                         ├─ Secret Manager：Google OAuth client secret、cookie 簽章金鑰
                                         └─ GA4 Data API（執行身分 ga4-mcp-runner，無金鑰檔）
```

## 安全設計（對照需求文件第 4、5、8 節）

| 需求 | 做法 |
|---|---|
| 不下載服務帳號私鑰 | Cloud Run 執行身分 `ga4-mcp-runner` 自動取得權杖 |
| GA4 只給檢視者 | 在 GA4 資源存取管理加入服務帳號，角色「檢視者」 |
| 不給專案擁有者／編輯者 | 執行身分只有 Firestore 使用者＋指定 Secret 讀取 |
| 入口要驗證 | 自建 OAuth 授權伺服器，上游用 Google 登入，email 白名單 |
| 只接受 Claude | 動態註冊只允許 Claude 的回呼網址 |
| 開關預設關閉、伺服器擋 | Firestore `settings/access`，無紀錄即關閉；每次工具呼叫都檢查 |
| AI 不能自己開開關 | 開關只在 `/admin` 管理頁（需登入），沒有對應的 MCP 工具 |
| 只開放預定義唯讀工具 | 工具欄位固定，無任意 API 轉送；全部標示 readOnly |
| 資源白名單 | `ALLOWED_PROPERTY_IDS`，其他資源一律拒絕 |
| 缺資料不以 0 冒充 | 無資料列回 `no_data` 與說明；GA4 錯誤明確回報 |
| 日誌不含報表與憑證 | 稽核日誌只記錄呼叫者、時間、工具、資源、日期、成功／失敗 |
| 可撤銷授權 | 管理頁「撤銷所有連線」刪除全部權杖；白名單移除 email 立即失效 |

## 工具（第 2 階段）

| 工具 | 說明 |
|---|---|
| `ga4_access_status` | 開關狀態、允許的資源（不讀報表） |
| `ga4_overview` | 經營總覽＋前期比較：工作階段、使用者、交易、購買營收、總營收、客單價、購買轉換率（工作階段口徑） |

第 3 階段再加入：流量來源、商品表現、購買流程、裝置比較、資料健康。

## 設定（環境變數）

見 `.env.example`。兩個機密（`GOOGLE_OAUTH_CLIENT_SECRET`、`SESSION_SECRET`）在 Cloud Run 上由 Secret Manager 掛載，不寫進程式或 repo。

## 測試

```
npm install
npm test
```

測試使用記憶體儲存、假 Google 登入、假 GA4 回應，涵蓋：授權流程、PKCE、授權碼不可重用、白名單、redirect URI 限制、開關、資源白名單、日期檢查、no_data、權杖輪替、撤銷。

## 部署步驟（第 3 階段，執行前會先確認）

1. 建立 OAuth 同意畫面（內部）與「網頁應用程式」用戶端，重新導向 URI：
   `https://ga4-mcp-PROJECT_NUMBER.asia-east1.run.app/oauth/google/callback`
2. Secret Manager 建立 `ga4-mcp-google-client-secret`、`ga4-mcp-session-secret`，只授權 `ga4-mcp-runner` 讀取。
3. `gcloud run deploy ga4-mcp --source . --region asia-east1 --service-account ga4-mcp-runner@YOUR_PROJECT_ID.iam.gserviceaccount.com --allow-unauthenticated --min-instances 0 --max-instances 2`，並帶入環境變數與 Secret。
   `--allow-unauthenticated` 是因為 Claude 連接器無法通過 Cloud Run IAM；存取改由程式內 OAuth 控管。
4. Firestore 對 `oauth_pending`、`oauth_codes`、`oauth_tokens` 的 `expireAt` 欄位設定 TTL 自動清除。
5. 設定預算警示。
6. Claude → 設定 → 連接器 → 新增自訂連接器，網址填 `https://ga4-mcp-PROJECT_NUMBER.asia-east1.run.app/mcp`。
7. 到 `/admin` 開啟開關，做端到端測試。

## 維護備註

- `npm audit` 有 6 個中度弱點，皆為 Google 官方套件底層的 `glob`／`rimraf` 間接相依，不處理使用者輸入；待上游更新。
- 白名單調整：修改 Cloud Run 環境變數 `ALLOWED_EMAILS` 後重新部署。
