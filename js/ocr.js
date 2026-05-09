// ocr.js — 用 Tesseract.js 識別圖片,抽取金額/日期/編號/名稱候選

const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
let tesseractReady = null;
let worker = null;

function loadTesseract() {
  if (tesseractReady) return tesseractReady;
  tesseractReady = new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve(window.Tesseract);
    const s = document.createElement('script');
    s.src = TESSERACT_CDN;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => reject(new Error('Tesseract.js 載入失敗(離線或網路問題)'));
    document.head.appendChild(s);
  });
  return tesseractReady;
}

async function getWorker(onProgress) {
  const Tesseract = await loadTesseract();
  if (worker) return worker;
  worker = await Tesseract.createWorker(['chi_tra', 'eng'], 1, {
    logger: m => {
      if (onProgress) onProgress(m);
    },
  });
  // PSM 6 = uniform block of text(對帳單一頁文字最穩定)
  // preserve_interword_spaces 保留欄位間空白,辨識表格時不會把多個空格塌成一個
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
      // 限制能輸出的字元集合 — 中英文 + 數字 + 常用標點
      // 不設 whitelist 反而辨識率較高,這裡先註解
    });
  } catch (e) {
    console.warn('setParameters failed', e);
  }
  return worker;
}

export async function recognize(blobOrDataUrl, onProgress) {
  const w = await getWorker(onProgress);
  const { data } = await w.recognize(blobOrDataUrl);
  return data.text || '';
}

// 抽出金額與日期(用於應收 / 現金 / 支票)
export function extractCandidates(text) {
  const cleaned = text.replace(/\s+/g, ' ');

  // 金額:含逗號或純數字,2 位以上整數,可選小數
  const amountRegex = /(?<![\d.])\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\d.])\d{2,9}(?:\.\d+)?(?!\d)/g;
  const rawAmounts = cleaned.match(amountRegex) || [];
  const amounts = Array.from(new Set(rawAmounts
    .map(s => Number(s.replace(/,/g, '')))
    .filter(n => Number.isFinite(n) && n > 0 && n < 1e10)
  )).sort((a, b) => b - a);

  // 日期
  const dateLong = /(?<!\d)((?:\d{2,4})[\/\-.]\d{1,2}[\/\-.]\d{1,2})(?!\d)/g;
  const dateShort = /(?<!\d)(\d{1,2}[\/\-.]\d{1,2})(?!\d)/g;
  const longs = Array.from(cleaned.matchAll(dateLong)).map(m => m[1]);
  const shorts = Array.from(cleaned.matchAll(dateShort)).map(m => m[1]);
  const dates = Array.from(new Set([...longs, ...shorts]));

  return { amounts: amounts.slice(0, 5), dates: dates.slice(0, 5), raw: text };
}

// 抽取客戶編號候選:英數混合的短代碼或純數字編號
// 常見格式:S5B、A301、ABC1234、1234567 等
export function extractCodeCandidates(text) {
  const cleaned = text.replace(/[　\s]+/g, ' ');
  const candidates = new Set();

  // 含字母 + 數字組合,長度 2-10
  const alpha = cleaned.match(/\b[A-Za-z][A-Za-z0-9]{1,9}\b/g) || [];
  alpha.forEach(s => {
    // 至少要含 1 個數字或全英文 ≥ 2 才算編號(否則可能是普通字)
    const u = s.toUpperCase();
    if (/\d/.test(u) || u.length <= 6) candidates.add(u);
  });

  // 全大寫字母 2-8 字(不含數字也算)
  const upper = cleaned.match(/\b[A-Z]{2,8}\b/g) || [];
  upper.forEach(s => candidates.add(s));

  // 純數字編號(4-10 位)
  const num = cleaned.match(/\b\d{4,10}\b/g) || [];
  num.forEach(s => candidates.add(s));

  // 排序:含字母優先,再依長度
  const arr = Array.from(candidates).sort((a, b) => {
    const aHasLetter = /[A-Z]/.test(a);
    const bHasLetter = /[A-Z]/.test(b);
    if (aHasLetter !== bHasLetter) return aHasLetter ? -1 : 1;
    return b.length - a.length;
  });
  return arr.slice(0, 5);
}

