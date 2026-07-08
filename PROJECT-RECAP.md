# Leaf2 E-Ink Dashboard 對話產出整理

更新日：2026-07-08

這份文件把目前對話中已經落地的產出，用四個綱領整理成可接續工作的版本：

- `ONE-PERSON-COMPANY.md`：這個專案服務什麼目標，現在是否值得繼續投入。
- `DELEGATION-RULES.md`：哪些工作可交給 Codex / Claude Code，哪些仍需要人判斷。
- `PITFALL-LEDGER.md`：目前踩過的坑、原因、修正方式。
- `PARKING-LOT.md`：先記下但不立刻做的後續項目。

> 註：原始綱領檔案讀取時有編碼亂碼，但檔名與可辨識段落足夠判斷其用途；本文件依照可辨識的結構整理。

## 1. One-Person Company 視角

### 專案定位

把 BOOX Leaf2 變成桌上的低干擾 E Ink 儀表板，顯示：

- 目前時間與日期
- 台北天氣
- Codex 使用量估算
- Claude Code 5 小時視窗使用量、reset 時間與剩餘狀態

這不是展示型網站，而是一個給自己長時間工作的 operational board：不用切瀏覽器、不用一直打 `/usage`，抬頭就能看到是否該繼續跑 agent 或等待 reset。

### 已經產出的可用能力

1. 本機 Node.js dashboard server
   - `server.js`
   - 監聽 `0.0.0.0:8765`
   - 提供 `/api/status` 與 `/api/weather`
   - 靜態頁面放在 `public/`

2. Leaf2 連線方式
   - 優先使用 USB + ADB reverse
   - Leaf2 瀏覽器開 `http://127.0.0.1:8765`
   - 避開 Wi-Fi 防火牆、AP isolation、區網 IP 變動等問題

3. E Ink 直放介面
   - 針對 Leaf2 portrait 顯示調整
   - 高對比、少色、粗線框
   - 將用量資訊改成更容易一眼掃描的卡片：大標題、meter、重點數字

4. Claude Code usage 管線
   - `scripts/claude-statusline.js`
   - 可接 Claude Code statusline JSON
   - 若沒有 statusline 真實百分比，會 fallback 掃描本機 `.claude/projects/*.jsonl` 做 5h / 7d token 估算

5. Codex usage 管線
   - `scripts/codex-usage-snapshot.py`
   - 讀取本機 `%USERPROFILE%\.codex\logs_2.sqlite`
   - 聚合 `response.completed` usage events
   - 產生 `data/codex-status.json`
   - dashboard 顯示 5h token、cached token、7d token、主要 model

6. GitHub repo
   - remote: `https://github.com/dmvpchou/einkdashboard.git`
   - 已推送到 GitHub

## 2. Delegation Rules

### L1：可以機械化執行

這些工作不需要太多判斷，可以交給腳本、排程或明確指令：

- 啟動 server：`npm start`
- 建立 ADB reverse：`adb reverse tcp:8765 tcp:8765`
- Leaf2 重新整理：`http://127.0.0.1:8765/?v=5`
- 讀取 weather cache
- 產生 Codex snapshot：`python scripts/codex-usage-snapshot.py`
- 寫入 `data/*.json`
- git status / commit / push

### L2：適合交給 Codex 或 Claude Code 協作

這些工作需要理解現有程式與使用情境，但可以由 agent 產出第一版：

- Leaf2 版面調整與視覺層級重排
- usage card 的文字、meter、欄位設計
- Claude / Codex data adapter
- README 與操作文件
- Windows / BOOX 連線問題排查
- 將錯誤狀態轉成可讀的 dashboard 狀態
- 把 browser cache 問題改成 asset versioning

### L3：仍需要人決策

這些不是 coding 問題，而是取捨問題：

- 是否信任本機 logs 估算，還是只接受官方 usage 數字
- Claude 5h token budget 要設定多少才合理
- dashboard 是否可以讀 `.claude` / `.codex` 本機紀錄
- Codex usage 要顯示 token、百分比、剩餘額度，還是 reset 時間優先
- Leaf2 是否要長期作為專用顯示器

## 3. Pitfall Ledger

### Wi-Fi 網址連不到

- 現象：Leaf2 用 Wi-Fi 開 PC IP 失敗。
- 可能原因：Windows 防火牆、路由器 AP isolation、IP 變動。
- 修正：改用 USB + `adb reverse tcp:8765 tcp:8765`。
- 狀態：已採用 USB reverse 作為主要方案。

### ADB / gh / codex 指令找不到

- 現象：PowerShell 顯示 `無法辨識 'adb'`、`無法辨識 'gh'`、`無法辨識 'codex'`。
- 原因：CLI 安裝後 PATH 尚未更新，或 Windows app alias 與實際執行檔不同。
- 修正：重新開 PowerShell、確認 PATH、必要時用完整路徑或改讀本機資料檔。
- 狀態：ADB 已可用；Codex CLI 則改用本機 SQLite logs 估算 usage。

