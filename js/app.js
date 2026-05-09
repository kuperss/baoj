// app.js — DOM 綁定 / 事件分派 / OCR 流程 / Toast / Confirm

import { compute, fmt, num } from './calc.js';
import {
  saveDraft, loadDraft, clearDraft,
  loadHistory, appendHistory, deleteHistory, getHistory,
} from './storage.js';
import { startCamera, stopCamera, capture } from './camera.js';
import {
  recognize,
  extractCandidates,
  extractCodeCandidates,
  extractNameCandidates,
  extractBillFields,
} from './ocr.js';
import { icons } from './icons.js';

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

// 在所有 [data-icon] 元素中注入 SVG
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => {
    const name = el.dataset.icon;
    if (icons[name] && !el.firstElementChild) {
      el.innerHTML = icons[name];
    }
  });
}

// ───────── 初始化 ─────────
window.addEventListener('DOMContentLoaded', () => {
  hydrateIcons();
  hydrateFromDraft();
  bindScalarFields();
  bindDynamicLists();
  bindActions();
  bindTabs();
  bindOcrButtons();
  bindConfirmModal();
  recalcAll();
});

function hydrateFromDraft() {
  const d = loadDraft();
  if (d) {
    state = { ...makeEmptyState(), ...d };
    if (!Array.isArray(state.checks)) state.checks = [];
    if (!Array.isArray(state.remits)) state.remits = [];
    SCALAR_KEYS.forEach(k => {
      const el = document.querySelector(`[data-key="${k}"]`);
      if (el) el.value = state[k] ?? '';
    });
  }
  // 無論有沒有 draft,都要 render 出空白佔位提示
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
      if (NUM_KEYS.has(key) && input.value.trim() !== '') {
        const n = num(input.value);
        input.value = n === 0 ? '' : String(n);
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
  const billBtn = $('#btn-scan-bill');
  if (billBtn) billBtn.addEventListener('click', () => openOcr('bill'));
}

function renderChecks() {
  const list = $('#checks-list');
  list.innerHTML = '';
  if (state.checks.length === 0) {
    list.innerHTML = '<div class="dyn-empty">尚未新增支票 — 點「掃描」拍照或「新增」手動輸入</div>';
    return;
  }
  state.checks.forEach((c, i) => list.appendChild(makeDynRow('check', i, c)));
}
function renderRemits() {
  const list = $('#remits-list');
  list.innerHTML = '';
  if (state.remits.length === 0) {
    list.innerHTML = '<div class="dyn-empty">尚未新增匯款 — 點「新增」開始輸入</div>';
    return;
  }
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
    <button type="button" class="btn-row-cam" data-action="ocr" aria-label="掃描">${icons.camera}</button>
    <button type="button" class="btn-row-rm" data-action="remove" aria-label="刪除">${icons.trash}</button>
  `;
  const dateEl = row.querySelector('.date');
  const amtEl  = row.querySelector('.amt');
  dateEl.addEventListener('input', () => { bucket(kind)[index].date = dateEl.value; onStateChanged(); });
  amtEl.addEventListener('input',  () => { bucket(kind)[index].amount = amtEl.value; onStateChanged(); });
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

  const bar = $('#diff-bar');
  bar.classList.remove('status-balanced', 'status-unpaid', 'status-overpaid');
  bar.classList.add(`status-${r.status}`);
  $('#diff-value').textContent = fmt(r.diff);

  const hintIcon = $('#diff-hint > [data-icon]');
  const hintText = $('#diff-hint-text');
  if (r.status === 'balanced') {
    hintIcon.innerHTML = icons.check;
    hintIcon.dataset.icon = 'check';
    hintText.textContent = '已平衡';
  } else if (r.status === 'unpaid') {
    hintIcon.innerHTML = icons.arrowDown;
    hintIcon.dataset.icon = 'arrowDown';
    hintText.textContent = `未收 ${fmt(r.suggestedUnpaid)}`;
  } else {
    hintIcon.innerHTML = icons.alert;
    hintIcon.dataset.icon = 'alert';
    hintText.textContent = `溢收 ${fmt(r.suggestedOverpaid)}`;
  }

  $('#btn-finish').disabled = r.status !== 'balanced' || !state.customerCode;
}

// ───────── 動作 ─────────
function bindActions() {
  $('#btn-reset').addEventListener('click', async () => {
    const ok = await confirmModal({
      title: '清空所有欄位?',
      desc: '草稿與目前所有輸入都會被刪除,此動作無法復原。',
      okText: '清空',
      destructive: true,
    });
    if (!ok) return;
    state = makeEmptyState();
    SCALAR_KEYS.forEach(k => {
      const el = document.querySelector(`[data-key="${k}"]`);
      if (el) el.value = '';
    });
    renderChecks();
    renderRemits();
    clearDraft();
    recalcAll();
    toast('已清空', 'success');
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
    toast('已存到歷史紀錄', 'success');
  });

  $('#btn-fill-tail').addEventListener('click', () => {
    const r = compute(state);
    if (r.diff > 0) {
      state.tailDiscount = String(Math.round(r.diff));
      const el = document.querySelector('[data-key="tailDiscount"]');
      if (el) el.value = state.tailDiscount;
      onStateChanged();
      toast(`尾折填入 ${fmt(r.diff)}`, 'success');
    } else {
      toast('差額不為正,無法填入尾折', 'warning');
    }
  });

  $('#btn-autofill-unpaid').addEventListener('click', () => {
    const r = compute(state);
    if (r.diff > 0) {
      state.unpaid = String(Math.round(r.diff));
      const el = document.querySelector('[data-key="unpaid"]');
      if (el) el.value = state.unpaid;
      onStateChanged();
      toast(`未收填入 ${fmt(r.diff)}`, 'success');
    } else {
      toast('差額不為正,無需填入未收', 'warning');
    }
  });
  $('#btn-autofill-overpaid').addEventListener('click', () => {
    const r = compute(state);
    if (r.diff < 0) {
      state.overpaid = String(Math.round(Math.abs(r.diff)));
      const el = document.querySelector('[data-key="overpaid"]');
      if (el) el.value = state.overpaid;
      onStateChanged();
      toast(`溢收填入 ${fmt(Math.abs(r.diff))}`, 'success');
    } else {
      toast('差額不為負,無需填入溢收', 'warning');
    }
  });
}

// ───────── 頁籤 ─────────
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
        <button data-action="reuse" data-id="${rec.id}">${icons.copy}<span>套用</span></button>
        <button data-action="delete" data-id="${rec.id}" class="danger">${icons.trash}<span>刪除</span></button>
      </div>
    `;
    wrap.appendChild(div);
  });
  wrap.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (btn.dataset.action === 'delete') {
        const ok = await confirmModal({
          title: '刪除這筆紀錄?',
          desc: '刪除後無法復原。',
          okText: '刪除',
          destructive: true,
        });
        if (!ok) return;
        deleteHistory(id);
        renderHistory();
        toast('已刪除', 'success');
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
        toast('已套用為新草稿', 'success');
      }
    });
  });
}

