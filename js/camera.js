// camera.js — 包裝 getUserMedia 與拍照擷圖

let currentStream = null;

export async function startCamera(videoEl) {
  if (currentStream) stopCamera();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('此瀏覽器不支援相機(需 HTTPS 或 localhost)');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width:  { ideal: 1920 },
      height: { ideal: 1080 },
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

// 從 video 擷取一張靜態畫面 → 回傳 { blob, dataUrl }
export async function capture(videoEl, canvasEl) {
  const w = videoEl.videoWidth || 1280;
  const h = videoEl.videoHeight || 720;
  canvasEl.width = w;
  canvasEl.height = h;
  const ctx = canvasEl.getContext('2d');
  ctx.drawImage(videoEl, 0, 0, w, h);
  const dataUrl = canvasEl.toDataURL('image/jpeg', 0.92);
  const blob = await new Promise(res => canvasEl.toBlob(res, 'image/jpeg', 0.92));
  return { blob, dataUrl };
}
