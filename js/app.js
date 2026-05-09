// app.js — DOM 綁定 / 事件分派 / 草稿與歷史 UI

import { compute, fmt, num } from './calc.js';
import {
  saveDraft, loadDraft, clearDraft,
  loadHistory, appendHistory, deleteHistory, getHistory,
} from './storage.js';
import { startCamera, stopCamera, capture } from './camera.js';
import { recognize, extractCandidates } from './ocr.js';

// ───────── State ─────────
const SCALAR_KEYS = [
  'date', 'month', 'customerCode', 'customerName',
  'receivable', 'cash',
  'eClass1', 'eClass2',
  'allowance1', 'allowance2', 'allowance3',
  'ledPercent', 'cashPercent', 'tailDiscount',
  'other', 'advance', 'unpaid', 'overpaid',
];

const NUM_KEYS = new Set([
  'receivable', 'cash',
  'eClass1', 'eClass2',
  'allowance1', 'allowance2', 'allowance3',
  'ledPercent', 'cashPercent', 'tailDiscount',
  'other', 'advance', 'unpaid', 'overpaid',
]);

let state = makeEmptyState();

function makeEmptyState() {
  const s = {};
  SCALAR_KEYS.forEach(k => s[k] = '');
  s.checks = [];
  s.remits = [];
  return s;
}

// ───────── DOM helpers ─────────
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

// ───────── 初始化 ─────────
window.addEventListener('DOMContentLoaded', () => {
  hydrateFromDraft();
  bindScalarFields();
  bindDynamicLists();
  bindActions();
  bindTabs();
  bindOcrButtons();
  recalcAll();
});

function hydrateFromDraft() {
  const d = loadDraft();
  if (!d) {
    // 預設給一筆空支票列以便看見 UI
    state.checks = [];
    state.remits = [];
    return;
  }
  state = { ...makeEmptyState(), ...d };
  if (!Array.isArray(state.checks)) state.checks = [];
  if (!Array.isArray(state.remits)) state.remits = [];
  // 寫回 DOM
  SCALAR_KEYS.forEach(k => {
    const el = document.querySelector(`[data-key="${k}"]`);
    if (el) el.value = state[k] ?? '';
  });
  renderChecks();
  renderRemits();
}

// ───────── 綁定純量欄位 ─────────
function bindScalarFields() {
  $$('[data-key]').forEach(input => {
    const key = input.dataset.key;
    input.addEventListener('input', () => {
      state[key] = input.value;
      onStateChanged();
    });
    input.addEventListener('blur', () => {
      // 數字欄位失焦後格式化
      if (NUM_KEYS.has(key) && input.value.trim() !== '') {
        const n = num(input.value);
        // 保留使用者整數輸入,僅去除多餘空白
        input.value = String(n).replace(/^0+(?=\d)/, '') || '0';
        state[key] = input.value;
        onStateChanged();
      }
    });
  });
}

// ───────── 動態列(支票 / 匯款) ─────────
function bindDynamicLists() {
  $('#btn-add-check').addEventListener('click', () => {
    state.checks.push({ date: '', amount: '' });
    renderChecks();
    onStateChanged();
  });
  $('#btn-add-remit').addEventListener('click', () => {
    state.remits.push({ date: '', amount: '' });
    renderRemits();
    onStateChanged();
  });
  $('#btn-scan-check').addEventListener('click', () => openOcr('check'));
}

function renderChecks() {
  const list = $('#checks-list');
  list.innerHTML = '';
  state.checks.forEach((c, i) => list.appendChild(makeDynRow('check', i, c)));
}
function renderRemits() {
  const list = $('#remits-list');
  list.innerHTML = '';
  state.remits.forEach((r, i) => list.appendChild(makeDynRow('remit', i, r)));
}

function makeDynRow(kind, index, data) {
  const row = document.createElement('div');
  row.className = 'dyn-row';
  row.dataset.kind = kind;
  row.dataset.index = index;
  row.innerHTML = `
    <input type="text" class="date" placeholder="日期" autocomplete="off" value="${escapeAttr(data.date)}">
    <input type="text" class="amt" inputmode="decimal" placeholder="金額" value="${escapeAttr(data.amount)}">
    <button type="button" class="btn-cam" data-action="ocr" aria-label="掃描">📷</button>
    <button type="button" class="btn-row-rm" data-action="remove" aria-label="刪除">✕</button>
  `;
  const dateEl = row.querySelector('.date');
  const amtEl  = row.querySelector('.amt');
  dateEl.addEventListener('input', () => {
    bucket(kind)[index].date = dateEl.value;
    onStateChanged({ skipDomSync: true });
  });
  amtEl.addEventListener('input', () => {
    bucket(kind)[index].amount = amtEl.value;
    onStateChanged({ skipDomSync: true });
  });
  row.querySelector('[data-action="remove"]').addEventListener('click', () => {
    bucket(kind).splice(index, 1);
    if (kind === 'check') renderChecks(); else renderRemits();
    onStateChanged();
  });
  row.querySelector('[data-action="ocr"]').addEventListener('click', () => {
    openOcr(kind === 'check' ? 'check-row' : 'remit-row', { index });
  });
  return row;
}