// ───────── OCR ─────────
const dialog = () => $('#ocr-dialog');
let ocrContext = null;

function bindOcrButtons() {
  // 數字 OCR(應收 / 現金)
  $$('button[data-ocr]').forEach(btn => {
    btn.addEventListener('click', () => openOcr('field', { fieldKey: btn.dataset.ocr }));
  });
  // 文字 OCR(客戶編號 / 名稱)
  $$('button[data-ocr-text]').forEach(btn => {
    btn.addEventListener('click', () => openOcr('text-field', { fieldKey: btn.dataset.ocrText }));
  });
  $('#btn-ocr-close').addEventListener('click', closeOcr);
  $('#btn-ocr-shutter').addEventListener('click', doShutter);
  $('#btn-ocr-retake').addEventListener('click', () => {
    $('#ocr-preview').classList.add('hidden');
    $('#ocr-results').innerHTML = '';
    $('#ocr-video').classList.remove('hidden');
    $('#ocr-frame').classList.remove('hidden');
    $('#btn-ocr-shutter').classList.remove('hidden');
    $('#btn-ocr-retake').classList.add('hidden');
    setStatus('就緒,請對準目標後拍照', false);
  });
  dialog().addEventListener('cancel', e => { e.preventDefault(); closeOcr(); });
}

