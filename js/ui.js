/* ui.js — 轻量渲染工具 */
export const h = (html) => html;
export const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* 骨架里的 X/Y/Z 高亮 */
export const skel = (s = '') => esc(s).replace(/\b([XYZ])\b/g, '<b>$1</b>');

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let toastTimer;
let sheetReturnFocus = null;
export function toast(msg) {
  const t = $('#toast'); if (!t) return;
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2300);
}

export function openSheet(title, bodyHTML, onMount, { dismissible = true } = {}) {
  const s = $('#sheet');
  sheetReturnFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = bodyHTML;
  s.dataset.dismissible = String(dismissible);
  $$('[data-close]', s).forEach(element => { element.hidden = !dismissible; });
  s.removeAttribute('inert');
  s.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  onMount?.($('#sheet-body'));
}
export function closeSheet(force = false) {
  const sheet = $('#sheet');
  const wasOpen = sheet.getAttribute('aria-hidden') === 'false';
  if (wasOpen && sheet.dataset.dismissible === 'false' && !force) return false;
  if (sheet.contains(document.activeElement)) document.activeElement?.blur?.();
  sheet.setAttribute('inert', '');
  sheet.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  sheetReturnFocus?.focus({ preventScroll: true });
  sheetReturnFocus = null;
  return wasOpen;
}

export function ago(ts) {
  if (!ts) return '—';
  const d = Date.now() - ts, m = 6e4, hh = 36e5, dd = 864e5;
  if (d < m) return '刚刚';
  if (d < hh) return Math.floor(d / m) + ' 分钟前';
  if (d < dd) return Math.floor(d / hh) + ' 小时前';
  if (d < 30 * dd) return Math.floor(d / dd) + ' 天前';
  return Math.floor(d / (30 * dd)) + ' 个月前';
}
export function inWords(ts) {
  const d = ts - Date.now();
  if (d <= 0) return '现在';
  const dd = 864e5;
  if (d < 36e5) return Math.max(1, Math.round(d / 6e4)) + ' 分钟后';
  if (d < dd) return Math.round(d / 36e5) + ' 小时后';
  return Math.round(d / dd) + ' 天后';
}
export const words = (s = '') => s.trim().split(/\s+/).filter(Boolean).length;

export function ladderHTML(box, owned, { labeled = false } = {}) {
  const step = Math.max(0, Math.min(5, Number(box) || 0));
  const bars = `<span class="ladder" aria-hidden="true">${[0, 1, 2, 3, 4].map(k =>
    `<i class="${owned && k === 4 ? 'own' : (k < step ? 'on' : '')}"></i>`).join('')}</span>`;
  if (!labeled) {
    return `<span aria-label="复习阶梯 ${step} / 5">${bars}</span>`;
  }
  return `<span class="ladder-status" aria-label="复习阶梯 ${step} / 5"><span class="ladder-label">复习阶梯 ${step} / 5</span>${bars}</span>`;
}
export const srcPill = (kind) => {
  const m = { heard: ['听到的', 'src-heard'], fragment: ['听到的', 'src-heard'], mine: ['改我的', 'src-mine'], compress: ['压缩台', 'src-mine'], zh: ['中译英', 'src-zh'], preflight: ['会前', 'src-zh'], recommendation: ['推荐', 'src-recommendation'] };
  const [t, c] = m[kind] || ['—', 'src-zh'];
  return `<span class="pill-src ${c}">${t}</span>`;
};

export function thinking(label = '正在分析') {
  return `<div class="card flat"><div class="think"><span class="dots"><i></i><i></i><i></i></span><span>${esc(label)}…</span></div>
    <div style="margin-top:12px;display:grid;gap:7px"><div class="skeleton" style="width:88%"></div><div class="skeleton" style="width:64%"></div><div class="skeleton" style="width:76%"></div></div></div>`;
}
