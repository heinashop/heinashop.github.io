# Heina：GitHub 前台 + Cloudflare 後端 + Google Sheets

保留原有管理後台、顧客網站及 Google Sheets 表格。新後端在 Cloudflare Workers 執行，不會呼叫 Apps Script。所有程式可放在原 GitHub 倉庫；不需要 Supabase，也不用重建管理畫面。

目前狀態：程式已提供；尚未建立 Cloudflare 資源、設定 Google 服務帳號、進行真實 Sheets 驗收或切換正式網站。本機合成測試不等於正式資料驗收。

## 1. 準備帳號與試算表權限

1. 建立 Cloudflare 帳號。在 Workers & Pages 啟用 Workers，記下 Account ID。此後端使用 SQLite Durable Objects，請在帳戶中確認可用方案、配額與費用；本程式不會替你購買方案。
2. 在 Google Cloud Console 建立或選擇專案，啟用 **Google Sheets API**。
3. 到 IAM & Admin → Service Accounts，建立專用服務帳號。不需要授予整個 Google Cloud 專案 Owner／Editor 權限。
4. 為服務帳號建立 JSON 私鑰，存放在此 Git 倉庫以外的私人目錄。
5. 先複製原試算表作為驗收表，將驗收表分享給 JSON 裡的 `client_email`，權限為 Editor。不要將表格改為公開。
6. 原有訂單、銀行日記帳、系統設定及其他工作表維持原欄位。第一次驗收請使用測試副本，不要直接指向正式表。

## 2. 在本機部署後端

開啟 PowerShell，進入本專案的 `backend/cloudflare`：

```powershell
npm ci
npm test
npm run check
npx wrangler login
npm run deploy
```

第一次部署時尚無 Secrets，`/health` 回 503 是預期結果。設定以下 Secrets，每個命令會提示輸入，請不要把值寫在命令列或提交到 Git：

```powershell
npx wrangler secret put HEINA_SPREADSHEET_ID
npx wrangler secret put HEINA_ADMIN_PASSWORD
npx wrangler secret put HEINA_LOOKUP_PIN
npx wrangler secret put HEINA_BANK_PASSWORD
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON
```

- `HEINA_SPREADSHEET_ID`：驗收表網址 `/d/` 與 `/edit` 之間的 ID。
- `HEINA_ADMIN_PASSWORD`：既有管理畫面使用的登入密碼，建議設定全新強密碼。
- `HEINA_LOOKUP_PIN`：四位數預設查單密碼；表內已有個別客人密碼時仍沿用個別設定。
- `HEINA_BANK_PASSWORD`：銀行帳號查詢密碼。
- `GOOGLE_SERVICE_ACCOUNT_JSON`：完整服務帳號 JSON。也可在 PowerShell 以 `Get-Content -Raw -LiteralPath '私鑰的絕對路徑' | npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON` 傳入，不會將內容印出。

選用 Secret：`HEINA_LEDGER_CURRENT_TRIPS_JSON`。若要沿用舊 Apps Script 的各裝置目前行程對應，可手動轉入該屬性；不轉入時，系統從既有行程選取，行程與記帳資料仍在原表。舊登入 token 不轉入，切換後需重新登入。

在 `wrangler.jsonc`：

- `ALLOWED_ORIGINS` 保留 `https://heinashop.com`；若本機驗收，可暫時加入 `http://localhost:5173`（須與實際 Vite port 一致）。
- `HEINA_WRITES_ENABLED` 預設 `false`，此時允許登入與讀取，拒絕資料修改。
- 完成讀取驗收後，只對驗收副本將此值改為 `true`，再執行 `npm run deploy`，測試寫入。

部署輸出會顯示 `https://heina-sheets-api.<帳號子網域>.workers.dev`。`/health` 僅確認環境欄位存在，不代表私鑰或 Sheets 權限已驗證；必須登入並成功讀取資料才算接通。

## 3. 用原管理介面驗收

在專案根目錄建立未追蹤的 `.env.local`：

```dotenv
VITE_API_URL=https://heina-sheets-api.<帳號子網域>.workers.dev/api
```

執行根目錄的 `npm run dev`，開原有 `#/login` 管理介面。`VITE_API_URL` 優先於舊 `VITE_GAS_URL`；新後端失敗時會顯示錯誤，不會悄悄切回舊後端或本機資料。

依序驗收：登入、團務與商品圖片、查單 PIN 隔離、Excel 匯入匯出、付款回報與重送、付款確認與撤銷、日記帳增刪、記帳行程、預購、現貨商城、兩個瀏覽器同時編輯。核對驗收表內容，再確認多裝置資料同步。

## 4. GitHub 自動檢查與部署

原 GitHub Pages workflow 已加入 `VITE_API_URL`。新 `.github/workflows/sheets-backend.yml` 在程式變更時執行後端測試與打包；只有手動 Run workflow 並勾選 deploy 才會部署後端。

若要透過 GitHub 部署 Workers：