function bucket(kind) {
  return kind === 'check' ? state.checks : state.remits;
}

// ───────── 重新計算與更新 UI ─────────
let saveDraftTimer = null;
function onStateChanged() {
  recalcAll();
  if (saveDraftTimer) clearTimeout(saveDraftTimer);
  saveDraftTimer = setTimeout(() => saveDraft(state), 400);
}

function recalcAll() {
  const r = compute(state);
  // 衍生欄位
  $('#sum-checks').textContent = fmt(r.derived.sumChecks);
  $('#sum-remits').textContent = fmt(r.derived.sumRemits);
  $('#auto-eTotal').textContent = fmt(r.derived.eTotal);
  $('#auto-gaPercent').textContent = fmt(r.derived.gaPercent);
  $('#auto-gaTax').textContent = fmt(r.derived.gaTax);
  $('#auto-tax1').value = fmt(r.derived.tax1);
  $('#auto-tax2').value = fmt(r.derived.tax2);
  $('#auto-tax3').value = fmt(r.derived.tax3);
  $('#auto-ledTax').value = fmt(r.derived.ledTax);
  $('#auto-allowanceTotal').textContent = fmt(r.derived.allowanceTotal);
  $('#auto-allowanceTaxTotal').textContent = fmt(r.derived.allowanceTaxTotal);

  // 差額
  const bar = $('#diff-bar');
  bar.classList.remove('status-balanced', 'status-unpaid', 'status-overpaid');
  bar.classList.add(`status-${r.status}`);
  $('#diff-value').textContent = fmt(r.diff);
  const hintEl = $('#diff-hint');
  if (r.status === 'balanced') hintEl.textContent = '✔ 已平衡';
  else if (r.status === 'unpaid') hintEl.textContent = `→ 將自動填入未收 ${fmt(r.suggestedUnpaid)}`;
  else hintEl.textContent = `→ 將自動填入溢收 ${fmt(r.suggestedOverpaid)}`;

  // 完成按鈕
  $('#btn-finish').disabled = r.status !== 'balanced' || !state.customerCode;
}

// ───────── 動作 ─────────
function bindActions() {
  $('#btn-reset').addEventListener('click', () => {
    if (!confirm('確定要清空所有欄位?草稿也會一併刪除。')) return;
    state = makeEmptyState();
    SCALAR_KEYS.forEach(k => {
      const el = document.querySelector(`[data-key="${k}"]`);
      if (el) el.value = '';
    });
    renderChecks();
    renderRemits();
    clearDraft();
    recalcAll();
  });

  $('#btn-finish').addEventListener('click', () => {
    const r = compute(state);
    if (r.status !== 'balanced') return;
    appendHistory({
      customerCode: state.customerCode,
      customerName: state.customerName,
      month: state.month,
      date: state.date,
      receivable: num(state.receivable),
      diff: r.diff,
      state: { ...state },
    });
    alert('已存檔!');
    state = makeEmptyState();
    SCALAR_KEYS.forEach(k => {
      const el = document.querySelector(`[data-key="${k}"]`);
      if (el) el.value = '';
    });
    renderChecks();
    renderRemits();
    clearDraft();
    recalcAll();
    showPage('history');
    renderHistory();
  });

  $('#btn-fill-tail').addEventListener('click', () => {
    const r = compute(state);
    if (r.diff > 0) {
      state.tailDiscount = String(Math.round(r.diff));
      const el = document.querySelector('[data-key="tailDiscount"]');
      if (el) el.value = state.tailDiscount;
      onStateChanged();
    }
  });

  $('#btn-autofill-unpaid').addEventListener('click', () => {
    const r = compute(state);
    if (r.diff > 0) {
      state.unpaid = String(Math.round(r.diff));
      const el = document.querySelector('[data-key="unpaid"]');
      if (el) el.value = state.unpaid;
      onStateChanged();
    }
  });
  $('#btn-autofill-overpaid').addEventListener('click', () => {
    const r = compute(state);
    if (r.diff < 0) {
      state.overpaid = String(Math.round(Math.abs(r.diff)));
      const el = document.querySelector('[data-key="overpaid"]');
      if (el) el.value = state.overpaid;
      onStateChanged();
    }
  });
}