async function openOcr(mode, ctx = {}) {
  ocrContext = { mode, ...ctx };
  const titles = {
    'field':       `掃描「${labelOf(ctx.fieldKey)}」金額`,
    'text-field':  `掃描「${labelOf(ctx.fieldKey)}」`,
    'check':       '掃描支票(自動新增)',
    'check-row':   `更新支票 #${(ctx.index ?? 0) + 1}`,
    'remit-row':   `更新匯款 #${(ctx.index ?? 0) + 1}`,
    'bill':        '掃描對帳單',
  };
  $('#ocr-title').textContent = titles[mode] || '掃描';
  $('#ocr-results').innerHTML = '';
  $('#ocr-preview').classList.add('hidden');
  $('#ocr-video').classList.remove('hidden');
  $('#ocr-frame').classList.remove('hidden');
  $('#btn-ocr-shutter').classList.remove('hidden');
  $('#btn-ocr-retake').classList.add('hidden');

  if (typeof dialog().showModal === 'function') dialog().showModal();
  else dialog().setAttribute('open', '');

  setStatus('啟動相機中…', true);
  try {
    await startCamera($('#ocr-video'));
    setStatus('就緒,請對準目標後拍照', false);
  } catch (e) {
    setStatus(`相機錯誤: ${e.message}`, false);
    toast(e.message, 'error');
  }
}

function closeOcr() {
  stopCamera();
  if (typeof dialog().close === 'function') dialog().close();
  else dialog().removeAttribute('open');
  ocrContext = null;
}

function setStatus(msg, processing = false) {
  const el = $('#ocr-status');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('processing', !!processing);
}

async function doShutter() {
  try {
    setStatus('擷取畫面與前處理…', true);
    const { dataUrl, w, h } = await capture($('#ocr-video'), $('#ocr-canvas'));
    console.log(`[OCR] capture ${w}x${h}`);
    $('#ocr-preview-img').src = dataUrl;
    $('#ocr-preview').classList.remove('hidden');
    $('#ocr-video').classList.add('hidden');
    $('#ocr-frame').classList.add('hidden');
    $('#btn-ocr-shutter').classList.add('hidden');
    $('#btn-ocr-retake').classList.remove('hidden');
    setStatus('辨識中…(首次需下載語言模型 ~10MB)', true);
    const text = await recognize(dataUrl, m => {
      if (m.status === 'recognizing text') {
        setStatus(`辨識中 ${Math.round(m.progress * 100)}%`, true);
      } else if (m.status && m.status.includes('language')) {
        setStatus(`下載語言模型 ${Math.round((m.progress || 0) * 100)}%…`, true);
      }
    });
    if (!text || !text.trim()) {
      setStatus('辨識完成但沒讀到任何文字 — 請拉近重拍', false);
      toast('沒讀到文字,請拉近拍清楚', 'warning', 3500);
    } else {
      const charCount = text.replace(/\s/g, '').length;
      setStatus(`辨識完成 (${charCount} 字)`, false);
    }
    showCandidates(text);
  } catch (e) {
    console.error('[OCR error]', e);
    const msg = e?.message || String(e);
    setStatus(`辨識失敗: ${msg}`, false);
    toast(`辨識失敗:${msg}`, 'error', 4500);
  }
}

function showCandidates(text) {
  const wrap = $('#ocr-results');
  wrap.innerHTML = '';
  wrap.classList.remove('bill');

  if (!ocrContext) return;

  // 對帳單智慧掃描:多欄位面板
  if (ocrContext.mode === 'bill') {
    const fields = extractBillFields(text);
    wrap.classList.add('bill');
    wrap.appendChild(billPanel(fields));
    return;
  }

  // 文字模式:客戶編號或客戶名稱
  if (ocrContext.mode === 'text-field') {
    console.log('[OCR raw]\n' + text);
    const isCode = ocrContext.fieldKey === 'customerCode';
    const list = isCode ? extractCodeCandidates(text) : extractNameCandidates(text);
    if (list.length === 0) {
      wrap.appendChild(emptyOcrCard(isCode ? '未抽到編號' : '未抽到名稱'));
    } else {
      list.forEach(s => wrap.appendChild(ocrCard(isCode ? '候選編號' : '候選名稱', s, () => {
        applyTextValue(s);
      })));
    }
    wrap.appendChild(rawTextCard(text));
    return;
  }

  // 數字 / 日期模式
  console.log('[OCR raw]\n' + text);
  const { amounts, dates } = extractCandidates(text);
  if (amounts.length === 0 && dates.length === 0) {
    wrap.appendChild(emptyOcrCard('未抽到數字或日期'));
    wrap.appendChild(rawTextCard(text));
    return;
  }
  amounts.forEach(n => wrap.appendChild(ocrCard('候選金額', fmt(n), () => applyAmount(n))));
  dates.forEach(d => wrap.appendChild(ocrCard('候選日期', d, () => applyDate(d))));
  wrap.appendChild(rawTextCard(text));
}

