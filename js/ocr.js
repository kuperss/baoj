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
      if (onProgress && (m.status === 'recognizing text' || m.status.includes('language')))
        onProgress(m);
    },
  });
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

export async function terminateWorker() {
  if (worker) {
    try { await worker.terminate(); } catch (_) {}
    worker = null;
  }
}
