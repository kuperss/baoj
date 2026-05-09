// camera.js — 包裝 getUserMedia 與拍照擷圖,並做 OCR 前處理

let currentStream = null;

export async function startCamera(videoEl) {
  if (currentStream) stopCamera();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('此瀏覽器不支援相機(需 HTTPS 或 localhost)');
  }
  // 盡量要求高解析度 — 對帳單小字必須有夠像素 OCR 才認得出來
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width:  { ideal: 2560 },
      height: { ideal: 1440 },
    },
    audio: false,
  });
  currentStream = stream;
  videoEl.srcObject = stream;
  await videoEl.play().catch(() => {});
  return stream;
}

export function stopCamera() {
  if (currentStream) {
    currentStream.getTracks().forEach(t => t.stop());
    currentStream = null;
  }
}

// 從 video 擷取一張靜態畫面 → 回傳 { blob, dataUrl, w, h }
// 預設套用前處理:灰階化 + 自動對比拉伸 + 上採樣(若解析度不足)
export async function capture(videoEl, canvasEl, options = {}) {
  const { preprocess = true, minLongSide = 1600 } = options;

  let w = videoEl.videoWidth || 1280;
  let h = videoEl.videoHeight || 720;

  // 若解析度不足就放大,Tesseract 對小字辨識率隨像素增加大幅提升
  let scale = 1;
  const longSide = Math.max(w, h);
  if (longSide < minLongSide) scale = minLongSide / longSide;

  canvasEl.width = Math.round(w * scale);
  canvasEl.height = Math.round(h * scale);
  const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);

  if (preprocess) {
    applyOcrPreprocess(ctx, canvasEl.width, canvasEl.height);
  }

  const dataUrl = canvasEl.toDataURL('image/jpeg', 0.92);
  const blob = await new Promise(res => canvasEl.toBlob(res, 'image/jpeg', 0.92));
  return { blob, dataUrl, w: canvasEl.width, h: canvasEl.height };
}

// 灰階化 + 自動對比拉伸(以圖片亮度直方圖的 5%-95% 分位點為基準)
// 對於黃色帳單紙特別有效:把背景拉到接近白、文字拉到接近黑。
function applyOcrPreprocess(ctx, w, h) {
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  const N = data.length / 4;

  // 第 1 趟:轉灰階 + 收集亮度直方圖
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i+1], b = data[i+2];
    const v = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
    data[i] = v; data[i+1] = v; data[i+2] = v;
    hist[v]++;
  }

  // 找到 5% / 95% 分位點作為對比拉伸的下限/上限
  const lowCut = Math.floor(N * 0.05);
  const highCut = Math.floor(N * 0.95);
  let cum = 0, lo = 0, hi = 255;
  for (let i = 0; i < 256; i++) {
    cum += hist[i];
    if (cum >= lowCut) { lo = i; break; }
  }
  cum = 0;
  for (let i = 0; i < 256; i++) {
    cum += hist[i];
    if (cum >= highCut) { hi = i; break; }
  }
  if (hi <= lo) { hi = lo + 1; }

  const range = hi - lo;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    let v = ((i - lo) * 255 / range) | 0;
    if (v < 0) v = 0;
    if (v > 255) v = 255;
    lut[i] = v;
  }

  // 第 2 趟:套用 LUT
  for (let i = 0; i < data.length; i += 4) {
    const v = lut[data[i]];
    data[i] = v; data[i+1] = v; data[i+2] = v;
  }

  ctx.putImageData(imgData, 0, 0);
}
