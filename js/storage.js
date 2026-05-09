// storage.js — localStorage 草稿 + 歷史紀錄

const DRAFT_KEY = 'baoj_draft_v1';
const HISTORY_KEY = 'baoj_history_v1';
const HISTORY_MAX = 50;

export function saveDraft(state) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('saveDraft failed', e);
  }
}

export function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn('loadDraft failed', e);
    return null;
  }
}

export function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
}

export function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn('loadHistory failed', e);
    return [];
  }
}

export function saveHistory(list) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
  } catch (e) {
    console.warn('saveHistory failed', e);
  }
}

export function appendHistory(record) {
  const list = loadHistory();
  const id = `r_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const entry = { id, savedAt: new Date().toISOString(), ...record };
  list.unshift(entry);
  saveHistory(list);
  return entry;
}

export function deleteHistory(id) {
  const list = loadHistory().filter(r => r.id !== id);
  saveHistory(list);
}

export function getHistory(id) {
  return loadHistory().find(r => r.id === id) || null;
}
