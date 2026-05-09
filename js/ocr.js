// ocr.js — 用 Tesseract.js 識別圖片,並抽出金額/日期候選
// Tesseract.js 透過 CDN 動態載入,避免 npm

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
      if (onProgress && (m.status === 'recognizing text' || m.status === 'loading'))
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

// 從 OCR 文字中抽出候選數字與日期
export function extractCandidates(text) {
  const cleaned = text.replace(/\s+/g, ' ');

  // 金額:可能含逗號,1 至 9 位整數,可選小數
  const amountRegex = /(?<![\d.])\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\d.])\d{2,9}(?:\.\d+)?(?!\d)/g;
  const rawAmounts = cleaned.match(amountRegex) || [];
  const amounts = Array.from(new Set(rawAmounts
    .map(s => Number(s.replace(/,/g, '')))
    .filter(n => Number.isFinite(n) && n > 0 && n < 1e10)
  )).sort((a, b) => b - a);

  // 日期:支援多種分隔符 / - .
  const dateRegex = /(?<!\d)((?:\d{2,4})[\/\-.]\d{1,2}[\/\-.]\d{1,2})(?!\d)/g;
  const dateMatches = Array.from(cleaned.matchAll(dateRegex)).map(m => m[1]);
  // 也支援 MM/DD(無年份)
  const shortDateRegex = /(?<!\d)(\d{1,2}[\/\-.]\d{1,2})(?!\d)/g;
  const shortMatches = Array.from(cleaned.matchAll(shortDateRegex)).map(m => m[1]);
  const dates = Array.from(new Set([...dateMatches, ...shortMatches]));

  return { amounts: amounts.slice(0, 5), dates: dates.slice(0, 5), raw: text };
}

export async function terminateWorker() {
  if (worker) {
    try { await worker.terminate(); } catch (_) {}
    worker = null;
  }
}
