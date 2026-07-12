# Leaf2 E-Ink Dashboard 專案整理

更新日期：2026-07-11

> 簡約是細膩的極致
>
> Simplicity is the ultimate sophistication.

這是一個放在七吋 BOOX Leaf2 上、從遠處一眼讀懂的資訊面板，不是縮小版分析後台。畫面只保留時間、天氣、Codex 與 Claude Code 的五小時用量、剩餘額度和重置時間。

## 目前成果

- Node.js 伺服器監聽 `0.0.0.0:8765`，提供靜態頁面、`/api/status` 與 `/api/weather`。
- Leaf2 直向版面上方並排顯示時間與天氣，下方為每五分鐘切換中英文的提醒句。
- Codex 優先讀取 `~/.codex/sessions/**/*.jsonl` 的官方本機 `rate_limits`；缺少資料時才改用本機 token 估算。
- Codex 另以唯讀方式查詢 banked rate-limit resets；只有官方回傳可用次數大於 0 時才顯示，面板不提供消耗 reset 的操作。
- Claude Code 優先以本機 OAuth 憑證唯讀查詢官方五小時與七日 utilization；失敗時依序退回 statusline 快照及 `~/.claude/projects` 的五小時 token 估算。
- 官方百分比與本機估算在 API 和畫面上都有明確標示，未知值顯示 `--`，不假裝精確。
- 天氣由 Open-Meteo 提供，BOOX 上用大型中文天氣文字，避免裝置缺少 emoji 字型。
- 測試涵蓋 usage 顯示契約、官方與估算狀態，以及 Claude 設定檔修復。
- 目前共有 9 項 Node 測試，另有 server、前端 JavaScript 語法與 `git diff --check` 驗證。
- Codex／Claude Code 額度卡片各自從本機 session JSONL 顯示待回覆、中斷與完成；只顯示專案、狀態與時間，每張卡只突出最高優先項，其餘合併計數。

## 啟動與連線

在專案目錄啟動伺服器：

```powershell
npm start
```

USB 連線 Leaf2、允許 USB 偵錯後執行：

```powershell
adb devices
adb reverse tcp:8765 tcp:8765
```

接著在 Leaf2 瀏覽器開啟：

```text
http://127.0.0.1:8765
```

`adb reverse` 不是永久設定；USB 重接、ADB 重啟或裝置重開後都可能需要重新執行。
可執行一次 `npm run install:autostart` 安裝使用者層級的 Windows 登入排程；背景 watcher 會啟動 dashboard，並在 Leaf2 或 ADB 重連後自動補回 `tcp:8765` reverse。

## Claude Code statusline

自動安裝：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-claude-statusline.ps1
```

如果 Claude Code 顯示 `settings.json` 無效：

```powershell
node .\scripts\repair-claude-settings.js --write
```

修復工具會先建立時間戳備份。重新啟動 Claude Code 並送出一則訊息後，statusline 才會收到新快照；在此之前儀表板仍會顯示本機估算。

## 這次踩到的坑

### BOOX 實機版面不同於桌面模擬

BOOX 瀏覽器會把工具列算進 `100vh`，造成 Claude 卡片在實機底部被截斷。版面現在以 `window.innerHeight` 同步 CSS 高度。後續任何版面修改都要擷取 Leaf2 實機截圖驗證，不能只看桌面瀏覽器。

### Emoji 不是可靠的 E Ink 圖示

天氣 emoji 在 Windows 正常，在 Leaf2 可能完全不顯示。除非把圖示做成自帶資產並驗證，否則使用大型中文天氣文字較可靠。

### Windows 路徑會經過不同 shell

Claude Code 的 statusline 在 Windows 上可能透過 Git Bash 執行。JSON 中的反斜線可能被當成跳脫字元，甚至讓 `settings.json` 無法解析，因此安裝器寫入正斜線路徑。

### 工具已安裝不代表目前 PowerShell 找得到

新安裝的 `gh`、`adb` 或其他 CLI 可能尚未進入目前行程的 `PATH`。先開新的 PowerShell，再用 `Get-Command <name>` 確認；必要時使用完整路徑。WindowsApps 內的封裝程式也不一定能直接執行。

### USB reverse 與瀏覽器快取都不是永久狀態

Leaf2 突然連不到頁面時，先查 `adb devices` 是否為 `device`，再重做 reverse。頁面仍是舊版時先重新載入，必要時暫時加上 `?v=N` 排除快取。

### 用量資料必須標示可信度

Codex 與 Claude Code 的官方百分比來自 rate-limit metadata；從 JSONL 計算出的 token 只能稱為估算。不要用顏色方塊或圖示暗示狀態，應直接寫「官方」或「估算」。

### Claude OAuth usage 端點未公開

Claude Code 的 OAuth usage 端點可回傳官方五小時與七日 utilization，但目前不是 Anthropic 公開文件中的穩定 API。伺服器只在記憶體使用本機 access token、短暫快取結果、不回傳或記錄憑證，且端點失效時必須保留 statusline 與本機歷史回退。

## 給自己的提醒

- 七吋螢幕上看不清楚的資訊，就不值得留在主畫面。
- 先看「用了多少、剩多少、何時重置」，再考慮加入其他數據。
- 不要用精密的外觀包裝不精確的資料。
- 畫面是為了減少查看瀏覽器與指令的負擔，不是增加另一個需要研究的介面。

## 給後續協作者的提醒

- 修改前先確認資料來源是官方值還是估算值，並維持顯示契約。
- 修改後至少執行語法檢查、`npm test`，並用實際 Leaf2 截圖確認上下邊界、字級與對齊。
- 不要只以桌面版「看起來正常」作為完成標準。
- 優先刪減資訊；只有在能幫助下一個決定時才新增欄位。

## 待辦

- 在不受工具沙箱網路限制的 PowerShell 啟動 server，確認 Claude 官方五小時百分比、進度條、剩餘額度與 reset 時間能在 Leaf2 完整顯示。
- 若帳戶取得 banked Codex reset，確認 Codex 卡片只在可用次數大於 0 時顯示「可用重置」，且不壓縮主要用量資訊。
- 微調時間與天氣卡片的內容基線和視覺對齊；目前資訊完整且可一眼閱讀，但上方構圖仍可改善。
- 評估是否需要開機自動啟動 server 與自動重建 ADB reverse。
- 若未來要加入新的提醒資訊，維持單行、遠距可讀，且不可壓縮兩張 usage 卡片。

## 下一個對話接手

目前 working tree 尚未提交，內容包含：

- Leaf2 天氣／氣溫單行排列、放大提醒句與重置時間。
- Claude 官方 OAuth usage 查詢、短快取與 token 歷史回退。
- Codex banked rate-limit reset 次數的唯讀條件式顯示。
- usage contract 測試、README／專案整理，以及 `AGENTS.md` commit 規則。

下一個對話先讀 `AGENTS.md`，依 lazy-commit 原則檢查完整 diff，按修改意圖拆分 atomic commits。提交前重新執行：

```powershell
node --check server.js
node --check public/app.js
node --test
git diff --check
```

如需實機驗證，先由一般 PowerShell 執行 `node server.js`，確認 `adb devices` 後重建 `adb reverse tcp:8765 tcp:8765`，再重新整理 Leaf2 的 `http://127.0.0.1:8765`。