### WindowsApps codex.exe 存取被拒

- 現象：直接執行 WindowsApps 裡的 `codex.exe` 失敗。
- 原因：WindowsApps 權限與 app packaging 限制。
- 修正：不依賴直接執行該 exe，改讀 Codex app 寫出的本機 log database。
- 狀態：已繞開。

### BOOX 瀏覽器 cache 造成畫面不更新

- 現象：PC 上更新了，Leaf2 上沒變。
- 原因：BOOX 內建瀏覽器 cache 比較頑固。
- 修正：CSS/JS 加 asset version，必要時 URL 加 `?v=N` 強制刷新。
- 狀態：已處理，但後續仍可再做自動 cache busting。

### UI 不容易一眼看懂用量

- 現象：原本只看到 `5h usage` 與一串 token 文字，不像真正的用量儀表。
- 原因：資料是 log-like caption，不是 dashboard-first 呈現。
- 修正：改成 usage card：大數字、meter、剩餘或 reset、三個 key stats。
- 狀態：已改善；仍可接官方百分比後再提升。

### Weather 502

- 現象：Leaf2 顯示 `Weather unavailable HTTP 502`。
- 原因：Open-Meteo 或網路暫時不可用。
- 修正：server 加 weather cache fallback。
- 狀態：已有基本 fallback。

### Claude / Codex exact quota 不一定可得

- 現象：想看官方那種百分比或剩餘額度，但 local logs 只能估算。
- 原因：Claude Code statusline 可提供 rate limit 欄位，但要正確接入；Codex 個人 usage 沒有穩定公開 API 可直接抓 exact remaining quota。
- 修正：資料來源標示 `est.`；Claude 優先接 statusline，Codex 使用本機 logs 估算。
- 狀態：Claude 待接完整官方格式；Codex 目前是 local estimate。

## 4. Parking Lot

### 高優先級

- 確認 Claude Code statusline 是否已實際寫入 `data/claude-status.json`。
- 把 Claude 官方 `/usage` 近似格式轉成 dashboard 欄位：percentage、remaining、reset time。
- 讓 Claude usage 在 Leaf2 上顯示成「百分比 + reset 時間 + 剩餘量」。
- 加一個 local config，讓使用者填 Claude 5h token budget，估算 remaining。
- 讓 Codex usage 顯示更像 quota panel，而不是 token log。

### 中優先級

- Windows 開機自動啟動 `npm start`。
- 自動執行 `adb reverse tcp:8765 tcp:8765`。
- Leaf2 全螢幕 / kiosk 模式設定。
- dashboard 加最後更新時間與資料來源狀態。
- 天氣 API fallback 更完整，避免一個 502 讓整張卡變空。

### 低優先級

- 若未來有 OpenAI Enterprise Analytics API 權限，新增官方 Codex usage adapter。
- 新增不同版型：portrait compact、desktop preview、large clock mode。
- 做一個 setup checklist 頁面。
- 將 usage history 存成簡單趨勢圖，但要小心 E Ink 不適合細線圖。

## 5. 目前操作手冊

### 啟動 PC server

```powershell
npm start
```

### 連接 Leaf2

```powershell
adb devices
adb reverse tcp:8765 tcp:8765
```

Leaf2 瀏覽器開：

```text
http://127.0.0.1:8765
```

若畫面疑似 cache：

```text
http://127.0.0.1:8765/?v=5
```

### Claude Code statusline 建議命令

```powershell
node "C:\Users\user\Documents\Codex\2026-07-05\boox-leaf2-pc-codex-claude-code\scripts\claude-statusline.js"
```

### Codex snapshot

```powershell
python scripts\codex-usage-snapshot.py
```

server 在 `/api/status` 被呼叫時也會嘗試更新 Codex snapshot。

## 6. 目前限制與風險

- `data/*.json` 是本機狀態檔，不會 commit；這是刻意設計，避免把個人 usage 狀態推上 GitHub。
- server 會讀取本機 `.claude` 與 `.codex` 相關紀錄；這只適合跑在自己的 PC。
- Claude 若沒有 statusline rate limit 欄位，目前只能估 token，不等於官方 quota。
- Codex 目前是從本機 logs 估算，不是官方剩餘額度。
- Leaf2 內建瀏覽器 UI 會吃掉上方高度；若要更像專用顯示器，需要再處理全螢幕或 kiosk。

## 7. 下一個最合理的工作順序

1. 先把 Claude Code statusline 的真實 rate limit 欄位接穩。
2. 再把 usage card 改成「百分比優先」的顯示。
3. 加入 user config：Claude 5h budget、城市、刷新頻率。
4. 做 Windows 自動啟動與 ADB reverse 自動化。
5. 最後再考慮 Codex 官方 usage 來源，若沒有官方 API，就清楚標示 local estimate。