function rawTextCard(text) {
  const card = document.createElement('div');
  card.className = 'ocr-card ocr-card-raw';
  card.innerHTML = `
    <details style="width: 100%;">
      <summary class="ocr-raw-summary" style="cursor:pointer;font-size:12px;color:var(--text-3);font-weight:600">原始辨識文字</summary>
      <pre class="ocr-raw">${escapeHtml(text) || '(空)'}</pre>
    </details>
  `;
  return card;
}

function ocrCard(label, value, onApply) {
  const card = document.createElement('div');
  card.className = 'ocr-card';
  card.innerHTML = `
    <div class="ocr-info">
      <div class="ocr-label">${escapeHtml(label)}</div>
      <div class="ocr-value">${escapeHtml(value)}</div>
    </div>
    <button type="button">填入</button>
  `;
  card.querySelector('button').addEventListener('click', onApply);
  return card;
}

// ─── 對帳單多欄位面板 ───
function billPanel(fields) {
  const items = [
    { key: 'month',        label: '月份',           value: fields.month,        type: 'text' },
    { key: 'customerCode', label: '客戶編號',       value: fields.customerCode, type: 'text' },
    { key: 'customerName', label: '客戶名稱',       value: fields.customerName, type: 'text' },
    { key: 'receivable',   label: '應收金額',       value: fields.receivable,   type: 'amount' },
    { key: 'eClass1',      label: 'E類1 (其他1)',   value: fields.eClass1,      type: 'amount' },
    { key: 'eClass2',      label: 'E類2 (其他1)',   value: fields.eClass2,      type: 'amount' },
  ];
  if (fields.overdue) {
    items.push({ key: 'unpaid', label: '逾期未收', value: fields.overdue, type: 'amount' });
  }

  const panel = document.createElement('div');
  panel.className = 'ocr-bill-panel';
  const foundCount = items.filter(it => it.value != null && it.value !== '').length;
  const rawText = fields.rawText || '';

  // Console 也印一份方便接 USB DevTools 看
  console.log('[OCR raw]\n' + rawText);

  panel.innerHTML = `
    <div class="ocr-bill-head">
      ${icons.check}
      <span>辨識完成 — 找到 ${foundCount}/${items.length} 個欄位</span>
    </div>
    <div class="ocr-bill-fields"></div>
    <details class="ocr-raw-wrap">
      <summary class="ocr-raw-summary">原始辨識文字 (除錯用,可複製)</summary>
      <pre class="ocr-raw">${escapeHtml(rawText) || '(空)'}</pre>
      <button type="button" class="btn-link ocr-raw-copy">複製文字</button>
    </details>
    <button type="button" class="ocr-bill-cta" id="ocr-fill-all">
      ${icons.check}
      <span>全部填入</span>
    </button>
  `;

  const list = panel.querySelector('.ocr-bill-fields');
  items.forEach(it => {
    const row = document.createElement('label');
    const has = it.value != null && it.value !== '';
    row.className = 'ocr-field-row' + (has ? '' : ' disabled');
    const display = has
      ? (it.type === 'amount' ? fmt(it.value) : String(it.value))
      : '未抽到';
    row.innerHTML = `
      <input type="checkbox" ${has ? 'checked' : 'disabled'} data-bill-key="${it.key}" data-bill-type="${it.type}">
      <div class="ocr-field-info">
        <div class="ocr-field-label">${escapeHtml(it.label)}</div>
        <div class="ocr-field-value">${escapeHtml(display)}</div>
      </div>
      <span class="ocr-field-tag">${has ? '已找到' : '未找到'}</span>
    `;
    list.appendChild(row);
  });

  // 把欄位值 stash 在 panel 上,fillAll 時讀
  panel.dataset.values = JSON.stringify({
    month: fields.month,
    customerCode: fields.customerCode,
    customerName: fields.customerName,
    receivable: fields.receivable,
    eClass1: fields.eClass1,
    eClass2: fields.eClass2,
    unpaid: fields.overdue,
  });

  // 複製原始文字
  const copyBtn = panel.querySelector('.ocr-raw-copy');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(rawText);
        toast('已複製原始辨識文字', 'success');
      } catch (e) {
        toast('複製失敗,請手動長按選取', 'error');
      }
    });
  }

  panel.querySelector('#ocr-fill-all').addEventListener('click', () => {
    const values = JSON.parse(panel.dataset.values);
    const checks = panel.querySelectorAll('input[type="checkbox"]:checked');
    let appliedCount = 0;
    checks.forEach(cb => {
      const key = cb.dataset.billKey;
      const v = values[key];
      if (v == null || v === '') return;
      const valStr = cb.dataset.billType === 'amount' ? String(Math.round(Number(v))) : String(v);
      state[key] = valStr;
      const el = document.querySelector(`[data-key="${key}"]`);
      if (el) el.value = valStr;
      appliedCount++;
    });
    if (appliedCount > 0) {
      onStateChanged();
      toast(`已填入 ${appliedCount} 個欄位`, 'success');
      closeOcr();
    } else {
      toast('沒有勾選任何欄位', 'warning');
    }
  });

  return panel;
}