// 抽取客戶名稱候選:CJK 連續字段(2-12 字),排除常見干擾字
export function extractNameCandidates(text) {
  const cleaned = text
    .replace(/[　\s]+/g, ' ')
    // 去掉常見的單位、日期、貨幣記號等干擾
    .replace(/[\d,.\-/:%$NTD]+/g, ' ');

  // 抓 2-12 個 CJK 字的連續段(含常見公司用字 有限公司、股份、企業 等)
  const cjkRegex = /[一-鿿㐀-䶿]{2,12}/g;
  const matches = cleaned.match(cjkRegex) || [];

  // 過濾:排除明顯不是客戶名稱的字串(如「應收帳款」「客戶編號」等)
  const blacklist = new Set([
    '應收', '帳款', '應收帳款', '客戶', '客戶編號', '客戶名稱',
    '日期', '月份', '金額', '支票', '現金', '匯款', '小計', '合計',
    '折讓', '稅金', '折讓稅', '未收', '溢收', '預收', '其他',
    '尾折', '備註', '統一編號', '發票', '單據', '收據',
    '元整', '正本', '副本', '抬頭',
  ]);
  const candidates = Array.from(new Set(matches))
    .filter(s => !blacklist.has(s))
    .filter(s => s.length >= 2 && s.length <= 12)
    .sort((a, b) => b.length - a.length);

  return candidates.slice(0, 6);
}