// ───────── 頁籤切換 ─────────
function bindTabs() {
  $$('.tab').forEach(t => {
    t.addEventListener('click', () => showPage(t.dataset.page));
  });
}
function showPage(page) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.page === page));
  $('#page-calc').classList.toggle('hidden', page !== 'calc');
  $('#page-history').classList.toggle('hidden', page !== 'history');
  if (page === 'history') renderHistory();
}

// ───────── 歷史 ─────────
function renderHistory() {
  const list = loadHistory();
  const wrap = $('#history-list');
  const empty = $('#history-empty');
  wrap.innerHTML = '';
  if (list.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  list.forEach(rec => {
    const div = document.createElement('div');
    div.className = 'history-row';
    const ts = new Date(rec.savedAt).toLocaleString('zh-TW', {
      year: '2-digit', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
    div.innerHTML = `
      <div>
        <div class="h-cust">${escapeHtml(rec.customerName || rec.customerCode || '(未填客戶)')}</div>
        <div class="h-meta">${escapeHtml(rec.customerCode || '')} · ${escapeHtml(rec.month || '')} · ${ts}</div>
      </div>
      <div class="h-amt">${fmt(rec.receivable)}</div>
      <div class="h-actions">
        <button data-action="reuse" data-id="${rec.id}">以此為樣板</button>
        <button data-action="delete" data-id="${rec.id}" class="danger">刪除</button>
      </div>
    `;
    wrap.appendChild(div);
  });
  wrap.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (btn.dataset.action === 'delete') {
        if (!confirm('刪除這筆歷史紀錄?')) return;
        deleteHistory(id);
        renderHistory();
      } else if (btn.dataset.action === 'reuse') {
        const rec = getHistory(id);
        if (!rec) return;
        state = { ...makeEmptyState(), ...rec.state };
        SCALAR_KEYS.forEach(k => {
          const el = document.querySelector(`[data-key="${k}"]`);
          if (el) el.value = state[k] ?? '';
        });
        renderChecks();
        renderRemits();
        saveDraft(state);
        showPage('calc');
        recalcAll();
      }
    });
  });
}

// ───────── OCR ─────────
const dialog = () => $('#ocr-dialog');
let ocrContext = null;  // { mode, target }

function bindOcrButtons() {
  $$('button.btn-cam[data-ocr]').forEach(btn => {
    btn.addEventListener('click', () => openOcr('field', { fieldKey: btn.dataset.ocr }));
  });
  $('#btn-ocr-close').addEventListener('click', closeOcr);
  $('#btn-ocr-shutter').addEventListener('click', doShutter);
  $('#btn-ocr-retake').addEventListener('click', () => {
    $('#ocr-preview').classList.add('hidden');
    $('#ocr-results').innerHTML = '';
    $('#ocr-video').classList.remove('hidden');
    $('#btn-ocr-shutter').classList.remove('hidden');
    $('#btn-ocr-retake').classList.add('hidden');
    setStatus('就緒,請對準目標後拍照');
  });
  // 點背景不關閉 — 必須按 ✕
  dialog().addEventListener('cancel', e => { e.preventDefault(); closeOcr(); });
}

async function openOcr(mode, ctx = {}) {
  ocrContext = { mode, ...ctx };
  const titles = {
    'field':       `掃描 → 填入「${labelOf(ctx.fieldKey)}」`,
    'check':       '掃描支票(自動新增一筆)',
    'check-row':   `更新支票 #${(ctx.index ?? 0) + 1}`,
    'remit-row':   `更新匯款 #${(ctx.index ?? 0) + 1}`,
  };
  $('#ocr-title').textContent = titles[mode] || '掃描';
  $('#ocr-results').innerHTML = '';
  $('#ocr-preview').classList.add('hidden');
  $('#ocr-video').classList.remove('hidden');
  $('#btn-ocr-shutter').classList.remove('hidden');
  $('#btn-ocr-retake').classList.add('hidden');
  if (typeof dialog().showModal === 'function') dialog().showModal();
  else dialog().setAttribute('open', '');
  setStatus('啟動相機中…');
  try {
    await startCamera($('#ocr-video'));
    setStatus('就緒,請對準目標後拍照');
  } catch (e) {
    setStatus(`相機錯誤:${e.message}`);
  }
}

function closeOcr() {
  stopCamera();
  if (typeof dialog().close === 'function') dialog().close();
  else dialog().removeAttribute('open');
  ocrContext = null;
}