function emptyOcrCard(msg) {
  const card = document.createElement('div');
  card.className = 'ocr-card';
  card.innerHTML = `
    <div class="ocr-info">
      <div class="ocr-label">提示</div>
      <div class="ocr-value">${escapeHtml(msg)} — 請重拍或調整角度</div>
    </div>
  `;
  return card;
}

function applyAmount(n) {
  if (!ocrContext) return;
  const valStr = String(Math.round(n));
  if (ocrContext.mode === 'field') {
    state[ocrContext.fieldKey] = valStr;
    const el = document.querySelector(`[data-key="${ocrContext.fieldKey}"]`);
    if (el) el.value = valStr;
  } else if (ocrContext.mode === 'check') {
    state.checks.push({ date: '', amount: valStr });
    renderChecks();
  } else if (ocrContext.mode === 'check-row') {
    state.checks[ocrContext.index].amount = valStr;
    renderChecks();
  } else if (ocrContext.mode === 'remit-row') {
    state.remits[ocrContext.index].amount = valStr;
    renderRemits();
  }
  onStateChanged();
  toast(`已填入 ${fmt(n)}`, 'success');
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
  toast(`已填入日期 ${d}`, 'success');
}

function applyTextValue(s) {
  if (!ocrContext || ocrContext.mode !== 'text-field') return;
  state[ocrContext.fieldKey] = s;
  const el = document.querySelector(`[data-key="${ocrContext.fieldKey}"]`);
  if (el) el.value = s;
  onStateChanged();
  toast(`已填入「${s}」`, 'success');
}

function labelOf(key) {
  const map = {
    receivable: '應收', cash: '現金',
    customerCode: '客戶編號', customerName: '客戶名稱',
    eClass1: 'E類1', eClass2: 'E類2',
    allowance1: '折讓1', allowance2: '折讓2', allowance3: '折讓3',
    ledPercent: 'LED%', cashPercent: '現金%', tailDiscount: '尾折',
    other: '其他', advance: '預收', unpaid: '未收', overpaid: '溢收',
  };
  return map[key] || key;
}

// ───────── Toast ─────────
const TOAST_ICONS = {
  success: icons.check,
  error: icons.alert,
  warning: icons.alert,
  info: '',
};
let toastSeq = 0;
function toast(msg, type = 'info', duration = 2400) {
  const c = $('#toast-container');
  if (!c) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.id = `t${++toastSeq}`;
  t.innerHTML = `${TOAST_ICONS[type] || ''}<span>${escapeHtml(msg)}</span>`;
  c.appendChild(t);
  setTimeout(() => {
    t.classList.add('exit');
    setTimeout(() => t.remove(), 200);
  }, duration);
}

// ───────── Confirm Modal ─────────
let confirmResolver = null;
function bindConfirmModal() {
  $('#confirm-cancel').addEventListener('click', () => closeConfirm(false));
  $('#confirm-ok').addEventListener('click', () => closeConfirm(true));
  $('#confirm-modal').addEventListener('click', (e) => {
    if (e.target.id === 'confirm-modal') closeConfirm(false);
  });
}
function confirmModal({ title, desc, okText = '確定', cancelText = '取消', destructive = false }) {
  return new Promise(resolve => {
    confirmResolver = resolve;
    $('#confirm-title').textContent = title;
    $('#confirm-desc').textContent = desc || '';
    const okBtn = $('#confirm-ok');
    okBtn.textContent = okText;
    okBtn.className = destructive ? 'btn btn-danger' : 'btn btn-primary';
    $('#confirm-cancel').textContent = cancelText;
    $('#confirm-modal').classList.remove('hidden');
  });
}
function closeConfirm(value) {
  $('#confirm-modal').classList.add('hidden');
  if (confirmResolver) {
    confirmResolver(value);
    confirmResolver = null;
  }
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