1. 在 Cloudflare 建立僅限目標帳戶的 Workers 部署 API token（使用官方 Edit Cloudflare Workers 範本，依 Durable Objects 所需權限設定）。
2. GitHub repository → Settings → Secrets and variables → Actions，設定 Secrets `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`。
3. 設定 `cloudflare-backend` environment；可依你的流程加保護規則。
4. 新增 workflow 必須先合併到預設分支，Actions 才會顯示手動執行入口。後端 Google Secrets 仍由 Cloudflare 保管，不寫入前端或 GitHub 程式碼。

## 5. 正式切換次序

1. 驗收副本全部通過後，備份正式試算表與目前部署版本。
2. 安排短暫維護時段，停止舊 Apps Script Web App 的寫入存取，並關閉已開啟的舊版後台／顧客付款表單。切勿讓舊 Apps Script 和新 Worker 同時寫入同一張表。
3. 將正式表分享給同一服務帳號，更新 Worker 的 `HEINA_SPREADSHEET_ID`，先設 `HEINA_WRITES_ENABLED=false`。核對正式資料讀取；新 ID 使用獨立的 Durable Object，需重新登入。
4. 正式資料確認後設定 `HEINA_WRITES_ENABLED=true` 並部署 Worker。
5. 合併前端接線修改，GitHub Actions Variables 設 `VITE_API_URL` 為新 `/api` 網址，重跑 Pages workflow，驗證 `heinashop.com`。
6. 確認新網站可登入、查單與回報後，移除 `VITE_GAS_URL`，將舊 Apps Script 部署封存。保留舊程式備份供追溯，不再用它提供服務。

回復：先將 Worker 設為唯讀、核對所有待處理寫入，再移除 GitHub 的 `VITE_API_URL`、恢復舊 API 網址並重建 Pages；最後恢復舊服務。不要同時啟用兩套寫入。回復前需核對資料格式與新版寫入內容，不能僅切網址就當作資料已回復。

## 6. 寫入保護及限制

- 每張試算表由一個 Durable Object 排隊處理請求，保留原資料版本／訂單版本檢查。
- 同一操作的儲存格變更使用 Sheets `spreadsheets.batchUpdate` 原子批次送出，保留未修改的儲存格及格式。文字一律以 literal string 寫入，不把顧客輸入解讀為公式。
- 寫入後若網路回應不明，會保存待核對標記，暫停後續寫入；不自動重送。已成功寫入的請求會在下次讀取時依表內 `heina_worker_commit` 自動核對。
- 完整資料讀取有最多 3 秒的記憶體快取，寫入會重新讀表並清除快取。資料量、圖片與 Sheets API 配額會影響速度，需以實際資料量驗收；本版不宣稱比原服務更快。
- 此排隊保護只涵蓋同一 Worker 的請求；Google Sheets 網頁直接編輯、其他程式或舊 Apps Script 不受它的鎖保護。營運寫入請統一從管理介面操作。
- 單一請求及批次上限 8MB，沿用原單張圖片／單一儲存格限制。此版本未做正式資料量、實體手機或真實 Google API 的端到端驗收。
- 預設唯讀模式不保存初始化工作表；記帳在尚無行程時會顯示空清單，啟用寫入後才建立初始行程。
- 管理者從介面更改密碼後，新值保存在 Durable Object 的私人狀態中，優先於啟始 Secret；單改 Secret 不會覆蓋已更改的密碼。

### 處理結果不明的寫入

由已登入管理員以原 API envelope 呼叫 `auth/migrationStatus`，帶 `adminToken`，查看 pending 的 id、時間及操作名稱。不要把 token 放進 URL、公開檔案或聊天。

呼叫 `auth/resolvePending`，payload 為 `{ "pendingId": "狀態回傳的 ID" }`。若表內標記相符，會自動確認成功並解除暫停。

若標記不符，至少等待五分鐘，人工核對原操作未寫入、確認沒有其他寫入來源；再送 `{ "pendingId": "同一 ID", "confirmUncommitted": true, "observedMarker": "試算表目前 heina_worker_commit 的值，沒有則空字串" }`。這只解除待核對狀態，不會重送或回復資料。解除前務必確認實際資料，避免重複付款或帳目。

## 程式位置

- `src/business.mjs`：由目前候選版本移植的獨立業務邏輯，涵蓋登入、團務、日記帳、付款、預購、記帳及商城。
- `src/sheets-model.mjs`：在請求中執行的表格模型與變更批次。
- `src/google-sheets.mjs`：服務帳號 OAuth 與 Sheets API。
- `src/worker.mjs`：HTTP、來源限制、限流、Durable Object 排隊及寫入核對。
- `source-manifest.json`：移植時的來源雜湊；不含私人資料。
- `import-business.mjs`：一次性移植工具；已有獨立模組時會拒絕覆寫。後續維護直接修改 `business.mjs`，不依賴 `.gs` 檔或 Apps Script。

官方參考：[Cloudflare Workers](https://developers.cloudflare.com/workers/)、[Durable Objects](https://developers.cloudflare.com/durable-objects/)、[Google Sheets batchUpdate](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate)、[服務帳號授權](https://developers.google.com/identity/protocols/oauth2/service-account)。