function setStatus(msg) {
  const el = $('#ocr-status');
  if (el) el.textContent = msg;
}

async function doShutter() {
  try {
    setStatus('擷取畫面…');
    const { dataUrl } = await capture($('#ocr-video'), $('#ocr-canvas'));
    $('#ocr-preview-img').src = dataUrl;
    $('#ocr-preview').classList.remove('hidden');
    $('#ocr-video').classList.add('hidden');
    $('#btn-ocr-shutter').classList.add('hidden');
    $('#btn-ocr-retake').classList.remove('hidden');
    setStatus('辨識中…(首次需下載語言模型,請耐心等候)');
    const text = await recognize(dataUrl, m => {
      if (m.status === 'recognizing text') {
        setStatus(`辨識中… ${Math.round(m.progress * 100)}%`);
      } else if (m.status === 'loading language traineddata') {
        setStatus(`下載語言模型 ${Math.round(m.progress * 100)}%…`);
      }
    });
    setStatus('辨識完成,請點選候選');
    showCandidates(text);
  } catch (e) {
    console.error(e);
    setStatus(`辨識失敗:${e.message}`);
  }
}

function showCandidates(text) {
  const { amounts, dates } = extractCandidates(text);
  const wrap = $('#ocr-results');
  wrap.innerHTML = '';

  if (amounts.length === 0 && dates.length === 0) {
    const div = document.createElement('div');
    div.className = 'ocr-card';
    div.innerHTML = `
      <div><div class="label">未抽到數字或日期</div><div class="value">請重拍或調整角度</div></div>
    `;
    wrap.appendChild(div);
    return;
  }

  amounts.forEach(n => {
    const card = document.createElement('div');
    card.className = 'ocr-card';
    card.innerHTML = `
      <div>
        <div class="label">候選金額</div>
        <div class="value">${fmt(n)}</div>
      </div>
      <button type="button">填入</button>
    `;
    card.querySelector('button').addEventListener('click', () => applyAmount(n));
    wrap.appendChild(card);
  });

  dates.forEach(d => {
    const card = document.createElement('div');
    card.className = 'ocr-card';
    card.innerHTML = `
      <div>
        <div class="label">候選日期</div>
        <div class="value">${escapeHtml(d)}</div>
      </div>
      <button type="button">填入</button>
    `;
    card.querySelector('button').addEventListener('click', () => applyDate(d));
    wrap.appendChild(card);
  });
}

function applyAmount(n) {
  if (!ocrContext) return;
  const valStr = String(Math.round(n));
  if (ocrContext.mode === 'field') {
    state[ocrContext.fieldKey] = valStr;
    const el = document.querySelector(`[data-key="${ocrContext.fieldKey}"]`);
    if (el) el.value = valStr;
  } else if (ocrContext.mode === 'check' || ocrContext.mode === 'check-row') {
    if (ocrContext.mode === 'check') {
      state.checks.push({ date: '', amount: valStr });
    } else {
      state.checks[ocrContext.index].amount = valStr;
    }
    renderChecks();
  } else if (ocrContext.mode === 'remit-row') {
    state.remits[ocrContext.index].amount = valStr;
    renderRemits();
  }
  onStateChanged();
  flashApplied();
}

function applyDate(d) {
  if (!ocrContext) return;
  if (ocrContext.mode === 'check') {
    if (state.checks.length === 0) state.checks.push({ date: d, amount: '' });
    else state.checks[state.checks.length - 1].date = d;
    renderChecks();
  } else if (ocrContext.mode === 'check-row') {
    state.checks[ocrContext.index].date = d;
    renderChecks();
  } else if (ocrContext.mode === 'remit-row') {
    state.remits[ocrContext.index].date = d;
    renderRemits();
  } else if (ocrContext.mode === 'field') {
    state[ocrContext.fieldKey] = d;
    const el = document.querySelector(`[data-key="${ocrContext.fieldKey}"]`);
    if (el) el.value = d;
  }
  onStateChanged();
  flashApplied();
}

function flashApplied() {
  setStatus('已填入 ✓');
}

function labelOf(key) {
  const map = {
    receivable: '應收', cash: '現金',
    eClass1: 'E類1', eClass2: 'E類2',
    allowance1: '折讓1', allowance2: '折讓2', allowance3: '折讓3',
    ledPercent: 'LED%', cashPercent: '現金%', tailDiscount: '尾折',
    other: '其他', advance: '預收', unpaid: '未收', overpaid: '溢收',
  };
  return map[key] || key;
}

// ───────── 字串安全 ─────────
function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
function escapeAttr(s) {
  return escapeHtml(s);
}
