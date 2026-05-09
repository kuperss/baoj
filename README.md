# 應收帳款計算 PWA

手機端的應收帳款核對工具,把桌面版 `應收帳款填入工具_美化版.py` 的計算邏輯與欄位 1:1 移植到瀏覽器,可離線使用、可安裝到主畫面、支援鏡頭 OCR 快速填值。

## 啟動

PWA 必須由 HTTP/HTTPS 提供(`file://` 不能用 service worker 與 getUserMedia),選一種方式:

### 在電腦本機測試

```powershell
# 在 baoj 資料夾內
python -m http.server 8080
```

開瀏覽器到 `http://localhost:8080/`。

### 部署到手機可用的網址

- 把整個 `baoj/` 推到 GitHub Pages、Netlify、Vercel、Cloudflare Pages 都能跑(全部都是靜態檔)
- 或自架 Nginx / Caddy

> ⚠️ 鏡頭 OCR 必須在 **HTTPS** 或 `localhost` 才能用。透過 IP `http://192.168.x.x` 開啟,Chrome / Safari 不會給相機權限。

### 安裝到手機主畫面

- iOS Safari → 分享 → 加入主畫面
- Android Chrome → 選單 → 安裝應用程式

## 欄位

對齊桌面版,共 23 個欄位:

| 群組 | 欄位 |
|---|---|
| 客戶資訊 | 日期、月份、客戶編號、客戶名稱 |
| 主軸 | 應收 |
| 收款 | 現金、支票(可多筆,每筆日期+金額)、匯款(可多筆) |
| E類/GA% | E類1、E類2 → 自動算 GA%、GA稅 |
| 折讓 | 折讓1/2/3、LED%、現金%、尾折(各自有 5% 稅) |
| 其他 | 其他、預收、未收、溢收 |

## 計算公式

```
GA%   = round((E類1 + E類2) × 5%)
GA稅  = round(GA% × 5%)

收款側 = 現金 + 匯款合計 + 支票合計 + 現金% + 未收 + 其他
折讓側 = 折讓1 + 折讓2 + 折讓3 + GA% + LED% + 尾折
折讓稅 = round(折讓1×5%) + round(折讓2×5%) + round(折讓3×5%) + GA稅 + round(LED%×5%)

差額 = 應收 - 收款側 - 折讓側 - 折讓稅
```

差額顯示:
- 綠色 + ✔ → 已平衡(可存檔)
- 黃色 → 未收(可一鍵帶入「未收」或「尾折」)
- 紅色 → 溢收(可一鍵帶入「溢收」)

## OCR 模式

| 進入點 | 行為 |
|---|---|
| 主軸「應收」旁的 📷 | 拍對帳單 → 列候選金額 → 點「填入」 |
| 「現金」旁的 📷 | 同上,填入現金欄 |
| 「掃描支票」按鈕 | 拍支票 → 列候選金額與日期 → 新增一筆支票 |
| 動態列裡的 📷 | 更新該筆支票/匯款 |

第一次使用會從 jsdelivr 下載 Tesseract.js 與繁中+英語語言模型(約 10MB),之後 service worker 會快取。

## 資料儲存

- **草稿**:每次輸入後 400ms 自動寫入 `localStorage.baoj_draft_v1`,下次打開會還原
- **歷史**:差額為 0 + 有客戶編號時可存檔,最多保留 50 筆,可「以此為樣板」重用

所有資料都在這支手機的瀏覽器內,不上傳。清掉瀏覽器資料就會全部消失。

## 檔案結構

```
baoj/
├── index.html
├── manifest.webmanifest
├── sw.js
├── css/styles.css
├── js/
│   ├── app.js       # DOM 綁定 / 事件 / OCR 流程
│   ├── calc.js      # 純計算(對齊桌面版 calc_diff)
│   ├── storage.js   # localStorage 草稿+歷史
│   ├── camera.js    # getUserMedia
│   └── ocr.js       # Tesseract.js
└── icons/           # PWA 圖示
```

## 不在這版本

- Excel 匯出(桌面版有,可日後加 SheetJS)
- 30/60/90 天支票分群(只有 Excel 匯出時用得到)
- API 整合 / 雲端同步
