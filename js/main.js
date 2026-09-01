/* main.js — 路由与启动 */
import * as S from './store.js';
import { $, $$, closeSheet, toast } from './ui.js';
import { viewHome, viewCapture, viewDrillItem, bindRouter } from './views.js';
import { viewCompress, viewPreflight, viewLibrary, profileSheet, settingsSheet, onboardingSheet } from './views2.js';
import { viewRecommendations } from './recommendations.js';
import { initNetwork } from '../src/platform/network.ts';
import { initializePlatform } from '../src/platform/lifecycle.ts';
import { processOutbox } from '../src/outbox.ts';
import { Capacitor } from '@capacitor/core';

async function start() {
  const app = $('#app');
  app.innerHTML = '<div class="view"><div class="card flat"><div class="think"><span class="dots"><i></i><i></i><i></i></span><span>正在打开本地数据…</span></div></div></div>';

  try {
    await S.load();
  } catch (error) {
    console.error('startup failed', error);
    app.innerHTML = '<div class="view"><div class="card rose"><p class="zh" style="font-weight:600">本地数据无法打开</p><p class="sub zh" id="startup-error" style="margin-top:8px"></p></div></div>';
    $('#startup-error').textContent = error instanceof Error ? error.message : String(error);
    throw error;
  }

const ROUTES = {
  home: viewHome, capture: viewCapture, compress: viewCompress,
  preflight: viewPreflight, library: viewLibrary,
  recommend: viewRecommendations,
};

function go(route, arg) {
  const r = ROUTES[route] ? route : 'home';
  if (location.hash.slice(1) !== r) history.replaceState(null, '', '#' + r);
  const activeTab = r === 'recommend' ? 'home' : r;
  $$('#tabbar .tab').forEach(t => t.classList.toggle(
    'on',
    t.dataset.route === activeTab,
  ));
  window.scrollTo({ top: 0, behavior: 'instant' });
  ROUTES[r](app, arg);
  refreshChip();
}
bindRouter(go);

function openDrill(itemId, answer = '') {
  history.replaceState(null, '', '#drill/' + encodeURIComponent(itemId));
  $$('#tabbar .tab').forEach(t => t.classList.remove('on'));
  window.scrollTo({ top: 0, behavior: 'instant' });
  viewDrillItem(app, itemId, answer);
}

function refreshChip() {
  const c = $('#mode-chip');
  const live = S.isLive();
  c.textContent = live ? '模型已接入' : '未接入模型';
  c.className = 'chip ' + (live ? 'chip-live' : 'chip-unconfigured');
}

$$('#tabbar .tab').forEach(t => t.addEventListener('click', () => go(t.dataset.route)));
$('#btn-profile').addEventListener('click', profileSheet);
$('#btn-settings').addEventListener('click', () => settingsSheet(refreshChip));
$('#mode-chip').addEventListener('click', () => settingsSheet(refreshChip));
$$('#sheet [data-close]').forEach(el => el.addEventListener('click', closeSheet));
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
window.addEventListener('hashchange', () => {
  const hash = location.hash.slice(1);
  if (hash.startsWith('drill/')) {
    openDrill(decodeURIComponent(hash.slice('drill/'.length)));
  } else {
    go(hash);
  }
});

const initialHash = location.hash.slice(1);
if (initialHash.startsWith('drill/')) {
  openDrill(decodeURIComponent(initialHash.slice('drill/'.length)));
} else {
  go(initialHash || 'home');
}

if (!S.state.settings.onboarded) {
  onboardingSheet(refreshChip);
}

await initNetwork(() => processOutbox().then(count => {
  if (count) {
    toast(`已自动分析 ${count} 条闪存`);
    if (location.hash === '#home') viewHome(app);
  }
}));
await initializePlatform({
  go,
  openDrill,
  closeOverlay: closeSheet,
});

if (!Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
}

start().catch(error => console.error('fatal startup error', error));
