/* main.js — 路由与启动 */
import * as S from './store.js';
import { $, $$, closeSheet, toast } from './ui.js';
import { viewHome, viewCapture, viewDrillItem, bindRouter } from './views.js';
import { viewCompress, viewPreflight, viewLibrary, settingsSheet, onboardingSheet } from './views2.js';
import { viewRecommendations } from './recommendations.js';
import { viewRoleplay } from './roleplay.js';
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
  closeSheet();
  if (route === 'roleplay' && arg) {
    openRoleplay(arg);
    return;
  }
  const r = ROUTES[route] ? route : 'home';
  app.dataset.route = r;
  if (location.hash.slice(1) !== r) history.replaceState(null, '', '#' + r);
  const activeTab = r === 'recommend' ? 'home' : r;
  $$('#tabbar .tab').forEach(t => {
    const active = t.dataset.route === activeTab;
    t.classList.toggle('on', active);
    if (active) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  window.scrollTo({ top: 0, behavior: 'instant' });
  ROUTES[r](app, arg);
  refreshChip();
}
bindRouter(go);

function openDrill(itemId, answer = '') {
  closeSheet();
  app.dataset.route = 'drill';
  history.replaceState(null, '', '#drill/' + encodeURIComponent(itemId));
  $$('#tabbar .tab').forEach(t => {
    t.classList.remove('on');
    t.removeAttribute('aria-current');
  });
  window.scrollTo({ top: 0, behavior: 'instant' });
  viewDrillItem(app, itemId, answer);
}

function openRoleplay(itemId) {
  closeSheet();
  app.dataset.route = 'roleplay';
  history.replaceState(null, '', '#roleplay/' + encodeURIComponent(itemId));
  $$('#tabbar .tab').forEach(t => {
    t.classList.remove('on');
    t.removeAttribute('aria-current');
  });
  window.scrollTo({ top: 0, behavior: 'instant' });
  viewRoleplay(app, itemId);
}

function refreshChip() {
  const c = $('#mode-chip');
  const live = S.isLive();
  c.hidden = live;
}

$$('#tabbar .tab').forEach(t => t.addEventListener('click', () => go(t.dataset.route)));
$('#btn-settings').addEventListener('click', () => settingsSheet(refreshChip));
$('#mode-chip').addEventListener('click', () => settingsSheet(refreshChip));
$$('#sheet [data-close]').forEach(el => el.addEventListener('click', closeSheet));
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
window.addEventListener('hashchange', () => {
  const hash = location.hash.slice(1);
  if (hash.startsWith('drill/')) {
    openDrill(decodeURIComponent(hash.slice('drill/'.length)));
  } else if (hash.startsWith('roleplay/')) {
    openRoleplay(decodeURIComponent(hash.slice('roleplay/'.length)));
  } else {
    go(hash);
  }
});

const initialHash = location.hash.slice(1);
if (initialHash.startsWith('drill/')) {
  openDrill(decodeURIComponent(initialHash.slice('drill/'.length)));
} else if (initialHash.startsWith('roleplay/')) {
  openRoleplay(decodeURIComponent(initialHash.slice('roleplay/'.length)));
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