// 從類別表抽取指定列的「其他1」欄數字。
// 表格欄位順序:類別 / 實價 / 其他1 / 總計
//   3 個數字 → 其他1 = 中間
//   2 個數字 → 因為實價/其他1 哪個為空無法從一列文字判斷,回 null(避免誤填)
//   < 2 個 → null
//
// 限制 slice 在同一列(到下個 \n),避免把下一列的數字吃進來。
export function findCategoryOther(text, label) {
  const escLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[^A-Z0-9])(${escLabel})(?![A-Z0-9])`, 'gi');
  let m;
  while ((m = re.exec(text)) !== null) {
    const startIdx = m.index + m[0].length;
    const nextNL = text.indexOf('\n', startIdx);
    const lineEnd = nextNL < 0 ? text.length : nextNL;
    let sameLineRest = text.slice(startIdx, lineEnd);

    let numStrs = sameLineRest.match(/-?[\d,]{1,12}/g) || [];
    let nums = numStrs
      .map(s => s.replace(/,/g, ''))
      .filter(s => /^-?\d+$/.test(s))
      .map(Number)
      .filter(n => Number.isFinite(n))
      .slice(0, 3);

    // 如果同一列沒有數字(label 後直接 \n),嘗試讀下一列
    // ── 但只在下一列不是另一個英文 label 開頭時才用
    if (nums.length === 0 && nextNL >= 0) {
      const next2NL = text.indexOf('\n', nextNL + 1);
      const nextLine = text.slice(nextNL + 1, next2NL < 0 ? text.length : next2NL);
      if (!/^\s*[A-Z][A-Z0-9]/.test(nextLine)) {
        numStrs = nextLine.match(/-?[\d,]{1,12}/g) || [];
        nums = numStrs
          .map(s => s.replace(/,/g, ''))
          .filter(s => /^-?\d+$/.test(s))
          .map(Number)
          .filter(n => Number.isFinite(n))
          .slice(0, 3);
      }
    }

    if (nums.length === 3) return nums[1];
    // 同列只有 2 個數字無法判斷哪欄為空,跳過此次匹配
  }
  return null;
}

// 智慧掃描:一張對帳單同時擷取多個欄位
// 對齊範本:展晟照明對帳單格式
//   月份 2026/02/26 ~ 2026/03/25  /  115/3月
//   客戶 S5A0806灣連燈飾有限公司(火車頭)
//   本月應收金額總計 994,706
//   累計逾期未收 0
export function extractBillFields(text) {
  const cleaned = text.replace(/\s+/g, ' ');
  const result = {
    month: null,
    customerCode: null,
    customerName: null,
    receivable: null,
    overdue: null,
    eClass1: null,         // 類別 E1 列的「其他1」欄
    eClass2: null,         // 類別 E2 列的「其他1」欄
    rawText: text,
  };

  // ─── 月份 ───
  // 優先:民國年 115/3月 或 115年3月
  const rocMatch = cleaned.match(/(\d{2,3})[\/\s年]+(\d{1,2})\s*月/);
  if (rocMatch) {
    const yyAd = (Number(rocMatch[1]) + 1911) % 100;
    result.month = `${String(yyAd).padStart(2, '0')}/${String(rocMatch[2]).padStart(2, '0')}`;
  }
  // 其次:西元日期範圍 2026/02/26 ~ 2026/03/25 → 取結束日的年月
  if (!result.month) {
    const range = cleaned.match(/(\d{4})[\/\-](\d{1,2})[\/\-]\d{1,2}\s*[~\-至到]+\s*(\d{4})[\/\-](\d{1,2})[\/\-]\d{1,2}/);
    if (range) {
      const yy = String(Number(range[3]) % 100).padStart(2, '0');
      const mm = String(range[4]).padStart(2, '0');
      result.month = `${yy}/${mm}`;
    }
  }
  // 最後備援:純年/月格式 26/03 等
  if (!result.month) {
    const ym = cleaned.match(/\b(\d{2})[\/\-](\d{1,2})\b/);
    if (ym && Number(ym[2]) >= 1 && Number(ym[2]) <= 12) {
      result.month = `${ym[1]}/${String(ym[2]).padStart(2, '0')}`;
    }
  }

  // ─── 客戶編號 ───
  // 對帳單客戶編號常見格式:S5A0806、A301、5BS4 等
  // 抓「客戶」後面的編號 → 最高優先
  const custNearby = cleaned.match(/客戶[:\s]*([A-Za-z][A-Za-z0-9]{2,9})/);
  if (custNearby) {
    result.customerCode = custNearby[1].toUpperCase();
  }
  // 備援:文字中第一個英數混合 3-10 字代碼
  if (!result.customerCode) {
    const codeMatch = cleaned.match(/\b([A-Z]\d?[A-Z]?\d{3,7})\b/i);
    if (codeMatch) result.customerCode = codeMatch[1].toUpperCase();
  }

  // ─── 客戶名稱 ───
  // 1) 客戶編號後面緊跟著的中文公司名(以「公司」結尾)
  if (result.customerCode) {
    const after = cleaned.split(result.customerCode)[1] || '';
    const co = after.match(/^[\s]*([一-龥]{2,16}(?:股份)?(?:有限)?公司)/);
    if (co) result.customerName = co[1];
  }
  // 2) 文字中第一個「XX...有限公司」或「XX...股份公司」
  if (!result.customerName) {
    const co2 = cleaned.match(/([一-龥]{2,12}(?:股份)?(?:有限)?公司)/);
    if (co2) result.customerName = co2[1];
  }

  // ─── 應收金額 ───
  // 優先:本月應收金額總計
  const recv = cleaned.match(/本月應收(?:金額)?(?:總計)?[\s:：]*([0-9,]{4,})/);
  if (recv) {
    const n = Number(recv[1].replace(/,/g, ''));
    if (Number.isFinite(n)) result.receivable = n;
  }
  // 備援:金額總計
  if (!result.receivable) {
    const tot = cleaned.match(/(?:金額總計|應收金額總計)[\s:：]*([0-9,]{4,})/);
    if (tot) {
      const n = Number(tot[1].replace(/,/g, ''));
      if (Number.isFinite(n)) result.receivable = n;
    }
  }

  // ─── E類1 / E類2 從類別表的「其他1」欄取值 ───
  // 對 raw text(保留換行)做匹配,類別表常見每行一筆
  result.eClass1 = findCategoryOther(text, 'E1');
  result.eClass2 = findCategoryOther(text, 'E2');

  // ─── 累計逾期未收 ───
  const od = cleaned.match(/(?:累計)?(?:逾期)?未收[\s:：]*([0-9,]+)/);
  if (od) {
    const n = Number(od[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) result.overdue = n;
  }

  return result;
}

export async function terminateWorker() {
  if (worker) {
    try { await worker.terminate(); } catch (_) {}
    worker = null;
  }
}
