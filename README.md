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

## 工具

全部唯讀，欄位固定；每支都回傳幣別、時區、期間、指標定義與資料限制。

| 工具 | 說明 |
|---|---|
| `ga4_access_status` | 開關狀態、允許的資源（不讀報表） |
| `ga4_overview` | 經營總覽＋前期比較：工作階段、使用者、交易、購買營收、總營收、客單價、購買轉換率（工作階段口徑） |
| `ga4_traffic_sources` | 來源／媒介的工作階段、交易、營收、轉換率；比較時依增減排序並計算占整體增減比例 |
| `ga4_devices` | 手機／電腦／平板的工作階段、交易、營收、轉換率，可比較前期 |
| `ga4_products` | 商品瀏覽、加車、購買件數與營收，標示「高瀏覽低成交」 |
| `ga4_funnel` | 封閉式使用者漏斗：瀏覽商品 → 加車 → 開始結帳 → 完成購買（GA4 alpha API；不可用時退回事件總量並明確警告） |
| `ga4_data_health` | 缺流量的日子、工作階段異常、關鍵事件缺漏、重複 purchase、缺交易 ID、零營收交易 |

## 設定（環境變數）

見 `.env.example`。兩個機密（`GOOGLE_OAUTH_CLIENT_SECRET`、`SESSION_SECRET`）在 Cloud Run 上由 Secret Manager 掛載，不寫進程式或 repo。

## 測試

```
npm install
npm test
```

測試使用記憶體儲存、假 Google 登入、假 GA4 回應，涵蓋：授權流程、PKCE、授權碼不可重用、白名單、redirect URI 限制、開關、資源白名單、日期檢查、no_data、權杖輪替、撤銷。

## 自動部署

push 到 `main` 後，GitHub Actions（`.github/workflows/deploy.yml`）會依序：
1. 執行測試，失敗就停止。
2. 以 Workload Identity Federation 換取短期憑證，沒有任何金鑰。
3. `gcloud run deploy --source .`，環境變數與 Secret 沿用 Cloud Run 上的設定。
4. 上線檢查：確認 `/health` 回 `ok`、未授權呼叫 `/mcp` 回 401。

只改 `.md` 檔不會觸發部署。也可以在 Actions 頁面手動執行（workflow_dispatch）。

信任範圍：
- 只有 repository_id `1452222425`、owner `jollypet-hub`、`refs/heads/main` 能取得部署身分。
- fork 出去的 repo 無法使用。

部署身分 `ga4-mcp-deployer` 只有以下權限，不能讀 GA4 或 Secret：
- `roles/run.sourceDeveloper`
- `roles/serviceusage.serviceUsageConsumer`
- 以 runner 與建置帳號身分部署（serviceAccountUser）

一次性設定腳本：`scripts/setup-cicd.sh`，在 Cloud Shell 執行，可重複執行。

需要的 repo Variables：`GCP_PROJECT`、`GCP_WIF_PROVIDER`、`GCP_DEPLOY_SA`。

## 首次部署步驟（已完成，留作重建參考）

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
